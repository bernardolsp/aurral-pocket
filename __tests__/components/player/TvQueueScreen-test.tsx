import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { TvQueueScreen } from "@/components/player/TvQueueScreen";
import {
  resetTvOutput,
  getTvOutput,
  updateTvOutput,
} from "@/lib/player/tv-output";
import {
  getTvRemote,
  readTvSnapshot,
  editTvQueue,
  type TvSnapshot,
} from "@/lib/tv/remote";
import { continueOnPhone } from "@/lib/tv/handback";
import { getFlowStatus } from "@/lib/api/flow";
jest.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { id: 3 },
    serverUrl: "https://music.example",
    token: "session",
  }),
}));
jest.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: jest.requireActual("react-native").View,
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: jest.requireActual("react-native").View,
}));
jest.mock("react-native-reanimated", () => ({ runOnJS: (fn: unknown) => fn }));
jest.mock("@/components/library/CoverArtImage", () => ({
  CoverArtImage: () => null,
}));
jest.mock("@react-native-community/slider", () => () => null);
jest.mock("@/lib/tv/remote", () => ({
  getTvRemote: jest.fn(),
  readTvSnapshot: jest.fn(),
  editTvQueue: jest.fn(),
  controlTv: jest.fn(),
}));
jest.mock("@/lib/tv/handback", () => ({ continueOnPhone: jest.fn() }));
jest.mock("@/lib/api/flow", () => ({ getFlowStatus: jest.fn() }));
jest.mock("react-native-reorderable-list", () => {
  const { View, Pressable } = jest.requireActual("react-native");
  return {
    __esModule: true,
    useReorderableDrag: () => () => {},
    reorderItems: (items: unknown[], from: number, to: number) => {
      const copy = [...items];
      copy.splice(to, 0, ...copy.splice(from, 1));
      return copy;
    },
    default: ({ data, ListHeaderComponent, renderItem, onReorder }: any) => (
      <View>
        {ListHeaderComponent}
        {data.map((item: any) => (
          <View key={item.entryId}>{renderItem({ item })}</View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Drop row last"
          onPress={() => onReorder({ from: 0, to: 1 })}
        />
      </View>
    ),
  };
});
const remote = {
  serverUrl: "https://music.example",
  address: "192.168.1.3",
  userId: 3,
  key: "12".repeat(32),
};
const track = {
  id: "song",
  title: "Current",
  artist: "Artist",
  entryId: "1",
  albumName: "Album",
  artworkPath: null,
  durationMs: 120000,
  streamPath: "/library/stream/1/1",
  transcode: true,
};
const state: TvSnapshot = {
  sessionId: "s",
  revision: 5,
  playing: true,
  index: 0,
  total: 3,
  positionMs: 10000,
  canSeek: true,
  buffering: false,
  durationMs: 120000,
  currentEntryId: "1",
  shuffle: false,
  collectionId: null,
  flowId: null,
  flowName: null,
  entries: [
    track,
    { ...track, title: "Second", entryId: "2" },
    { ...track, title: "Third", entryId: "3" },
  ],
};
const close = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  resetTvOutput();
  (getTvRemote as jest.Mock).mockResolvedValue(remote);
  (readTvSnapshot as jest.Mock).mockResolvedValue(state);
});
async function open() {
  await render(<TvQueueScreen onClose={close} />);
  await screen.findByText("Current");
}
it("selects an existing TV session and reflects physical skip while the controller is open", async () => {
  await open();
  expect(getTvOutput().selected).toBe(true);
  await act(() =>
    updateTvOutput(remote, {
      ...state,
      currentEntryId: "2",
      revision: 6,
      index: 1,
    }),
  );
  expect(screen.getByText("Up next · 1")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play Third" })).toBeTruthy();
});
it("sends entry IDs when dragging, even after another screen changes the queue", async () => {
  await open();
  await fireEvent(screen.getByLabelText("Drag to reorder Second"), "longPress");
  await act(() =>
    updateTvOutput(remote, {
      ...state,
      revision: 6,
      index: 1,
      currentEntryId: "2",
    }),
  );
  await fireEvent.press(screen.getByLabelText("Drop row last"));
  expect(editTvQueue).toHaveBeenCalledWith(remote, "s", {
    action: "move",
    entryId: "2",
    beforeEntryId: null,
  });
});
it("edits shuffle and picks a named Flow; leaving TV controls keeps playback running", async () => {
  (getFlowStatus as jest.Mock).mockResolvedValue({
    flows: [{ id: "jazz", name: "Late-night jazz" }],
  });
  await open();
  await fireEvent.press(screen.getByLabelText("Shuffle upcoming songs"));
  expect(editTvQueue).toHaveBeenCalledWith(remote, "s", {
    action: "shuffle",
    enabled: true,
  });
  await fireEvent.press(screen.getByText("Keep playing with a Flow"));
  await fireEvent.press(await screen.findByText("Late-night jazz"));
  expect(editTvQueue).toHaveBeenCalledWith(remote, "s", {
    action: "flow",
    flowId: "jazz",
  });
  await fireEvent.press(screen.getByText("Leave TV controls"));
  expect(getTvOutput().selected).toBe(false);
  expect(close).toHaveBeenCalled();
  expect(continueOnPhone).not.toHaveBeenCalled();
});
