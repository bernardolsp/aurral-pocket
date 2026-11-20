import { fetch as nativeFetch } from "expo/fetch";
import { issueTvPairingCode } from "@/lib/api/auth";
import { validTvLink, type TvLink } from "./pairing-link";
import { fromByteArray, toByteArray } from "base64-js";
import { getRandomValues } from "expo-crypto";
import nacl from "tweetnacl";

const reservedNames = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "authorization",
  "proxy-authorization",
  "set-cookie",
  "accept",
  "accept-encoding",
  "range",
  "host",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
  "upgrade",
  "expect",
  "trailer",
  "te",
  "keep-alive",
]);

export function validTvSettings(
  serverUrl: string,
  customHeaders: Record<string, string>,
) {
  if (
    serverUrl.length > 2048 ||
    !/^https?:\/\//i.test(serverUrl) ||
    /[?#\\\s]/.test(serverUrl)
  )
    return false;
  try {
    const url = new URL(serverUrl);
    if (
      !serverUrl.split("/")[2] ||
      !url.host ||
      url.username ||
      url.password ||
      serverUrl.split("/")[2]?.includes("@")
    )
      return false;
  } catch {
    return false;
  }
  if (
    !customHeaders ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(customHeaders))
  )
    return false;
  const entries = Object.entries(customHeaders);
  const seen = new Set<string>();
  return (
    entries.length <= 32 &&
    entries.every(([name, value]) => {
      const lower = name.toLowerCase();
      if (seen.has(lower) || reservedNames.has(lower)) return false;
      seen.add(lower);
      return (
        /^[!#$%&'*+.^_`|~a-zA-Z0-9-]{1,128}$/.test(name) &&
        typeof value === "string" &&
        /^[ -~]{0,4096}$/.test(value)
      );
    })
  );
}

export function tvFingerprint(link: TvLink) {
  const digest = nacl.hash(toByteArray(link.key + "=")).slice(0, 6);
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8)].join("-");
}

export function sealTvSetup(
  link: TvLink,
  serverUrl: string,
  code: string,
  customHeaders: Record<string, string>,
) {
  if (
    !validTvLink(link) ||
    !validTvSettings(serverUrl, customHeaders) ||
    !/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code)
  )
    throw new Error("Invalid TV setup data");
  const key = toByteArray(link.key + "=");
  const nonce = getRandomValues(new Uint8Array(nacl.box.nonceLength));
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ v: 1, id: link.id, serverUrl, code, customHeaders }),
  );
  const random = getRandomValues(new Uint8Array(nacl.box.secretKeyLength));
  const { publicKey, secretKey } = nacl.box.keyPair.fromSecretKey(random);
  random.fill(0);
  try {
    // X25519's all-zero shared secret means this is a low-order public key.
    const shared = nacl.scalarMult(secretKey, key);
    const invalid = shared.every((byte) => byte === 0);
    shared.fill(0);
    if (invalid) throw new Error("Invalid TV key");
    const ciphertext = nacl.box(plaintext, nonce, key, secretKey);
    const envelope = new Uint8Array(
      publicKey.length + nonce.length + ciphertext.length,
    );
    envelope.set(publicKey);
    envelope.set(nonce, publicKey.length);
    envelope.set(ciphertext, publicKey.length + nonce.length);
    const body = fromByteArray(envelope)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (body.length > 24 * 1024)
      throw new Error("TV setup exceeds the transfer limit");
    return body;
  } finally {
    secretKey.fill(0);
    plaintext.fill(0);
  }
}

export async function sendTvSetup(
  link: TvLink,
  serverUrl: string,
  customHeaders: Record<string, string>,
  signal: AbortSignal,
) {
  if (
    signal.aborted ||
    !validTvLink(link) ||
    !validTvSettings(serverUrl, customHeaders)
  )
    throw new Error("Invalid TV setup");
  const { code, expiresAt } = await issueTvPairingCode(signal);
  if (signal.aborted || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
    throw new Error("Pairing code expired");
  const body = sealTvSetup(link, serverUrl, code, customHeaders);
  if (signal.aborted) throw new Error("TV setup cancelled");
  // expo/fetch implements redirect:error and credentials:omit on both platforms.
  // Never use the authenticated Aurral API client for this second destination.
  const result = await nativeFetch(
    `http://${link.address}:${link.port}/v1/setup/${link.id}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      credentials: "omit",
      redirect: "error",
      body,
      signal,
    },
  );
  if (result.status !== 204) throw new Error("TV did not accept setup");
}
