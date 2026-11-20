import { fetch as nativeFetch } from "expo/fetch";
import { getRandomValues } from "expo-crypto";
import type { PlayerTrack } from "@/lib/player/track-item";
import { openRemote, sealRemote } from "./remote-envelope";

import { privateAddress, type TvRemote } from "./remote-store";
export { getTvRemote, type TvRemote } from "./remote-store";
export type TvCommand = {
  action: "pause" | "resume" | "next" | "previous" | "status";
};
type QueueCommand = {
  action: "play";
  tracks: ReturnType<typeof fromTrack>[];
  index: number;
  positionMs: number;
  collectionId?: string;
};

function fromTrack(t: PlayerTrack) {
  const path = t.streamPath?.replace(/^\/api\//, "/");
  if (
    t.isPreview ||
    !path ||
    !/^\/(?:playlists\/stream\/[^/?#\\]+|library\/stream\/[^/?#\\]+\/[^/?#\\]+)$/.test(
      path,
    )
  )
    return null;
  // Transfer local identifiers and metadata. URLs and artwork query credentials stay on the phone.
  const cover = t.coverPath;
  const artworkPath =
    cover &&
    (/^\/api\/library\/albums\/[A-Za-z0-9_-]+\/cover(?:\?v=[A-Za-z0-9_.-]+)?$/.test(
      cover,
    ) ||
      /^\/api\/artists\/release-group\/[a-f0-9-]{36}\/cover\/image$/i.test(
        cover,
      ) ||
      /^\/api\/playlists\/track-artwork\/[A-Za-z0-9_-]+(?:\?(?:playlistId|v)=[A-Za-z0-9_-]+(?:&(?:playlistId|v)=[A-Za-z0-9_-]+)*)?$/.test(
        cover,
      ))
      ? cover
      : null;
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

async function exchange(remote: TvRemote, command: TvCommand | QueueCommand) {
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
    if (!reply.ok || Number(reply.headers.get("content-length")) > 8192)
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
    return { playing: data.playing, title: data.title };
  } catch {
    throw new Error(
      "Open Aurral TV on the same Wi-Fi. If its address changed, pair Pocket again on the TV.",
    );
  } finally {
    clearTimeout(deadline);
  }
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
