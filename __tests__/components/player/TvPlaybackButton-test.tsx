import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { TvPlaybackButton } from "@/components/player/TvPlaybackButton";
import { useAuth } from "@/contexts/auth-context";
import {
  currentPosition,
  getQueueSnapshot,
  isPlaybackActive,
  pause,
} from "@/lib/player/player";
import type { PlayerTrack } from "@/lib/player/track-item";
import { controlTv, getTvRemote, playQueueOnTv } from "@/lib/tv/remote";

jest.mock("@/contexts/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("@/lib/tv/remote", () => ({
  controlTv: jest.fn(),
  getTvRemote: jest.fn(),
  playQueueOnTv: jest.fn(),
}));
jest.mock("@/lib/player/player", () => ({
  currentPosition: jest.fn(),
  getQueueSnapshot: jest.fn(),
  isPlaybackActive: jest.fn(),
  pause: jest.fn(),
}));
jest.mock("@/components/ui/AppSheet", () => {
  const { View } = jest.requireActual("react-native");
  return {
    AppSheet: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});
jest.mock("@gorhom/bottom-sheet", () => ({
  BottomSheetScrollView: jest.requireActual("react-native").ScrollView,
}));

const one = {
  id: "1",
  title: "One",
  streamPath: "/library/stream/album/1",
} as PlayerTrack;
const two = {
  id: "2",
  title: "Two",
  streamPath: "/library/stream/album/2",
} as PlayerTrack;
const clip = { ...one, id: "clip", isPreview: true };
const remote = {
  address: "10.0.1.8",
  serverUrl: "https://music.example",
  userId: 8,
  key: "test",
};
const signedIn = {
  serverUrl: remote.serverUrl,
  user: { id: 8 },
  token: "phone-session",
};
const silent = { title: "", playing: false };
const playing = { title: "Two", playing: true };
const current = { kind: "current", title: "Two" } as const;
const collection = {
  kind: "collection",
  title: "My mix",
  id: "flow-42",
  getTracks: () => [clip, two],
} as const;
const readRemote = getTvRemote as jest.Mock,
  control = controlTv as jest.Mock,
  send = playQueueOnTv as jest.Mock;
const queue = getQueueSnapshot as jest.Mock;
const press = async (label: string) =>
  fireEvent.press(await screen.findByRole("button", { name: label }));
async function open(source: typeof current | typeof collection = current) {
  const view = await render(<TvPlaybackButton source={source} />);
  await press("Play on TV");
  return view;
}
beforeEach(() => {
  jest.resetAllMocks();
  (useAuth as jest.Mock).mockReturnValue(signedIn);
  readRemote.mockResolvedValue(remote);
  control.mockResolvedValue(silent);
  send.mockResolvedValue(playing);
  queue.mockReturnValue({ currentId: "2", items: [one, two] });
  (currentPosition as jest.Mock).mockReturnValue(12.345);
  (isPlaybackActive as jest.Mock).mockReturnValue(true);
});

it("looks up the current account and sends the current queue at its live position only after a tap", async () => {
  let acknowledge!: (reply: typeof playing) => void;
  send.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  await open();
  expect(readRemote).toHaveBeenCalledWith(remote.serverUrl, 8);
  expect(control).toHaveBeenCalledWith(remote, { action: "status" });
  expect(send).not.toHaveBeenCalled();
  await press("Play “Two” on TV");
  expect(send).toHaveBeenCalledWith(remote, [one, two], 1, 12345);
  expect(pause).not.toHaveBeenCalled();
  await act(() => acknowledge(playing));
  expect(pause).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Playing on TV")).toBeTruthy();
});
it("leaves subsequent local tracks playing when a TV acknowledgment arrives late", async () => {
  send.mockImplementation(async () => {
    queue.mockReturnValue({ currentId: "1", items: [one, two] });
    return playing;
  });
  await open();
  await press("Play “Two” on TV");
  expect(pause).not.toHaveBeenCalled();
});
it("leaves local audio playing when the TV rejects playback or acknowledges without playing", async () => {
  send
    .mockRejectedValueOnce(new Error("Aurral TV could not start this queue."))
    .mockResolvedValueOnce({ ...playing, playing: false });
  await open();
  await press("Play “Two” on TV");
  expect(
    screen.getByText("Aurral TV could not start this queue."),
  ).toBeTruthy();
  await press("Play “Two” on TV");
  expect(pause).not.toHaveBeenCalled();
});
it("starts a playlist or Flow at its first downloaded track without touching local playback", async () => {
  await open(collection);
  await press("Play “My mix” on TV");
  expect(send).toHaveBeenCalledWith(remote, [two], 0, 0, "flow-42");
  expect(queue).not.toHaveBeenCalled();
  expect(pause).not.toHaveBeenCalled();
});
it("controls existing TV playback without transferring or changing the phone’s queue", async () => {
  control.mockResolvedValue(playing);
  await open();
  control.mockResolvedValue({ ...playing, playing: false });
  await press("Pause TV");
  control.mockResolvedValue(playing);
  await press("Resume TV");
  await press("Next on TV");
  await press("Previous on TV");
  await press("Refresh TV status");
  expect(control.mock.calls.map((call) => call[1].action)).toEqual([
    "status",
    "pause",
    "resume",
    "next",
    "previous",
    "status",
  ]);
  expect(send).not.toHaveBeenCalled();
  expect(pause).not.toHaveBeenCalled();
});
it("explains missing pairing and offers retry when a paired TV is unreachable", async () => {
  control.mockRejectedValueOnce(new Error("unreachable"));
  await open();
  expect(screen.getByText(/same local network/)).toBeTruthy();
  readRemote.mockResolvedValue(null);
  await press("Try again");
  expect(screen.getByText(/scan its QR code/i)).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
});
it("discards the previous account's TV and pending local pause on an account switch", async () => {
  let acknowledge!: (reply: typeof playing) => void;
  send.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  const view = await open();
  await press("Play “Two” on TV");
  (useAuth as jest.Mock).mockReturnValue({ ...signedIn, user: { id: 9 } });
  readRemote.mockResolvedValue(null);
  await view.rerender(<TvPlaybackButton source={current} />);
  await act(() => acknowledge(playing));
  expect(readRemote).toHaveBeenLastCalledWith(remote.serverUrl, 9);
  expect(pause).not.toHaveBeenCalled();
});
