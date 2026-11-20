import { Alert } from "react-native";
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
  expect(screen.queryByLabelText("Online recommendations")).toBeNull();
  expect(screen.queryByRole("button", { name: "Advanced options" })).toBeNull();
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

const discovery = {
  id: "catalog:9",
  recordingMbid: "01cec5ee-f93f-4dec-990f-76ada77788b8",
  source: "discovery",
  trackName: "The Light",
  artistName: "Common",
  albumName: "Like Water for Chocolate",
};

function enableRecommendations(exploreFurther = false) {
  (useServerHealth as jest.Mock).mockReturnValue({
    data: {
      api: {
        features: [
          "playlistBuilder",
          "playlistBuilderRecommendations",
          ...(exploreFurther ? ["playlistBuilderExploreFurther"] : []),
        ],
      },
    },
  });
}

async function turnRecommendationsOff() {
  await fireEvent(
    screen.getByLabelText("Online recommendations"),
    "valueChange",
    false,
  );
}

async function pickSeedsAndPreview() {
  await chooseMain();
  await fireEvent.press(screen.getByRole("checkbox", { name: /You Got Me/ }));
  await fireEvent.press(screen.getByRole("button", { name: related.name }));
  await fireEvent.press(screen.getByText("Preview playlist"));
  await screen.findByText("Edit mix");
}

function serveSuggestions(cached: boolean) {
  mockPost.mockImplementation(async (path: string, recipe) => {
    if (path.endsWith("/options"))
      return { data: { tracks: [seed], similarArtists: [related] } };
    if (path.endsWith("/preview")) {
      const fromCatalog = recipe.source === "discovery";
      return {
        data: {
          tracks: fromCatalog ? [seed, extra, discovery] : [seed, extra],
          missingArtists: [],
          recommendationBasis: "recording",
          discoveryTeaser:
            !fromCatalog && (cached || recipe.recommendationMode === "online")
              ? [discovery]
              : [],
        },
      };
    }
    if (path.endsWith("/save"))
      return { data: { queued: true, playlistId: "p", operationId: "o" } };
    throw new Error(path);
  });
}

it("recommends online by default while saving only the reviewed Library songs", async () => {
  enableRecommendations();
  serveSuggestions(false);
  await open();
  await pickSeedsAndPreview();
  expect(mockPost).toHaveBeenCalledWith("/playlists/builder/preview", {
    source: "library",
    recommendationMode: "online",
    artist: main,
    seedTrackIds: [seed.id],
    similarArtists: [related],
    size: 20,
  });
  expect(screen.getByText(discovery.trackName)).toBeTruthy();
  expect(screen.getByText("Based on your seed songs.")).toBeTruthy();
  await fireEvent.press(screen.getByText("Save 2 songs"));
  expect(mockPost).toHaveBeenCalledWith("/playlists/builder/save", {
    source: "library",
    recommendationMode: "online",
    name: main.name + " mix",
    tracks: [seed, extra],
  });
});

it("can expand cached Discovery matches with every lookup kept offline", async () => {
  enableRecommendations();
  serveSuggestions(true);
  await open();
  await turnRecommendationsOff();
  await pickSeedsAndPreview();
  expect(mockGet).toHaveBeenCalledWith("/playlists/builder/artists", {
    params: { source: "library", q: "Roots", recommendationMode: "offline" },
    signal: expect.anything(),
  });
  expect(mockPost).toHaveBeenCalledWith(
    "/playlists/builder/options",
    { source: "library", artist: main, recommendationMode: "offline" },
    { signal: expect.anything() },
  );
  expect(screen.getByText("From cached recommendations.")).toBeTruthy();
  await fireEvent.press(screen.getByText("Include discoveries"));
  await screen.findByText("Save 3 songs");
  expect(mockPost).toHaveBeenCalledWith("/playlists/builder/preview", {
    source: "discovery",
    recommendationMode: "offline",
    artist: main,
    seedTrackIds: [seed.id],
    similarArtists: [related],
    size: 20,
  });
  expect(
    mockPost.mock.calls.every(
      ([, body]) => body.recommendationMode === "offline",
    ),
  ).toBe(true);
  await fireEvent.press(screen.getByText("Edit mix"));
  expect(
    await screen.findByRole("checkbox", { name: /You Got Me/ }),
  ).toBeChecked();
  expect(screen.getByText(related.name)).toBeTruthy();
  expect(
    screen.getByText("Use your Library and previously cached recommendations."),
  ).toBeTruthy();
  await fireEvent.press(screen.getByText("Preview playlist"));
  await fireEvent.press(await screen.findByText("Save 3 songs"));
  expect(mockPost).toHaveBeenCalledWith("/playlists/builder/save", {
    source: "discovery",
    recommendationMode: "offline",
    name: main.name + " mix",
    tracks: [seed, extra, discovery],
  });
});

it.each([false, true])(
  "only checks online on request and preserves review edits (cached teasers: %s)",
  async (cached) => {
    enableRecommendations();
    serveSuggestions(cached);
    await open();
    await turnRecommendationsOff();
    await pickSeedsAndPreview();
    await fireEvent.changeText(
      screen.getByLabelText("Playlist name"),
      "My Philadelphia mix",
    );
    await fireEvent.press(
      screen.getByRole("checkbox", { name: /Next Lifetime/ }),
    );
    if (cached) expect(screen.getByText(discovery.trackName)).toBeTruthy();
    else expect(screen.queryByText(discovery.trackName)).toBeNull();
    expect(
      mockPost.mock.calls.every(
        ([, body]) => body.recommendationMode === "offline",
      ),
    ).toBe(true);
    await fireEvent.press(screen.getByText("Check Discovery"));
    await screen.findByText(
      "Including these discoveries enables online recommendations for this mix.",
    );
    expect(screen.getByText(discovery.trackName)).toBeTruthy();
    expect(screen.getByText("Save 1 song")).toBeTruthy();
    expect(mockPost).toHaveBeenLastCalledWith("/playlists/builder/preview", {
      source: "library",
      recommendationMode: "online",
      artist: main,
      seedTrackIds: [seed.id],
      similarArtists: [related],
      size: 20,
    });
    await fireEvent.press(screen.getByText("Include discoveries"));
    await screen.findByText("Save 2 songs");
    expect(mockPost).toHaveBeenLastCalledWith("/playlists/builder/preview", {
      source: "discovery",
      recommendationMode: "online",
      artist: main,
      seedTrackIds: [seed.id],
      similarArtists: [related],
      size: 20,
    });
    await fireEvent.press(screen.getByText("Save 2 songs"));
    expect(mockPost).toHaveBeenLastCalledWith("/playlists/builder/save", {
      source: "discovery",
      recommendationMode: "online",
      name: "My Philadelphia mix",
      tracks: [seed, discovery],
    });
  },
);

it("starts at one hop with Advanced collapsed and explains the setting on demand", async () => {
  enableRecommendations(true);
  await open();
  await chooseMain();
  const disclosure = screen.getByRole("button", {
    name: "Advanced options",
    expanded: false,
  });
  expect(screen.queryByText("Max hops")).toBeNull();
  await fireEvent.press(disclosure);
  expect(
    screen.getByRole("radio", { name: "1 hop", checked: true }),
  ).toBeTruthy();
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  try {
    await fireEvent.press(
      screen.getByRole("button", { name: "About max hops" }),
    );
    expect(alert).toHaveBeenCalledWith(
      "Max hops",
      expect.stringContaining("folk ballad"),
    );
  } finally {
    alert.mockRestore();
  }
  await fireEvent.press(
    screen.getByRole("button", { name: "Advanced options", expanded: true }),
  );
  expect(screen.queryByRole("radio", { name: "1 hop" })).toBeNull();
  await fireEvent.press(screen.getByText("Preview playlist"));
  expect(mockPost).toHaveBeenLastCalledWith(
    "/playlists/builder/preview",
    expect.objectContaining({ maxHops: 1 }),
  );
});

it("keeps the selected hop limit through offline preview, a live check, expansion and editing", async () => {
  enableRecommendations(true);
  serveSuggestions(false);
  await open();
  await chooseMain();
  await turnRecommendationsOff();
  await fireEvent.press(
    screen.getByRole("button", { name: "Advanced options" }),
  );
  await fireEvent.press(screen.getByRole("radio", { name: "2 hops" }));
  expect(
    screen.getByRole("radio", { name: "2 hops", checked: true }),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole("radio", { name: "3 hops" }));
  await fireEvent.press(screen.getByRole("checkbox", { name: /You Got Me/ }));
  await fireEvent.press(screen.getByText("Preview playlist"));
  await fireEvent.press(await screen.findByText("Check Discovery"));
  await fireEvent.press(await screen.findByText("Include discoveries"));
  await fireEvent.press(await screen.findByText("Edit mix"));
  await fireEvent.press(
    screen.getByRole("button", { name: "Advanced options" }),
  );
  expect(
    screen.getByRole("radio", { name: "3 hops", checked: true }),
  ).toBeTruthy();
  const recipes = mockPost.mock.calls
    .filter(([path]) => path.endsWith("/preview"))
    .map(([, recipe]) => [
      recipe.maxHops,
      recipe.source,
      recipe.recommendationMode,
    ]);
  expect(recipes).toEqual([
    [3, "library", "offline"],
    [3, "library", "online"],
    [3, "discovery", "online"],
  ]);
});
