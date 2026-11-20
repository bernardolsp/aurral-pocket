import { api } from "./client";

export type BuilderSource = "library" | "discovery";

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
};

type BuilderRecipe = {
  source: BuilderSource;
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
) {
  const r = await api.get<{ artists: BuilderArtist[] }>(`${BUILDER}/artists`, {
    params: { source, q },
    signal,
  });
  return r.data.artists;
}

export async function getBuilderOptions(
  source: BuilderSource,
  artist: BuilderArtist,
  signal: AbortSignal,
) {
  const r = await api.post<{
    tracks: BuilderTrack[];
    similarArtists: BuilderArtist[];
  }>(`${BUILDER}/options`, { source, artist }, { signal });
  return r.data;
}

export async function previewBuilder(recipe: BuilderRecipe) {
  const r = await api.post<{
    tracks: BuilderTrack[];
    missingArtists: string[];
  }>(`${BUILDER}/preview`, recipe);
  return r.data;
}

export async function saveBuilder(payload: {
  source: BuilderSource;
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
