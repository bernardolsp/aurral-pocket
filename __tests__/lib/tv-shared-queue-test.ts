import { randomFillSync } from "node:crypto";
import { fetch as nativeFetch } from "expo/fetch";
import { getRandomValues } from "expo-crypto";
import { readTvSnapshot, enqueueOnTv, editTvQueue } from "@/lib/tv/remote";
import { sealRemote, openRemote } from "@/lib/tv/remote-envelope";
import type { PlayerTrack } from "@/lib/player/track-item";

jest.mock("expo-crypto", () => ({ getRandomValues: jest.fn() }));
const remote = {
  address: "172.16.1.40",
  serverUrl: "https://music.example",
  key: "12".repeat(32),
  userId: 5,
};
const challenge = "02".repeat(16);
const one = {
  entryId: "a",
  id: "song",
  title: "Song",
  artist: "Artist",
  albumName: "Album",
  streamPath: "/api/library/stream/1/2",
  durationMs: 200000,
  artworkPath: null,
  transcode: true,
};
const two = { ...one, entryId: "b" };
const page = {
  sessionId: "s",
  revision: 9,
  currentEntryId: "a",
  index: 0,
  total: 2,
  positionMs: 5000,
  durationMs: 200000,
  playing: true,
  buffering: false,
  canSeek: true,
  shuffle: false,
  flowId: null,
  flowName: null,
  collectionId: null,
  entries: [one],
  offset: 0,
};
let commands: Record<string, unknown>[];
beforeEach(() => {
  jest.clearAllMocks();
  commands = [];
  (getRandomValues as jest.Mock).mockImplementation(randomFillSync);
});
function answer(snapshot?: unknown) {
  (nativeFetch as jest.Mock)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ challenge }) })
    .mockImplementationOnce(async (_url, opts) => {
      commands.push(
        openRemote(opts.body, remote.key) as Record<string, unknown>,
      );
      const text = sealRemote(
        {
          kind: "reply",
          v: 1,
          challenge,
          ok: true,
          playing: true,
          title: "Song",
          snapshot,
        },
        remote.key,
        randomFillSync,
      );
      return { ok: true, headers: new Headers(), text: async () => text };
    });
}
it("hydrates pages of duplicate songs by queue entry, then reuses the list for position-only changes", async () => {
  answer(page);
  answer({ ...page, offset: 1, entries: [two] });
  const first = await readTvSnapshot(remote);
  expect(commands[1]).toMatchObject({
    action: "snapshot",
    sessionId: "s",
    revision: 9,
    offset: 1,
  });
  expect(first.entries.map((t) => t.entryId)).toEqual(["a", "b"]);
  expect(first.entries[0].streamPath).toBe("/library/stream/1/2");
  answer({ ...page, entries: [], positionMs: 9000, unchanged: true });
  const advanced = await readTvSnapshot(remote, first);
  expect(commands[2]).toMatchObject({ knownRevision: 9, knownSessionId: "s" });
  expect(advanced.entries).toBe(first.entries);
  expect(advanced.positionMs).toBe(9000);
});
it("discards a mixed-revision page and rejects URLs before phone credentials can be applied", async () => {
  answer(page);
  answer({ ...page, revision: 10, offset: 1, entries: [two] });
  await expect(readTvSnapshot(remote)).rejects.toThrow(/changed/);
  for (const streamPath of [
    "https://other.example/music",
    "/library/stream/1/%2e%2e",
    "/library/stream/1/x?token=old",
  ]) {
    answer({ ...page, total: 1, entries: [{ ...one, streamPath }] });
    await expect(readTvSnapshot(remote)).rejects.toThrow();
  }
});
it("addresses edits by occurrence and session and queues only playable library paths", async () => {
  answer();
  await editTvQueue(remote, "s", {
    action: "move",
    entryId: "b",
    beforeEntryId: "a",
  });
  answer();
  await enqueueOnTv(
    remote,
    [
      {
        ...one,
        streamPath: "/library/stream/1/2",
        url: "private-token",
        duration: 123,
      } as unknown as PlayerTrack,
    ],
    "next",
    "s",
  );
  expect(commands[0]).toMatchObject({
    action: "move",
    sessionId: "s",
    entryId: "b",
    beforeEntryId: "a",
  });
  expect(commands[1]).toMatchObject({
    action: "enqueue",
    placement: "next",
    sessionId: "s",
    tracks: [{ streamPath: "/library/stream/1/2", durationMs: 123000 }],
  });
  expect(JSON.stringify(commands)).not.toContain("private-token");
});
