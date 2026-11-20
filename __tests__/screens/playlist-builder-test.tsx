import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { PlaylistBuilderScreen } from "@/components/flow/PlaylistBuilderScreen";
import { useServerHealth } from "@/hooks/auth/use-server-health";
import { api } from "@/lib/api/client";

jest.mock("@/hooks/auth/use-server-health", () => ({
  useServerHealth: jest.fn(),
}));
jest.mock("@/hooks/auth/use-has-permission", () => ({
  useHasPermission: () => () => true,
}));
jest.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("@/lib/api/client", () => ({
  serverImageSource: jest.fn(() => null),
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock("@/hooks/search/use-debounced-value", () => ({
  useDebouncedValue: (term: string) => term,
}));
jest.mock("burnt", () => ({ toast: jest.fn() }));
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("@/components/flow/SegmentedRow", () => {
  const { Text } = require("react-native");
  return {
    SegmentedRow: ({
      options,
      onChange,
    }: {
      options: { value: string; label: string }[];
      onChange: (source: string) => void;
    }) =>
      options.map((option) => (
        <Text key={option.value} onPress={() => onChange(option.value)}>
          {option.label}
        </Text>
      )),
  };
});

const main = { name: "The Roots", mbid: null, libraryArtistId: 12 };
const related = { name: "Erykah Badu", mbid: null, libraryArtistId: 13 };
const seed = {
  id: "track:1",
  trackName: "You Got Me",
  artistName: main.name,
  albumName: "Things Fall Apart",
  source: "library",
};
const extra = {
  ...seed,
  id: "track:2",
  trackName: "Next Lifetime",
  artistName: related.name,
  albumName: "Baduizm",
};
const mockGet = api.get as jest.Mock,
  mockPost = api.post as jest.Mock;

async function open() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  await render(
    <QueryClientProvider client={client}>
      <PlaylistBuilderScreen />
    </QueryClientProvider>,
  );
}

async function chooseMain() {
  await fireEvent.changeText(
    screen.getByLabelText("Find a main artist"),
    "Roots",
  );
  await fireEvent.press(await screen.findByRole("button", { name: main.name }));
  await screen.findByRole("checkbox", { name: /You Got Me/ });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useServerHealth as jest.Mock).mockReturnValue({
    data: { api: { features: ["playlistBuilder"] } },
  });
  mockGet.mockResolvedValue({ data: { artists: [main] } });
  mockPost.mockImplementation(async (path: string) => {
    if (path.endsWith("/options"))
      return { data: { tracks: [seed], similarArtists: [related] } };
    if (path.endsWith("/preview"))
      return { data: { tracks: [seed, extra], missingArtists: [] } };
    if (path.endsWith("/save"))
      return { data: { queued: true, playlistId: "mix", operationId: "op" } };
    throw new Error(path);
  });
});

it("gates deep links on the server capability", async () => {
  (useServerHealth as jest.Mock).mockReturnValue({
    data: { api: { features: [] } },
  });
  await open();
  expect(
    screen.getByText("Your server does not offer Playlist Builder."),
  ).toBeTruthy();
  expect(mockGet).not.toHaveBeenCalled();
});

it("previews a seeded mix and queues exactly the named, accepted tracks", async () => {
  await open();
  await chooseMain();
  expect(mockGet).toHaveBeenCalledWith("/playlists/builder/artists", {
    params: { source: "library", q: "Roots" },
    signal: expect.anything(),
  });
  await fireEvent.press(screen.getByRole("checkbox", { name: /You Got Me/ }));
  await fireEvent.press(screen.getByRole("button", { name: related.name }));
  await fireEvent.press(screen.getByText("Preview playlist"));
  expect(mockPost).toHaveBeenCalledWith("/playlists/builder/preview", {
    source: "library",
    artist: main,
    seedTrackIds: [seed.id],
    similarArtists: [related],
    size: 20,
  });
  await screen.findByText("Found 2 of 20 requested songs.");
  await fireEvent.press(
    screen.getByRole("checkbox", { name: /Next Lifetime/ }),
  );
  await fireEvent.changeText(
    screen.getByLabelText("Playlist name"),
    "  Philadelphia  ",
  );
  await fireEvent.press(screen.getByText("Save 1 song"));
  expect(mockPost).toHaveBeenCalledWith("/playlists/builder/save", {
    source: "library",
    name: "Philadelphia",
    tracks: [seed],
  });
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(
      "/(app)/(tabs)/(library)/playlists",
    ),
  );
});

it("clears artist and seed choices when switching sources", async () => {
  await open();
  await chooseMain();
  await fireEvent.press(screen.getByRole("checkbox", { name: /You Got Me/ }));
  await fireEvent.press(screen.getByText("Library + discovery"));
  expect(screen.queryByText("Preview playlist")).toBeNull();
  await chooseMain();
  expect(mockGet).toHaveBeenLastCalledWith("/playlists/builder/artists", {
    params: { source: "discovery", q: "Roots" },
    signal: expect.anything(),
  });
  expect(
    screen.getByRole("checkbox", { name: /You Got Me/ }),
  ).not.toBeChecked();
});
