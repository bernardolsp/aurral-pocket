import { buildAuthenticatedUrl } from "@/lib/api/client";
import { resume, seekTo, takeOverQueue } from "@/lib/player/player";
import { libraryIdsOf, type PlayerTrack } from "@/lib/player/track-item";
import {
  editTvQueue,
  readTvSnapshot,
  type TvQueueEntry,
  type TvRemote,
} from "./remote";

function localTrack(entry: TvQueueEntry, id: string): PlayerTrack {
  const url = buildAuthenticatedUrl(entry.streamPath);
  if (!url) throw new Error("Sign in to Pocket to continue this queue.");
  return {
    id,
    albumRef: libraryIdsOf(entry.streamPath)?.libraryAlbumId ?? null,
    title: entry.title,
    artist: entry.artist,
    album: entry.albumName ?? "",
    duration: (entry.durationMs ?? 0) / 1000,
    streamPath: entry.streamPath,
    url,
    coverPath: entry.artworkPath,
    artwork: null,
    trackMbid: null,
    albumMbid: null,
    artistMbid: null,
    favorite: null,
  };
}

export async function continueOnPhone(remote: TvRemote, active: () => boolean) {
  const state = await readTvSnapshot(remote);
  const entry = state.entries[state.index];
  if (
    !active() ||
    !state.sessionId ||
    !entry ||
    state.currentEntryId !== entry.entryId
  )
    throw new Error("Choose a playing TV queue to continue on this device.");
  const remaining = state.entries.slice(state.index);
  // Keep ordinary library/song IDs for offline files and favorites. Only repeated
  // occurrences need synthetic IDs in Pocket's ID-addressed native queue.
  const reserved = new Set(remaining.map((e) => e.id));
  const used = new Set<string>();
  const items = remaining.map((e) => {
    let id = e.id;
    if (used.has(id)) {
      id = "tv:" + e.entryId;
      while (reserved.has(id) || used.has(id)) id = "tv:" + id;
    }
    used.add(id);
    return localTrack(e, id);
  });
  const current = items[0];
  // Prepare and seek Pocket silently. The TV keeps its music if loading fails.
  const result = await takeOverQueue(
    {
      items,
      startId: current.id,
      positionSeconds: state.positionMs / 1000,
      durationSeconds: (state.durationMs ?? entry.durationMs ?? 0) / 1000,
      album: {
        albumTitle: current.album,
        artistName: current.artist,
        coverPath: current.coverPath,
        artworkUrl: null,
        albumMbid: null,
        artistMbid: null,
      },
    },
    { play: false },
  );
  if (!active() || result !== "loaded")
    throw new Error("Pocket could not load the TV queue.");
  const beforePause = await readTvSnapshot(remote, state);
  if (
    !active() ||
    beforePause.sessionId !== state.sessionId ||
    beforePause.revision !== state.revision ||
    beforePause.currentEntryId !== entry.entryId
  )
    throw new Error("The TV queue changed during transfer. Try again.");
  const acknowledgement = await editTvQueue(remote, state.sessionId, {
    action: "handoffPause",
    entryId: entry.entryId,
    revision: state.revision,
  });
  if (acknowledgement.playing)
    throw new Error("The TV is still playing. Try transferring again.");
  // Once the guarded pause is acknowledged, a lost Wi-Fi connection must not
  // strand both players. The most recent validated position is a safe fallback.
  const paused = await readTvSnapshot(remote, beforePause).catch(() => ({
    ...beforePause,
    playing: false,
  }));
  if (
    !active() ||
    paused.sessionId !== state.sessionId ||
    paused.currentEntryId !== entry.entryId ||
    paused.playing
  )
    throw new Error("The TV playback changed. Open its queue to try again.");
  if (paused.canSeek && Math.abs(paused.positionMs - state.positionMs) > 250)
    await seekTo(paused.positionMs / 1000);
  if (beforePause.playing && active()) await resume();
}
