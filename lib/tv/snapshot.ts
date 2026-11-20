export type TvQueueEntry = {
  entryId: string;
  id: string;
  title: string;
  artist: string;
  albumName: string | null;
  artworkPath: string | null;
  durationMs: number | null;
  streamPath: string;
  transcode: boolean;
  pinned?: boolean;
};

export type TvSnapshot = {
  sessionId: string | null;
  revision: number;
  currentEntryId: string | null;
  index: number;
  total: number;
  positionMs: number;
  durationMs: number | null;
  playing: boolean;
  buffering: boolean;
  canSeek: boolean;
  shuffle: boolean;
  flowId: string | null;
  flowName: string | null;
  collectionId: string | null;
  entries: TvQueueEntry[];
};

const invalid = () => new Error("The TV queue changed. Refresh and try again.");
const nonnegative = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const short = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 2048;
const nullable = (s: unknown): s is string | null => s === null || short(s);

export function streamPath(raw: unknown) {
  if (!short(raw)) return null;
  const path = raw.replace(/^\/api\//, "/");
  if (
    !/^\/(?:playlists\/stream\/[^/]+|library\/stream\/[^/]+\/[^/]+)$/.test(path)
  )
    return null;
  try {
    for (const part of path.slice(1).split("/")) {
      const value = decodeURIComponent(part);
      if (
        value === "." ||
        value === ".." ||
        /[\\/?#\u0000-\u001f\u007f]/.test(value)
      )
        return null;
    }
  } catch {
    return null;
  }
  return path;
}

export function safeArtwork(raw: unknown) {
  if (!short(raw)) return null;
  return /^\/api\/(?:library\/(?:albums\/[\w-]+\/cover|artwork\/album\/[\w-]+)(?:\?v=[\w.-]+)?|artists\/release-group\/[a-f\d-]{36}\/cover\/image|playlists\/track-artwork\/[\w-]+(?:\?(?:playlistId|v)=[\w.-]+(?:&(?:playlistId|v)=[\w.-]+)*)?)$/i.test(
    raw,
  )
    ? raw
    : null;
}

function entry(raw: unknown): TvQueueEntry {
  const v = raw as Partial<TvQueueEntry> | null;
  const path = streamPath(v?.streamPath);
  if (
    !v ||
    !short(v.entryId) ||
    !v.entryId ||
    !short(v.id) ||
    !v.id ||
    !short(v.title) ||
    !short(v.artist) ||
    !nullable(v.albumName) ||
    (v.durationMs !== null && !nonnegative(v.durationMs)) ||
    typeof v.transcode !== "boolean" ||
    !path
  )
    throw invalid();
  return {
    entryId: v.entryId,
    id: v.id,
    title: v.title,
    artist: v.artist,
    albumName: v.albumName,
    artworkPath: safeArtwork(v.artworkPath),
    durationMs: v.durationMs,
    streamPath: path,
    transcode: v.transcode,
    pinned: v.pinned === true,
  };
}

export function snapshotPage(
  raw: unknown,
): TvSnapshot & { offset: number; unchanged: boolean } {
  const p = raw as Partial<TvSnapshot> & {
    offset?: number;
    unchanged?: boolean;
  };
  if (
    !p ||
    !nullable(p.sessionId) ||
    !nonnegative(p.revision) ||
    !nullable(p.currentEntryId) ||
    !Number.isSafeInteger(p.index) ||
    !nonnegative(p.total) ||
    p.total > 100000 ||
    !nonnegative(p.offset) ||
    p.offset > p.total ||
    !Array.isArray(p.entries) ||
    p.offset + p.entries.length > p.total ||
    !nonnegative(p.positionMs) ||
    (p.durationMs !== null && !nonnegative(p.durationMs)) ||
    typeof p.playing !== "boolean" ||
    typeof p.buffering !== "boolean" ||
    typeof p.canSeek !== "boolean" ||
    typeof p.shuffle !== "boolean" ||
    !nullable(p.flowId) ||
    !nullable(p.flowName) ||
    !nullable(p.collectionId)
  )
    throw invalid();
  const index = p.index!;
  if (
    index < -1 ||
    (p.total > 0 && index >= p.total) ||
    (p.total === 0 && p.currentEntryId !== null)
  )
    throw invalid();
  return {
    sessionId: p.sessionId,
    revision: p.revision,
    currentEntryId: p.currentEntryId,
    index,
    total: p.total,
    positionMs: p.positionMs,
    durationMs: p.durationMs,
    playing: p.playing,
    buffering: p.buffering,
    canSeek: p.canSeek,
    shuffle: p.shuffle,
    flowId: p.flowId,
    flowName: p.flowName,
    collectionId: p.collectionId,
    offset: p.offset,
    unchanged: p.unchanged === true,
    entries: p.entries.map(entry),
  };
}
