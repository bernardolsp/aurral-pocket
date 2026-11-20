import { useCallback } from "react";
import * as Burnt from "burnt";
import {
  addItemsToQueue,
  addToQueue,
  playAlbumFromTrack,
  playItemsNext,
  playNextInQueue,
  setShuffle,
} from "@/lib/player/player";
import { toastNotSaved } from "@/hooks/offline/toast-not-saved";
import { isOffline } from "@/lib/offline/network";
import { canPlayNow } from "@/lib/offline/saved-library";
import { enqueueOnTv } from "@/lib/tv/remote";
import { getTvOutput } from "@/lib/player/tv-output";
import {
  toPlayerTrack,
  type PlayerAlbumContext,
  type PlayerTrack,
} from "@/lib/player/track-item";
import type { Track } from "@/lib/types/library";

/**
 * The queue and album-level play actions, with their user feedback. Every
 * action says what happened: a queue edit confirms itself with a toast, and
 * a failure explains itself instead of looking like a dead tap.
 */
export function useQueueActions() {
  const playNext = useCallback(
    (tracks: Track[], album: PlayerAlbumContext) =>
      queueEdit(
        "next",
        () => albumItems(tracks, album),
        () => playNextInQueue(tracks, album),
      ),
    [],
  );

  const addLast = useCallback(
    (tracks: Track[], album: PlayerAlbumContext) =>
      queueEdit(
        "end",
        () => albumItems(tracks, album),
        () => addToQueue(tracks, album),
      ),
    [],
  );

  const playNextItems = useCallback(
    (items: PlayerTrack[], album: PlayerAlbumContext) =>
      queueEdit(
        "next",
        () => items,
        () => playItemsNext(items, album),
      ),
    [],
  );

  const addItemsLast = useCallback(
    (items: PlayerTrack[], album: PlayerAlbumContext) =>
      queueEdit(
        "end",
        () => items,
        () => addItemsToQueue(items, album),
      ),
    [],
  );

  const playAlbum = useCallback(
    async (tracks: Track[], album: PlayerAlbumContext) => {
      const first = firstPlayable(tracks);
      if (!first) {
        toastNothingPlayable();
        return;
      }
      try {
        const started = await playAlbumFromTrack(tracks, first, album);
        if (!started) toastNothingPlayable();
      } catch (error) {
        toastFailure(error);
      }
    },
    [],
  );

  // Turning shuffle on before the play makes the rebuilt queue come out
  // shuffled — replaceAndPlay reorders the upcoming tracks itself.
  const shuffleAlbum = useCallback(
    async (tracks: Track[], album: PlayerAlbumContext) => {
      const playable = tracks.filter(canPlay);
      if (playable.length === 0) {
        toastNothingPlayable();
        return;
      }
      const start = playable[Math.floor(Math.random() * playable.length)];
      try {
        await setShuffle(true);
        const started = await playAlbumFromTrack(tracks, start, album);
        if (!started) toastNothingPlayable();
      } catch (error) {
        toastFailure(error);
      }
    },
    [],
  );

  return {
    playNext,
    addToQueue: addLast,
    playItemsNext: playNextItems,
    addItemsToQueue: addItemsLast,
    playAlbum,
    shuffleAlbum,
  };
}

function albumItems(tracks: Track[], album: PlayerAlbumContext) {
  return tracks
    .map((track) => toPlayerTrack(track, album))
    .filter((item) => item !== null);
}

async function queueEdit(
  placement: "next" | "end",
  items: () => PlayerTrack[],
  local: () => Promise<number>,
) {
  const { selected, remote, status } = getTvOutput();
  if (!selected)
    return confirmQueued(
      local(),
      placement === "next" ? "Playing next" : "Added to queue",
    );
  try {
    if (!remote || !status?.sessionId)
      throw new Error("Open the TV queue and reconnect.");
    await enqueueOnTv(remote, items(), placement, status.sessionId);
    Burnt.toast({
      title: placement === "next" ? "Playing next on TV" : "Added to TV queue",
      preset: "done",
    });
  } catch (error) {
    toastFailure(error);
  }
}

async function confirmQueued(edit: Promise<number>, done: string) {
  try {
    const added = await edit;
    if (added > 0) {
      Burnt.toast({ title: done, preset: "done" });
      return;
    }
    toastNothingQueued();
  } catch (error) {
    toastFailure(error);
  }
}

function firstPlayable(tracks: Track[]): Track | null {
  return tracks.find(canPlay) ?? null;
}

function canPlay(track: Track): boolean {
  return !!track.streamPath && canPlayNow(track.id);
}

function toastNothingQueued(): void {
  if (isOffline()) {
    toastNotSaved();
    return;
  }
  Burnt.toast({
    title: "Nothing to add",
    message:
      "Aurral has no readable files for these tracks, or they are already in the queue.",
    preset: "error",
  });
}

function toastNothingPlayable(): void {
  if (isOffline()) {
    toastNotSaved();
    return;
  }
  Burnt.toast({
    title: "Cannot play this album",
    message:
      "Aurral has no file it can read for any track. Check that its music folder is mounted.",
    preset: "error",
  });
}

function toastFailure(error: unknown): void {
  Burnt.toast({
    title: "Playback failed",
    message: error instanceof Error ? error.message : String(error),
    preset: "error",
  });
}
