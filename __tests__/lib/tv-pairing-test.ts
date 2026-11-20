import { randomFillSync, createHash } from "node:crypto";
import { fromByteArray, toByteArray } from "base64-js";
import nacl from "tweetnacl";
import { fetch as nativeFetch } from "expo/fetch";
import { getRandomValues } from "expo-crypto";
import { api } from "@/lib/api/client";
import { redirectSystemPath } from "@/app/+native-intent";
import {
  clearTvLink,
  getPendingTvLink,
  parseTvLink,
} from "@/lib/tv/pairing-link";
import {
  sealTvSetup,
  sendTvSetup,
  tvFingerprint,
  validTvSettings,
} from "@/lib/tv/pairing";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-crypto", () => ({ getRandomValues: jest.fn() }));
jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));

const tv = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(23));
const key = fromByteArray(tv.publicKey)
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
const qr = `aurralpocket://tv-pair?v=1&address=192.168.1.4&port=4567&id=${"c1".repeat(16)}&key=${key}`;
const link = parseTvLink(qr)!;
const server = "https://music.example/my-aurral";
const headers = {
  "CF-Access-Client-Secret": "fixture-proxy-only",
  "X-API-Key": "fixture-gateway-key",
  Cookie: "fixture-proxy=explicit",
};
const code = "01A2BC3DEF";

function openPayload(body: string, secretKey = tv.secretKey) {
  const envelope = toByteArray(body + "=".repeat((4 - (body.length % 4)) % 4));
  return nacl.box.open(
    envelope.slice(56),
    envelope.slice(32, 56),
    envelope.slice(0, 32),
    secretKey,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (getRandomValues as jest.Mock).mockImplementation((target: Uint8Array) =>
    randomFillSync(target),
  );
});
afterEach(() => {
  clearTvLink(getPendingTvLink());
  jest.useRealTimers();
});

it.each([
  "127.0.0.1",
  "8.8.8.8",
  "169.254.169.254",
  "224.1.2.3",
  "192.168.001.4",
  "192.168.1.256",
  "172.32.0.1",
  "10.1",
  "0xa000001",
  "3232235777",
  "10.0.0.1.bad.example",
  "localhost",
  "[::1]",
  "192.168.1.4%2f",
  "10.0.0.1@elsewhere",
])("rejects receiver %s", (address) => {
  expect(parseTvLink(qr.replace("192.168.1.4", address))).toBeNull();
});
it.each(["10.1.2.3", "172.16.0.1", "172.31.0.1", "192.168.254.4"])(
  "accepts private IPv4 %s",
  (address) => {
    expect(parseTvLink(qr.replace("192.168.1.4", address))?.address).toBe(
      address,
    );
  },
);
it.each([
  qr + "&address=10.1.1.1",
  qr.replace("v=1", "v=2"),
  qr.replace("4567", "0"),
  qr.replace("4567", "65536"),
  qr + "#frag",
  qr + "&server=elsewhere",
  qr.replace(key, "a".repeat(43)),
  qr.replace("c1".repeat(16), "untrusted"),
])("rejects malformed challenges", (raw) => {
  expect(parseTvLink(raw)).toBeNull();
});
it("routes cold and warm scans without putting QR fields in history and expires outstanding scans", () => {
  jest.useFakeTimers();
  expect(redirectSystemPath({ path: qr, initial: true })).toBe("/tv-setup");
  const first = getPendingTvLink();
  expect(first).toMatchObject({ link });
  expect(redirectSystemPath({ path: qr, initial: false })).toBe("/tv-setup");
  expect(typeof first === "object" && first?.signal.aborted).toBe(true);
  jest.advanceTimersByTime(120_000);
  expect(getPendingTvLink()).toBeNull();
  expect(
    redirectSystemPath({ path: "aurralpocket://settings", initial: false }),
  ).toBe("aurralpocket://settings");
});
it("shows the TV key fingerprint, independent of the QR address or header values", () => {
  const fingerprint = createHash("sha512")
    .update(tv.publicKey)
    .digest("hex")
    .slice(0, 12)
    .match(/.{4}/g)!
    .join("-")
    .toUpperCase();
  expect(tvFingerprint(link)).toBe(fingerprint);
});
it("issues a fresh code against Aurral and sends only a fresh authenticated ciphertext to the exact LAN destination", async () => {
  (api.post as jest.Mock).mockResolvedValue({
    data: { code, expiresAt: Date.now() + 60_000 },
  });
  (nativeFetch as jest.Mock).mockResolvedValue({
    status: 204,
    headers: new Headers({ "X-Aurral-Remote": "1" }),
  });
  const signal = new AbortController().signal;
  const remoteKey = await sendTvSetup(link, server, headers, signal);
  expect(remoteKey).toMatch(/^[a-f0-9]{64}$/);
  expect(api.post).toHaveBeenCalledWith("/auth/pairing-codes", undefined, {
    signal,
  });
  expect(nativeFetch).toHaveBeenCalledWith(
    `http://192.168.1.4:4567/v1/setup/${link.id}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      credentials: "omit",
      redirect: "error",
      signal,
      body: expect.any(String),
    },
  );
  const body = (nativeFetch as jest.Mock).mock.calls[0][1].body;
  expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  const plain = openPayload(body);
  expect(JSON.parse(new TextDecoder().decode(plain!))).toEqual({
    v: 1,
    id: link.id,
    serverUrl: server,
    code,
    customHeaders: headers,
    remoteKey,
  });
  expect(openPayload(body, new Uint8Array(32).fill(9))).toBeNull();
  expect(sealTvSetup(link, server, code, headers)).not.toBe(body);
});
it("rejects low-order TV keys, oversized messages, and invalid pairing codes", () => {
  expect(() =>
    sealTvSetup({ ...link, key: "A".repeat(43) }, server, code, headers),
  ).toThrow();
  expect(() => sealTvSetup(link, server, "token", headers)).toThrow();
  expect(() =>
    sealTvSetup(
      link,
      server,
      code,
      Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => ["Header" + i, "a".repeat(4096)]),
      ),
    ),
  ).toThrow();
});
it.each<Record<string, string>>([
  { Authorization: "Bearer test" },
  { "Set-Cookie": "auth=test" },
  { Host: "test" },
  { Proxy: "a", proxy: "b" },
  { "X-Test": "a\rb" },
  { Connection: "close" },
])("rejects reserved or malformed headers", (value) => {
  expect(validTvSettings(server, value)).toBe(false);
});
it.each([
  "file:///x",
  "https://user:password@host",
  "https://host/?secret",
  "https://host/#x",
  "https://host\\@example",
])("rejects unsafe server URL %s", (url) => {
  expect(validTvSettings(url, headers)).toBe(false);
});
it("refuses to issue a code for a public destination and never sends if the challenge is cancelled mid-issuance", async () => {
  const controller = new AbortController();
  await expect(
    sendTvSetup(
      { ...link, address: "1.1.1.1" },
      server,
      headers,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
  (api.post as jest.Mock).mockImplementation(async () => {
    controller.abort();
    return { data: { code, expiresAt: Date.now() + 60_000 } };
  });
  await expect(
    sendTvSetup(link, server, headers, controller.signal),
  ).rejects.toThrow();
  expect(nativeFetch).not.toHaveBeenCalled();
});
