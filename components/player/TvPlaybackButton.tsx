import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { AppSheet } from "@/components/ui/AppSheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Text } from "@/components/ui/Text";
import { useAuth } from "@/contexts/auth-context";
import { useColors } from "@/hooks/use-colors";
import {
  currentPosition,
  getQueueSnapshot,
  isPlaybackActive,
  pause,
} from "@/lib/player/player";
import type { PlayerTrack } from "@/lib/player/track-item";
import { selectTvOutput } from "@/lib/player/tv-output";
import {
  controlTv,
  getTvRemote,
  playQueueOnTv,
  readTvSnapshot,
} from "@/lib/tv/remote";

const TvQueueScreen = lazy(() =>
  import("./TvQueueScreen").then(({ TvQueueScreen }) => ({
    default: TvQueueScreen,
  })),
);

type Source =
  | { kind: "tv"; title: string }
  | { kind: "current"; title: string }
  | {
      kind: "collection";
      title: string;
      id: string;
      getTracks: () => PlayerTrack[];
    };

type Remote = NonNullable<Awaited<ReturnType<typeof getTvRemote>>>;
type Status = Awaited<ReturnType<typeof controlTv>>;
type Connection =
  | { state: "connecting" | "unpaired" | "unavailable" }
  | { state: "ready"; remote: Remote; status: Status };

export function TvPlaybackButton({
  source,
  color,
}: {
  source: Source;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {source.kind === "current" ? (
        <Pressable
          style={styles.trigger}
          accessibilityRole="button"
          accessibilityLabel="Play on TV"
          onPress={() => setOpen(true)}
        >
          <Ionicons name="tv-outline" color={color} size={22} />
          <Text variant="caption" style={{ color }}>
            Play on TV
          </Text>
        </Pressable>
      ) : (
        <Chip
          icon="tv-outline"
          label="Play on TV"
          size="md"
          onPress={() => setOpen(true)}
        />
      )}
      {open && (
        <TvPlaybackSheet source={source} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export function TvPlaybackSheet({
  source,
  onClose,
}: {
  source: Source;
  onClose: () => void;
}) {
  const [showQueue, setShowQueue] = useState(false);
  if (source.kind === "tv" || showQueue) {
    return (
      <Suspense fallback={null}>
        <TvQueueScreen onClose={onClose} />
      </Suspense>
    );
  }
  return (
    <SourceSheet
      source={source}
      onClose={onClose}
      onQueue={() => setShowQueue(true)}
    />
  );
}
function SourceSheet({
  source,
  onClose,
  onQueue,
}: {
  onQueue: () => void;
  source: Exclude<Source, { kind: "tv" }>;
  onClose: () => void;
}) {
  const sheet = useRef<BottomSheetModal>(null);
  const openingQueue = useRef(false);
  const [handoffPending, setHandoffPending] = useState(false);
  const { serverUrl, user, token } = useAuth();
  useEffect(() => {
    sheet.current?.present();
  }, []);
  return (
    <AppSheet
      ref={sheet}
      enableDynamicSizing
      enablePanDownToClose={!handoffPending}
      backdropPressBehavior={handoffPending ? "none" : "close"}
      background="card"
      onDismiss={() => (openingQueue.current ? onQueue() : onClose())}
    >
      <BottomSheetScrollView contentContainerStyle={styles.sheet}>
        <Text accessibilityRole="header" variant="title">
          Aurral TV
        </Text>
        {serverUrl && user && token ? (
          <TvControls
            key={JSON.stringify([serverUrl, user.id])}
            source={source}
            serverUrl={serverUrl}
            userId={user.id}
            setHandoffPending={setHandoffPending}
            onQueue={() => {
              openingQueue.current = true;
              sheet.current?.dismiss();
            }}
          />
        ) : (
          <Text>Sign in to Pocket to use the TV paired with your account.</Text>
        )}
        <Button
          title="Done"
          disabled={handoffPending}
          accessibilityRole="button"
          variant="inline"
          onPress={() => sheet.current?.dismiss()}
        />
      </BottomSheetScrollView>
    </AppSheet>
  );
}

type Action = "play" | "pause" | "resume" | "previous" | "next" | "status";

function TvControls({
  source,
  serverUrl,
  userId,
  setHandoffPending,
  onQueue,
}: {
  onQueue: () => void;
  setHandoffPending: (value: boolean) => void;
  source: Exclude<Source, { kind: "tv" }>;
  serverUrl: string;
  userId: number;
}) {
  const colors = useColors();
  const [connection, setConnection] = useState<Connection>({
    state: "connecting",
  });
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  const sending = useRef(false);

  useEffect(() => {
    let current = true;
    active.current = true;
    async function connect() {
      try {
        const remote = await getTvRemote(serverUrl, userId);
        if (!current) return;
        if (!remote) {
          setConnection({ state: "unpaired" });
          return;
        }
        const status = await controlTv(remote, { action: "status" });
        if (current) setConnection({ state: "ready", remote, status });
      } catch {
        if (current) setConnection({ state: "unavailable" });
      }
    }
    void connect();
    return () => {
      current = false;
      active.current = false;
      setHandoffPending(false);
    };
  }, [attempt, serverUrl, userId, setHandoffPending]);

  function reconnect() {
    setMessage("");
    setConnection({ state: "connecting" });
    setAttempt((n) => n + 1);
  }

  async function run(action: Action) {
    if (sending.current || connection.state !== "ready") return;
    const { remote } = connection;
    sending.current = true;
    setWorking(true);
    if (source.kind === "current" && action === "play") setHandoffPending(true);
    setMessage("");
    try {
      let status: Status;
      if (action !== "play") {
        status = await controlTv(remote, { action });
      } else if (source.kind === "collection") {
        const tracks = source.getTracks().filter((track) => !track.isPreview);
        if (!tracks.length) {
          setMessage("This collection has no downloaded tracks to play on TV.");
          return;
        }
        status = await playQueueOnTv(remote, tracks, 0, 0, source.id);
      } else {
        const { items, currentId } = getQueueSnapshot();
        const index = items.findIndex((item) => item.id === currentId);
        const track = items[index];
        if (!track?.streamPath || track.isPreview) {
          setMessage(
            "Choose a Library song or a downloaded playlist track to play on TV.",
          );
          return;
        }
        const wasPlaying = isPlaybackActive();
        const positionMs = Math.max(0, Math.round(currentPosition() * 1000));
        status = await playQueueOnTv(remote, items, index, positionMs);
        const now = getQueueSnapshot();
        const currentTrack = now.items.find(
          (item) => item.id === now.currentId,
        );
        if (
          active.current &&
          status.playing &&
          wasPlaying &&
          isPlaybackActive() &&
          currentTrack?.id === track.id &&
          currentTrack.streamPath === track.streamPath
        ) {
          try {
            await pause();
          } catch {
            if (active.current)
              setMessage("Playing on TV. Pause Pocket to stop playback here.");
          }
        }
      }
      if (active.current) {
        setConnection({ state: "ready", remote, status });
        if (action === "play" && status.playing) {
          try {
            const snapshot = await readTvSnapshot(remote);
            if (active.current && snapshot.sessionId)
              selectTvOutput(remote, snapshot);
          } catch {
            /* Older TV builds still support basic transport controls. */
          }
        }
      }
    } catch (error) {
      if (active.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "The TV could not complete that action. Open Aurral TV and try again.",
        );
    } finally {
      sending.current = false;
      if (active.current) {
        setWorking(false);
        setHandoffPending(false);
      }
    }
  }

  if (connection.state === "connecting")
    return (
      <View style={styles.connecting}>
        <ActivityIndicator color={colors.brand} />
        <Text>Connecting to your TV…</Text>
      </View>
    );
  if (connection.state === "unpaired")
    return (
      <Text>
        Choose “Pair Pocket remote” on Aurral TV, then scan its QR code with
        your phone camera.
      </Text>
    );
  if (connection.state === "unavailable")
    return (
      <>
        <Text accessibilityRole="alert">
          Couldn’t reach your TV. Open Aurral TV on the same local network. If
          your TV has been set up again, scan its new pairing code.
        </Text>
        <Button
          title="Try again"
          onPress={reconnect}
          accessibilityRole="button"
        />
      </>
    );
  if (connection.state !== "ready") return null;
  const { status } = connection;
  return (
    <>
      <View style={styles.statusRow}>
        <View style={styles.details}>
          <Text variant="caption">
            {status.title
              ? status.playing
                ? "Playing on TV"
                : "Paused on TV"
              : "TV connected"}
          </Text>
          {!!status.title && <Text numberOfLines={2}>{status.title}</Text>}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh TV status"
          disabled={working}
          onPress={() => void run("status")}
          style={styles.control}
        >
          <Ionicons color={colors.subtle} size={20} name="refresh" />
        </Pressable>
      </View>
      {!!status.title && (
        <View style={styles.transport}>
          {(
            ["previous", status.playing ? "pause" : "resume", "next"] as const
          ).map((action) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                {
                  previous: "Previous on TV",
                  next: "Next on TV",
                  resume: "Resume TV",
                  pause: "Pause TV",
                }[action]
              }
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={() => void run(action)}
              key={action}
              style={[styles.control, { backgroundColor: colors.surfaceMid }]}
            >
              <Ionicons
                color={working ? colors.subtle : colors.text}
                size={24}
                name={
                  {
                    previous: "play-skip-back",
                    next: "play-skip-forward",
                    resume: "play",
                    pause: "pause",
                  }[action] as keyof typeof Ionicons.glyphMap
                }
              />
            </Pressable>
          ))}
        </View>
      )}
      {!!status.title && (
        <Button
          title="Open TV queue"
          variant="inline"
          accessibilityRole="button"
          onPress={onQueue}
          disabled={working}
        />
      )}
      <Button
        title={source.title ? `Play “${source.title}” on TV` : "Play on TV"}
        accessibilityRole="button"
        disabled={working}
        onPress={() => void run("play")}
      />
      {!!message && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite">
          {message}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    paddingHorizontal: 4,
    gap: 5,
    flexDirection: "row",
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 36, gap: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  details: { flex: 1, gap: 4 },
  connecting: { flexDirection: "row", alignItems: "center", gap: 10 },
  transport: { flexDirection: "row", gap: 12, justifyContent: "center" },
  control: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
