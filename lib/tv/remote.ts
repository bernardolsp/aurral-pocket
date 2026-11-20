import { fetch as nativeFetch } from "expo/fetch";
import { getRandomValues } from "expo-crypto";
import type { PlayerTrack } from "@/lib/player/track-item";
import {
  safeArtwork,
  snapshotPage,
  streamPath,
  type TvSnapshot,
} from "./snapshot";
import { openRemote, sealRemote } from "./remote-envelope";

import { privateAddress, type TvRemote } from "./remote-store";
export type { TvSnapshot, TvQueueEntry } from "./snapshot";
export { getTvRemote, type TvRemote } from "./remote-store";
export type TvCommand = {
  action: "pause" | "resume" | "next" | "previous" | "status";
  sessionId?: string;
};
type QueueCommand = {
  action: "play";
  tracks: ReturnType<typeof fromTrack>[];
  index: number;
  positionMs: number;
  collectionId?: string;
};

function fromTrack(t: PlayerTrack) {
  const path = streamPath(t.streamPath);
  if (t.isPreview || !path) return null;
  const artworkPath = safeArtwork(t.coverPath);
  return {
    id: t.id,
    streamPath: path,
    title: t.title.slice(0, 512),
    artist: t.artist.slice(0, 512),
    albumName: t.album?.slice(0, 512) || null,
    artworkPath,
    audioFormat: t.audioFormat,
    bitrateKbps: t.bitrateKbps,
    durationMs: Math.max(0, Math.round(t.duration * 1000)),
  };
}

export type TvEdit =
  | { action: "move"; entryId: string; beforeEntryId: string | null }
  | { action: "remove" | "jump" | "pin"; entryId: string }
  | { action: "shuffle"; enabled: boolean }
  | { action: "flow"; flowId: string | null }
  | { action: "seek"; entryId: string; positionMs: number }
  | { action: "handoffPause"; entryId: string; revision: number };

type SnapshotRequest = {
  action: "snapshot";
  offset?: number;
  revision?: number;
  sessionId?: string | null;
  knownRevision?: number;
  knownSessionId?: string | null;
};
type Command =
  | TvCommand
  | QueueCommand
  | SnapshotRequest
  | (TvEdit & { sessionId: string })
  | {
      action: "enqueue";
      tracks: ReturnType<typeof fromTrack>[];
      placement: "next" | "end";
      sessionId: string;
    };
export type TvStatus = { playing: boolean; title: string };

async function exchangeNow(remote: TvRemote, command: Command) {
  if (!privateAddress(remote.address))
    throw new Error("Scan the TV again to pair it.");
  const host = "http://" + remote.address + ":44685/v1/remote/";
  const cancel = new AbortController();
  const deadline = setTimeout(() => cancel.abort(), 16000);
  try {
    const options = {
      redirect: "error",
      credentials: "omit",
      signal: cancel.signal,
    } as const;
    const response = await nativeFetch(host + "challenge", options);
    if (!response.ok) throw new Error();
    const { challenge } = await response.json();
    if (typeof challenge !== "string" || !/^[a-f0-9]{32}$/.test(challenge))
      throw new Error();
    const body = sealRemote(
      { v: 1, kind: "command", challenge, ...command },
      remote.key,
      getRandomValues,
    );
    const reply = await nativeFetch(host + challenge, {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
    if (
      !reply.ok ||
      Number(reply.headers.get("content-length")) >
        (command.action === "snapshot" ? 131072 : 8192)
    )
      throw new Error();
    const data = openRemote(await reply.text(), remote.key) as Record<
      string,
      unknown
    > | null;
    if (
      !data ||
      data.v !== 1 ||
      data.kind !== "reply" ||
      data.challenge !== challenge ||
      typeof data.ok !== "boolean"
    )
      throw new Error();
    if (!data.ok) return null;
    if (typeof data.playing !== "boolean" || typeof data.title !== "string")
      throw new Error();
    return {
      playing: data.playing,
      title: data.title,
      ...(command.action === "snapshot" ? { snapshot: data.snapshot } : {}),
    };
  } catch {
    throw new Error(
      "Open Aurral TV on the same Wi-Fi. If its address changed, pair Pocket again on the TV.",
    );
  } finally {
    clearTimeout(deadline);
  }
}

// The TV accepts one command at a time. A background refresh must never
// race a user action for the device's single receiver.
const exchangeQueues = new Map<string, Promise<unknown>>();
function exchange(remote: TvRemote, command: Command) {
  const key = JSON.stringify([remote.serverUrl, remote.userId, remote.address]);
  const prior = exchangeQueues.get(key) ?? Promise.resolve();
  const run = prior.then(() => exchangeNow(remote, command));
  const done = run.then(
    () => {},
    () => {},
  );
  exchangeQueues.set(key, done);
  void done.then(() => {
    if (exchangeQueues.get(key) === done) exchangeQueues.delete(key);
  });
  return run;
}

export async function readTvSnapshot(
  remote: TvRemote,
  previous?: TvSnapshot | null,
): Promise<TvSnapshot> {
  const first = await exchange(remote, {
    action: "snapshot",
    ...(previous
      ? { knownRevision: previous.revision, knownSessionId: previous.sessionId }
      : {}),
  });
  if (!first?.snapshot)
    throw new Error("Update Aurral TV to use its shared queue.");
  const { offset, unchanged, ...snapshot } = snapshotPage(first.snapshot);
  if (offset !== 0) throw new Error("The TV returned an incomplete queue.");
  if (unchanged) {
    if (
      !previous ||
      previous.sessionId !== snapshot.sessionId ||
      previous.revision !== snapshot.revision ||
      previous.entries.length !== snapshot.total
    )
      throw new Error("The TV queue changed. Refresh and try again.");
    return { ...snapshot, entries: previous.entries };
  }
  while (snapshot.entries.length < snapshot.total) {
    if (!snapshot.entries.length)
      throw new Error("The TV returned an empty queue page.");
    const reply = await exchange(remote, {
      action: "snapshot",
      offset: snapshot.entries.length,
      revision: snapshot.revision,
      sessionId: snapshot.sessionId,
    });
    const page = snapshotPage(reply?.snapshot);
    if (
      page.unchanged ||
      !page.entries.length ||
      page.sessionId !== snapshot.sessionId ||
      page.revision !== snapshot.revision ||
      page.total !== snapshot.total ||
      page.offset !== snapshot.entries.length
    )
      throw new Error("The TV queue changed. Refresh and try again.");
    snapshot.entries.push(...page.entries);
  }
  if (
    new Set(snapshot.entries.map((t) => t.entryId)).size !== snapshot.total ||
    (snapshot.currentEntryId !== null &&
      snapshot.entries[snapshot.index]?.entryId !== snapshot.currentEntryId)
  )
    throw new Error("The TV queue changed. Refresh and try again.");
  return snapshot;
}

export async function editTvQueue(
  remote: TvRemote,
  sessionId: string,
  cmd: TvEdit,
) {
  const result = await exchange(remote, { ...cmd, sessionId });
  if (!result)
    throw new Error(
      "The TV queue changed or that action is unavailable. Refresh and try again.",
    );
  return result;
}

export async function enqueueOnTv(
  remote: TvRemote,
  tracks: PlayerTrack[],
  placement: "next" | "end",
  sessionId: string,
) {
  const playable = tracks.map(fromTrack).filter((track) => track !== null);
  if (!playable.length)
    throw new Error("Choose a downloaded track or a library song.");
  // Keep edits atomic: silently truncating an album leaves the two queues inconsistent.
  if (playable.length > 100)
    throw new Error("Select up to 100 tracks at a time.");
  const result = await exchange(remote, {
    action: "enqueue",
    sessionId,
    placement,
    tracks: playable,
  });
  if (!result)
    throw new Error(
      "The TV could not add these tracks. Refresh the queue and try again.",
    );
  return result;
}

export async function controlTv(remote: TvRemote, cmd: TvCommand) {
  const reply = await exchange(remote, cmd);
  if (!reply) throw new Error("That control is unavailable on the TV.");
  return reply;
}

export async function playQueueOnTv(
  remote: TvRemote,
  queue: PlayerTrack[],
  index: number,
  positionMs = 0,
  collectionId?: string,
) {
  if (!Number.isInteger(index) || !queue[index] || !fromTrack(queue[index]))
    throw new Error(
      "Choose a library song or a downloaded playlist track to play on TV.",
    );
  // Preserve upcoming tracks first. Fill the remaining slots with previous tracks.
  const following = queue
    .slice(index)
    .map(fromTrack)
    .filter((t) => t !== null)
    .slice(0, 100);
  const slots = 100 - following.length;
  const before = slots
    ? queue
        .slice(0, index)
        .map(fromTrack)
        .filter((t) => t !== null)
        .slice(-slots)
    : [];
  const reply = await exchange(remote, {
    action: "play",
    tracks: [...before, ...following],
    index: before.length,
    positionMs: Math.min(86400000, Math.max(0, Math.round(positionMs) || 0)),
    collectionId,
  });
  if (!reply) throw new Error("Aurral TV could not start this queue.");
  return reply;
}
