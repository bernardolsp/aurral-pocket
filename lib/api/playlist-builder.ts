import { api } from "./client";

export type BuilderSource = "library" | "discovery";

export type RecommendationMode = "online" | "offline";

export type BuilderArtist = {
  name: string;
  mbid: string | null;
  libraryArtistId: number | null;
};

export type BuilderTrack = {
  id: string;
  artistName: string;
  trackName: string;
  albumName: string | null;
  source: BuilderSource;
  recordingMbid?: string;
  pickReason?:
    "seed" | "recording" | "chosenArtist" | "relatedArtist" | "genre";
};

export type BuilderPreview = {
  tracks: BuilderTrack[];
  missingArtists: string[];
  discoveryTeaser?: BuilderTrack[];
  recommendationBasis?: "recording" | "artist";
};

export type BuilderRecipe = {
  source: BuilderSource;
  recommendationMode?: RecommendationMode;
  artist: BuilderArtist;
  seedTrackIds: string[];
  similarArtists: BuilderArtist[];
  size: number;
};

const BUILDER = "/playlists/builder";

export async function searchBuilderArtists(
  source: BuilderSource,
  q: string,
  signal: AbortSignal,
  recommendationMode?: RecommendationMode,
) {
  const r = await api.get<{ artists: BuilderArtist[] }>(`${BUILDER}/artists`, {
    params: { source, q, ...(recommendationMode && { recommendationMode }) },
    signal,
  });
  return r.data.artists;
}

export async function getBuilderOptions(
  source: BuilderSource,
  artist: BuilderArtist,
  signal: AbortSignal,
  recommendationMode?: RecommendationMode,
) {
  const r = await api.post<{
    tracks: BuilderTrack[];
    similarArtists: BuilderArtist[];
  }>(
    `${BUILDER}/options`,
    { source, artist, ...(recommendationMode && { recommendationMode }) },
    { signal },
  );
  return r.data;
}

export async function previewBuilder(recipe: BuilderRecipe) {
  const r = await api.post<BuilderPreview>(`${BUILDER}/preview`, recipe);
  return r.data;
}

export async function saveBuilder(payload: {
  source: BuilderSource;
  recommendationMode?: RecommendationMode;
  name: string;
  tracks: BuilderTrack[];
}) {
  const r = await api.post<{
    playlistId: string;
    operationId: string;
    queued: true;
  }>(`${BUILDER}/save`, payload);
  return r.data;
}
