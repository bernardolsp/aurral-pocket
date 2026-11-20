import { continueOnPhone } from "@/lib/tv/handback";
import { editTvQueue, readTvSnapshot } from "@/lib/tv/remote";
import { resume, seekTo, takeOverQueue } from "@/lib/player/player";
jest.mock("@/lib/tv/remote", () => ({
  readTvSnapshot: jest.fn(),
  editTvQueue: jest.fn(),
}));
jest.mock("@/lib/player/player", () => ({
  resume: jest.fn(),
  seekTo: jest.fn(),
  takeOverQueue: jest.fn(),
}));
jest.mock("@/lib/api/client", () => ({
  buildAuthenticatedUrl: (p: string) => "https://phone.example/api" + p,
}));
const tv = {
  address: "10.0.0.3",
  serverUrl: "https://phone.example",
  userId: 1,
  key: "12".repeat(32),
};
const item = {
  id: "song",
  title: "Song",
  albumName: "Album",
  artist: "Artist",
  entryId: "a",
  durationMs: 200000,
  streamPath: "/library/stream/2/1",
};
const state = {
  sessionId: "s",
  revision: 5,
  playing: true,
  positionMs: 10000,
  durationMs: 200000,
  currentEntryId: "a",
  index: 1,
  canSeek: true,
  entries: [{ ...item, entryId: "old" }, item, { ...item, entryId: "b" }],
};
beforeEach(() => {
  jest.resetAllMocks();
  (takeOverQueue as jest.Mock).mockResolvedValue("loaded");
  (editTvQueue as jest.Mock).mockResolvedValue({
    playing: false,
    title: "Song",
  });
});
it("loads current and remaining tracks silently, then continues at the TV pause point, preserving duplicate entries", async () => {
  (readTvSnapshot as jest.Mock)
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({ ...state, playing: false, positionMs: 11200 });
  await continueOnPhone(tv, () => true);
  expect(takeOverQueue).toHaveBeenCalledWith(
    expect.objectContaining({
      startId: "song",
      positionSeconds: 10,
      items: [
        expect.objectContaining({ id: "song", albumRef: "2" }),
        expect.objectContaining({ id: "tv:b" }),
      ],
    }),
    { play: false },
  );
  expect(editTvQueue).toHaveBeenCalledWith(tv, "s", {
    action: "handoffPause",
    entryId: "a",
    revision: 5,
  });
  expect(seekTo).toHaveBeenCalledWith(11.2);
  expect(resume).toHaveBeenCalledTimes(1);
});
it("preserves the TV's new track when the queue changes during local preparation", async () => {
  (readTvSnapshot as jest.Mock)
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({ ...state, currentEntryId: "b", revision: 6 });
  await expect(continueOnPhone(tv, () => true)).rejects.toThrow(/changed/);
  expect(editTvQueue).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
});
it("keeps the TV running when Pocket cannot load the queue", async () => {
  (readTvSnapshot as jest.Mock).mockResolvedValueOnce(state);
  (takeOverQueue as jest.Mock).mockRejectedValueOnce(
    new Error("No audio route"),
  );
  await expect(continueOnPhone(tv, () => true)).rejects.toThrow(
    "No audio route",
  );
  expect(editTvQueue).not.toHaveBeenCalled();
});

it("continues at the last confirmed position if the final poll fails after the guarded pause ACK", async () => {
  (readTvSnapshot as jest.Mock)
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({ ...state, positionMs: 10750 })
    .mockRejectedValueOnce(new Error("Wi-Fi disconnected"));
  await continueOnPhone(tv, () => true);
  expect(seekTo).toHaveBeenCalledWith(10.75);
  expect(resume).toHaveBeenCalledTimes(1);
});
it("keeps Pocket silent when the TV pause acknowledgment is lost", async () => {
  (readTvSnapshot as jest.Mock).mockResolvedValue(state);
  (editTvQueue as jest.Mock).mockRejectedValueOnce(
    new Error("Wi-Fi disconnected"),
  );
  await expect(continueOnPhone(tv, () => true)).rejects.toThrow();
  expect(resume).not.toHaveBeenCalled();
});
