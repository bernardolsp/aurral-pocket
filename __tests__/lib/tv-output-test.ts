import {
  clearTvOutput,
  getTvOutput,
  markTvUnreachable,
  resetTvOutput,
  selectTvOutput,
  updateTvOutput,
} from "@/lib/player/tv-output";
import type { TvRemote, TvSnapshot } from "@/lib/tv/remote";

const remote: TvRemote = {
  key: "fixture",
  address: "192.168.1.42",
  userId: 1,
  serverUrl: "http://aurral.test",
};
const status: TvSnapshot = {
  sessionId: "queue",
  currentEntryId: "one",
  revision: 4,
  index: 0,
  total: 1,
  playing: true,
  positionMs: 1000,
  durationMs: 30000,
  buffering: false,
  canSeek: true,
  shuffle: false,
  flowId: null,
  flowName: null,
  collectionId: null,
  entries: [
    {
      entryId: "one",
      id: "job",
      title: "Song",
      artist: "Artist",
      albumName: null,
      artworkPath: null,
      durationMs: 30000,
      streamPath: "/playlists/stream/job",
      transcode: true,
    },
  ],
};
beforeEach(resetTvOutput);

it("offers an existing TV session without selecting it for library edits", () => {
  updateTvOutput(remote, status);
  expect(getTvOutput()).toMatchObject({
    selected: false,
    reachable: true,
    status,
  });
  selectTvOutput(remote, status);
  updateTvOutput(remote, { ...status, revision: 3, shuffle: true });
  expect(getTvOutput().status?.shuffle).toBe(false);
  markTvUnreachable(remote);
  expect(getTvOutput()).toMatchObject({ selected: true, reachable: false });
});

it("leaving a TV queue suppresses rejoining until a new session starts or a listener joins", () => {
  selectTvOutput(remote, status);
  clearTvOutput();
  updateTvOutput(remote, status);
  expect(getTvOutput().remote).toBeNull();
  updateTvOutput(remote, { ...status, sessionId: "another" });
  expect(getTvOutput().status?.sessionId).toBe("another");
  selectTvOutput(remote, status);
  expect(getTvOutput().selected).toBe(true);
});
