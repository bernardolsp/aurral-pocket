import { randomFillSync } from "node:crypto";
import { fetch as nativeFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { getRandomValues } from "expo-crypto";
import type { PlayerTrack } from "@/lib/player/track-item";
import { controlTv, playQueueOnTv } from "@/lib/tv/remote";
import { getTvRemote } from "@/lib/tv/remote-store";
import { sealRemote, openRemote } from "@/lib/tv/remote-envelope";

jest.mock("expo-crypto", () => ({ getRandomValues: jest.fn() }));
const tv = {
  serverUrl: "https://music.example",
  userId: 4,
  address: "192.168.1.40",
  key: "42".repeat(32),
};
const challenge = "ab".repeat(16);
const state = { playing: true, title: "Current" };
const song = {
  id: "x",
  title: "Current",
  artist: "Artist",
  album: "Album",
  duration: 120,
  url: "https://music.example/private?token=phone-token",
  streamPath: "/library/stream/1/2",
  coverPath: "/api/library/albums/1/cover?v=123",
  artwork: null,
} as PlayerTrack;

beforeEach(() => {
  jest.clearAllMocks();
  (getRandomValues as jest.Mock).mockImplementation(randomFillSync);
});
function respond(replyChallenge = challenge) {
  (nativeFetch as jest.Mock)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ challenge }) })
    .mockImplementationOnce(async (_url, opts) => {
      const cmd = openRemote(opts.body, tv.key) as Record<string, unknown>;
      expect(cmd).toMatchObject({ v: 1, kind: "command", challenge });
      const text = sealRemote(
        { v: 1, kind: "reply", challenge: replyChallenge, ok: true, ...state },
        tv.key,
        randomFillSync,
      );
      return { ok: true, headers: new Headers(), text: async () => text };
    });
}
it("transfers the current song, real next song, album art and position without phone stream URLs", async () => {
  respond();
  await expect(
    playQueueOnTv(
      tv,
      [{ ...song, isPreview: true }, song, { ...song, id: "y" }],
      1,
      14500,
    ),
  ).resolves.toEqual(state);
  const [url, opts] = (nativeFetch as jest.Mock).mock.calls[1];
  expect(url).toBe(`http://${tv.address}:44685/v1/remote/${challenge}`);
  expect(opts.headers).toEqual({ "Content-Type": "application/octet-stream" });
  expect(opts.credentials).toBe("omit");
  const payload = openRemote(opts.body, tv.key) as {
    tracks: object[];
    index: number;
    positionMs: number;
  };
  expect(payload.index).toBe(0);
  expect(payload.positionMs).toBe(14500);
  expect(payload.tracks).toHaveLength(2);
  expect(payload.tracks[0]).toMatchObject({
    id: "x",
    artworkPath: song.coverPath,
    streamPath: song.streamPath,
  });
  expect(JSON.stringify(payload)).not.toContain("phone-token");
});
it("requires a reply for this command and an authenticated ciphertext", async () => {
  respond("c0".repeat(16));
  await expect(controlTv(tv, { action: "pause" })).rejects.toThrow();
  const wire = sealRemote({ hello: 1 }, tv.key, randomFillSync);
  expect(() => openRemote(wire, "cb".repeat(32))).toThrow();
});
it("restricts stored destinations to this account and a private LAN IP", async () => {
  jest.spyOn(SecureStore, "getItemAsync").mockResolvedValue(JSON.stringify(tv));
  await expect(getTvRemote(tv.serverUrl, tv.userId)).resolves.toEqual(tv);
  await expect(getTvRemote(tv.serverUrl, 12)).resolves.toBeNull();
  await expect(
    getTvRemote("https://other.example", tv.userId),
  ).resolves.toBeNull();
  await expect(
    controlTv({ ...tv, address: "example.org" }, { action: "status" }),
  ).rejects.toThrow();
  expect(nativeFetch).not.toHaveBeenCalled();
});
