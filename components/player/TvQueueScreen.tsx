import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
} from "react-native-reorderable-list";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { CoverArtImage } from "@/components/library/CoverArtImage";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Text } from "@/components/ui/Text";
import { useAuth } from "@/contexts/auth-context";
import { useColors } from "@/hooks/use-colors";
import { getFlowStatus } from "@/lib/api/flow";
import {
  clearTvOutput,
  selectTvOutput,
  updateTvOutput,
  useTvOutput,
} from "@/lib/player/tv-output";
import { continueOnPhone } from "@/lib/tv/handback";
import {
  controlTv,
  editTvQueue,
  getTvRemote,
  readTvSnapshot,
  type TvEdit,
  type TvQueueEntry,
  type TvRemote,
} from "@/lib/tv/remote";

type Icon = keyof typeof Ionicons.glyphMap;
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
};

function IconButton({
  icon,
  label,
  onPress,
  disabled,
  selected,
}: {
  icon: Icon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.icon, { opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons
        name={icon}
        size={23}
        color={selected ? colors.brand : colors.text}
      />
    </Pressable>
  );
}

function QueueRow({
  item,
  busy,
  onHold,
  onJump,
  onRemove,
  onPin,
}: {
  item: TvQueueEntry;
  busy: boolean;
  onHold: () => void;
  onJump: () => void;
  onRemove: () => void;
  onPin: () => void;
}) {
  const drag = useReorderableDrag();
  const colors = useColors();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.background, borderColor: colors.separator },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={"Drag to reorder " + item.title}
        onLongPress={() => {
          onHold();
          drag();
        }}
        delayLongPress={180}
        disabled={busy}
        style={styles.icon}
      >
        <Ionicons name="reorder-three" size={24} color={colors.subtle} />
      </Pressable>
      <Pressable
        style={styles.info}
        accessibilityRole="button"
        accessibilityLabel={"Play " + item.title}
        onPress={onJump}
        disabled={busy}
      >
        <Text numberOfLines={1}>{item.title}</Text>
        <Text variant="caption" numberOfLines={1}>
          {item.pinned ? "Play next · " : ""}
          {item.artist}
        </Text>
      </Pressable>
      <IconButton
        icon="play-skip-forward-outline"
        label={"Play " + item.title + " next"}
        onPress={onPin}
        disabled={busy}
      />
      <IconButton
        icon="remove-circle-outline"
        label={"Remove " + item.title}
        onPress={onRemove}
        disabled={busy}
      />
    </View>
  );
}

export function TvQueueScreen({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  if (!auth.serverUrl || !auth.user || !auth.token) return null;
  return (
    <Controller
      key={JSON.stringify([auth.serverUrl, auth.user.id])}
      serverUrl={auth.serverUrl}
      userId={auth.user.id}
      onClose={onClose}
    />
  );
}

function Controller({
  serverUrl,
  userId,
  onClose,
}: {
  serverUrl: string;
  userId: number;
  onClose: () => void;
}) {
  const colors = useColors();
  const output = useTvOutput();
  const [remote, setRemote] = useState<TvRemote | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const alive = useRef(false);
  const [flows, setFlows] = useState<{ id: string; name: string }[] | null>(
    null,
  );
  const [frozen, setFrozen] = useState<{
    sessionId: string;
    items: TvQueueEntry[];
  } | null>(null);
  const [seek, setSeek] = useState<number | null>(null);
  const seekEntry = useRef<string | null>(null);
  const status =
    remote &&
    output.remote?.serverUrl === remote.serverUrl &&
    output.remote.userId === remote.userId &&
    output.remote.key === remote.key
      ? output.status
      : null;
  const current = status?.entries[status.index];
  const upcoming = status ? status.entries.slice(status.index + 1) : [];
  const rows = frozen?.items ?? upcoming;

  useEffect(() => {
    let live = true;
    alive.current = true;
    void (async () => {
      const tv = await getTvRemote(serverUrl, userId);
      if (!tv) throw new Error("Pair Pocket with Aurral TV to open its queue.");
      const state = await readTvSnapshot(tv);
      if (live) {
        setRemote(tv);
        selectTvOutput(tv, state);
      }
    })().catch((e) => {
      if (live)
        setError(e instanceof Error ? e.message : "Couldn’t reach your TV.");
    });
    return () => {
      live = false;
      alive.current = false;
    };
  }, [serverUrl, userId, retry]);

  async function run(work: () => Promise<void>, refresh = true) {
    if (!remote || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "The TV could not make that change.",
        );
    } finally {
      if (refresh && alive.current) {
        try {
          const next = await readTvSnapshot(remote, status);
          if (alive.current) updateTvOutput(remote, next);
        } catch (e) {
          if (alive.current)
            setError(
              (old) =>
                old ||
                (e instanceof Error ? e.message : "Couldn’t refresh your TV."),
            );
        }
      }
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function edit(cmd: TvEdit, sessionId = status?.sessionId) {
    if (remote && sessionId)
      await run(async () => {
        await editTvQueue(remote, sessionId, cmd);
      });
  }
  function transport(action: "pause" | "resume" | "next" | "previous") {
    if (remote && status?.sessionId)
      void run(async () => {
        await controlTv(remote, { action, sessionId: status.sessionId! });
      });
  }
  function chooseFlow() {
    if (flows) {
      setFlows(null);
      return;
    }
    void run(async () => {
      const { flows: list } = await getFlowStatus();
      if (alive.current) setFlows(list.map(({ id, name }) => ({ id, name })));
    }, false);
  }
  function handback() {
    if (remote)
      void run(async () => {
        await continueOnPhone(remote, () => alive.current);
        if (alive.current) {
          clearTvOutput();
          onClose();
        }
      }, false);
  }
  const cancelDrag = useCallback(() => setFrozen(null), []);
  function reorder({ from, to }: { from: number; to: number }) {
    const basis = frozen;
    if (!basis || !basis.items[from] || !basis.items[to] || from === to) {
      setFrozen(null);
      return;
    }
    const changed = reorderItems(basis.items, from, to);
    setFrozen({ sessionId: basis.sessionId, items: changed });
    void edit(
      {
        action: "move",
        entryId: basis.items[from].entryId,
        beforeEntryId: changed[to + 1]?.entryId ?? null,
      },
      basis.sessionId,
    ).finally(() => {
      if (alive.current) setFrozen(null);
    });
  }
  function close() {
    if (!locked.current) onClose();
  }
  function leave() {
    if (!locked.current) {
      clearTvOutput();
      onClose();
    }
  }
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
    >
      <GestureHandlerRootView style={styles.fill}>
        <SafeAreaView
          style={[styles.fill, { backgroundColor: colors.background }]}
        >
          <View style={styles.top}>
            <Text variant="subtitle">Aurral TV</Text>
            <IconButton
              icon="close"
              label="Close TV queue"
              onPress={close}
              disabled={busy}
            />
          </View>
          <ReorderableList
            data={rows}
            keyExtractor={(item) => item.entryId}
            onReorder={reorder}
            onDragEnd={({ from, to }) => {
              "worklet";
              if (from === to) runOnJS(cancelDrag)();
            }}
            contentContainerStyle={styles.content}
            ListHeaderComponent={
              <View style={styles.header}>
                {output.remote && (
                  <View style={styles.leave}>
                    <Chip
                      label="Leave TV controls"
                      icon="exit-outline"
                      disabled={busy}
                      onPress={leave}
                    />
                  </View>
                )}
                {remote && !output.reachable && (
                  <Text variant="caption" accessibilityLiveRegion="polite">
                    Reconnecting to your TV…
                  </Text>
                )}
                {!!error && (
                  <Text variant="error" accessibilityRole="alert">
                    {error}
                  </Text>
                )}
                {!remote &&
                  (!error ? (
                    <ActivityIndicator color={colors.brand} />
                  ) : (
                    <Button
                      title="Try again"
                      onPress={() => {
                        setError("");
                        setRetry((n) => n + 1);
                      }}
                    />
                  ))}
                {status && !current && (
                  <Text>There’s nothing playing on this TV.</Text>
                )}
                {current && status && (
                  <>
                    <View style={styles.playing}>
                      <CoverArtImage
                        type="album"
                        mbid=""
                        coverUrl={current.artworkPath}
                        size={76}
                      />
                      <View style={styles.info}>
                        <Text variant="caption">
                          {status.buffering
                            ? "Buffering on TV"
                            : status.playing
                              ? "Playing on TV"
                              : "Paused on TV"}
                        </Text>
                        <Text variant="title" numberOfLines={2}>
                          {current.title}
                        </Text>
                        <Text variant="subtitle" numberOfLines={1}>
                          {current.artist}
                        </Text>
                        {!!current.albumName && (
                          <Text variant="caption" numberOfLines={1}>
                            {current.albumName}
                          </Text>
                        )}
                      </View>
                    </View>
                    <Slider
                      accessibilityLabel="TV playback position"
                      minimumValue={0}
                      maximumValue={status.durationMs || 1}
                      value={seek ?? status.positionMs}
                      disabled={!status.canSeek || !status.durationMs || busy}
                      minimumTrackTintColor={colors.brand}
                      maximumTrackTintColor={colors.separator}
                      onSlidingStart={() => {
                        seekEntry.current = current.entryId;
                        setSeek(status.positionMs);
                      }}
                      onValueChange={(v) => {
                        if (seekEntry.current) setSeek(v);
                      }}
                      onSlidingComplete={(v) => {
                        const id = seekEntry.current;
                        seekEntry.current = null;
                        setSeek(null);
                        if (id === current.entryId)
                          edit({
                            action: "seek",
                            entryId: id,
                            positionMs: Math.round(v),
                          });
                      }}
                    />
                    <View style={styles.times}>
                      <Text variant="caption">
                        {clock(seek ?? status.positionMs)}
                      </Text>
                      <Text variant="caption">
                        {status.durationMs ? clock(status.durationMs) : ""}
                      </Text>
                    </View>
                    <View style={styles.transport}>
                      <IconButton
                        icon="play-skip-back"
                        label="Previous on TV"
                        onPress={() => transport("previous")}
                        disabled={!status.index || busy}
                      />
                      <IconButton
                        selected
                        icon={status.playing ? "pause-circle" : "play-circle"}
                        label={status.playing ? "Pause TV" : "Resume TV"}
                        onPress={() =>
                          transport(status.playing ? "pause" : "resume")
                        }
                        disabled={busy}
                      />
                      <IconButton
                        icon="play-skip-forward"
                        label="Next on TV"
                        onPress={() => transport("next")}
                        disabled={!upcoming.length || busy}
                      />
                      <IconButton
                        icon="shuffle"
                        label="Shuffle upcoming songs"
                        selected={status.shuffle}
                        disabled={busy}
                        onPress={() =>
                          edit({ action: "shuffle", enabled: !status.shuffle })
                        }
                      />
                    </View>
                    <View style={styles.chips}>
                      <Chip
                        icon="phone-portrait-outline"
                        label={
                          Platform.OS === "ios"
                            ? "Continue on iPhone"
                            : "Continue on phone"
                        }
                        onPress={handback}
                        disabled={busy}
                      />
                      <Chip
                        icon="infinite-outline"
                        label={status.flowName || "Keep playing with a Flow"}
                        onPress={chooseFlow}
                        disabled={busy}
                      />
                    </View>
                    {flows && (
                      <View style={styles.flows}>
                        <Text variant="subtitle">When this queue ends</Text>
                        {[{ id: "", name: "Stop playing" }, ...flows].map(
                          (f) => (
                            <Pressable
                              key={f.id}
                              accessibilityRole="radio"
                              accessibilityState={{
                                checked: (status.flowId ?? "") === f.id,
                              }}
                              onPress={() => {
                                setFlows(null);
                                edit({ action: "flow", flowId: f.id || null });
                              }}
                              style={styles.option}
                            >
                              <Text style={styles.info}>{f.name}</Text>
                              {(status.flowId ?? "") === f.id && (
                                <Ionicons
                                  name="checkmark"
                                  size={20}
                                  color={colors.brand}
                                />
                              )}
                            </Pressable>
                          ),
                        )}
                        {flows.length === 0 && (
                          <Text variant="caption">
                            Create a Flow to keep playing after this queue ends.
                          </Text>
                        )}
                      </View>
                    )}
                    <Text variant="subtitle" accessibilityRole="header">
                      Up next · {upcoming.length}
                    </Text>
                  </>
                )}
              </View>
            }
            renderItem={({ item }) => (
              <QueueRow
                item={item}
                busy={busy}
                onHold={() => {
                  if (status?.sessionId)
                    setFrozen({ sessionId: status.sessionId, items: rows });
                }}
                onJump={() => edit({ action: "jump", entryId: item.entryId })}
                onRemove={() =>
                  edit({ action: "remove", entryId: item.entryId })
                }
                onPin={() => edit({ action: "pin", entryId: item.entryId })}
              />
            )}
          />
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  leave: { alignSelf: "flex-end" },
  fill: { flex: 1 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  content: { paddingHorizontal: 18, paddingBottom: 36 },
  header: { gap: 10, paddingBottom: 10 },
  playing: { flexDirection: "row", alignItems: "center", gap: 14 },
  info: { flex: 1, minWidth: 0 },
  times: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -6,
  },
  transport: { flexDirection: "row", justifyContent: "center", gap: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  flows: { gap: 4 },
  option: {
    flexDirection: "row",
    minHeight: 40,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
