import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { serverImageSource } from "@/lib/api/client";
import { useRouter } from "expo-router";
import * as Burnt from "burnt";
import {
  BuilderArtistPicker,
  artistKey,
} from "@/components/flow/BuilderArtistPicker";
import { FlowAccessGate } from "@/components/flow/FlowAccessGate";
import { SegmentedRow } from "@/components/flow/SegmentedRow";
import { SizeStepper } from "@/components/flow/SizeStepper";
import { BuilderAdvancedOptions } from "@/components/flow/BuilderAdvancedOptions";
import { BuilderDiscoveryTeaser } from "@/components/flow/BuilderDiscoveryTeaser";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Text } from "@/components/ui/Text";
import { ScreenCenter } from "@/components/ui/ScreenCenter";
import { Fonts } from "@/constants/theme";
import { useServerHealth } from "@/hooks/auth/use-server-health";
import { useColors } from "@/hooks/use-colors";
import {
  getBuilderOptions,
  previewBuilder,
  saveBuilder,
  type BuilderArtist,
  type BuilderHops,
  type BuilderRecipe,
  type BuilderPreview,
  type RecommendationMode,
  type BuilderSource,
  type BuilderTrack,
} from "@/lib/api/playlist-builder";
import { flowKeys } from "@/lib/query-keys";

const sources: { value: BuilderSource; label: string }[] = [
  { value: "library", label: "My Library" },
  { value: "discovery", label: "Library + discovery" },
];

export function PlaylistBuilderScreen() {
  return (
    <FlowAccessGate message="You don't have access to Playlists">
      <BuilderAccess />
    </FlowAccessGate>
  );
}

function BuilderAccess() {
  const health = useServerHealth();
  if (health.isLoading)
    return (
      <ScreenCenter>
        <ActivityIndicator />
      </ScreenCenter>
    );
  if (health.isError)
    return (
      <ScreenCenter>
        <Text variant="error">{health.error.message}</Text>
        <Button
          variant="inline"
          title="Retry"
          onPress={() => void health.refetch()}
        />
      </ScreenCenter>
    );
  if (!health.data?.api?.features.includes("playlistBuilder"))
    return (
      <ScreenCenter>
        <Text>Your server does not offer Playlist Builder.</Text>
      </ScreenCenter>
    );
  return (
    <BuilderForm
      exploreFurther={health.data.api.features.includes(
        "playlistBuilderExploreFurther",
      )}
      recommendationsAvailable={health.data.api.features.includes(
        "playlistBuilderRecommendations",
      )}
    />
  );
}

function BuilderForm({
  recommendationsAvailable,
  exploreFurther,
}: {
  recommendationsAvailable: boolean;
  exploreFurther: boolean;
}) {
  const colors = useColors();
  const scroll = useRef<ScrollViewInstance>(null);
  const [source, setSource] = useState<BuilderSource>("library");
  const [artist, setArtist] = useState<BuilderArtist | null>(null);
  const [selectedSeeds, setSelectedSeeds] = useState<BuilderTrack[]>([]);
  const seedIds = selectedSeeds.map((track) => track.id);
  const [online, setOnline] = useState(true);
  const recommendationMode = recommendationsAvailable
    ? online
      ? "online"
      : "offline"
    : undefined;
  const [removedSeeds, setRemovedSeeds] = useState(0);
  const [similar, setSimilar] = useState<BuilderArtist[]>([]);
  const [size, setSize] = useState(20);
  const [maxHops, setMaxHops] = useState<BuilderHops>(1);
  const [expanded, setExpanded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const options = useQuery({
    queryKey: [
      "playlist-builder",
      "options",
      source,
      recommendationMode,
      artist,
    ],
    queryFn: ({ signal }) =>
      getBuilderOptions(source, artist!, signal, recommendationMode),
    enabled: !!artist && !reviewing,
    staleTime: 60_000,
    retry: false,
  });
  const preview = useMutation({ mutationFn: previewBuilder });
  function chooseArtist(next: BuilderArtist | null) {
    Keyboard.dismiss();
    setArtist(next);
    setSelectedSeeds([]);
    setRemovedSeeds(0);
    setSimilar([]);
    setExpanded(false);
  }
  function chooseMode(nextSource: BuilderSource, nextOnline: boolean) {
    if (!recommendationsAvailable) {
      chooseArtist(null);
    } else {
      const eligible =
        nextSource === "library" || !nextOnline
          ? selectedSeeds.filter((track) => track.source === "library")
          : selectedSeeds;
      setRemovedSeeds(selectedSeeds.length - eligible.length);
      setSelectedSeeds(eligible);
    }
    setSource(nextSource);
    setOnline(nextOnline);
  }
  function toggleSeed(track: BuilderTrack) {
    const next = seedIds.includes(track.id)
      ? selectedSeeds.filter((entry) => entry.id !== track.id)
      : [...selectedSeeds, track];
    setRemovedSeeds(0);
    setSelectedSeeds(next);
    setSize(Math.max(size, Math.max(1, next.length) + similar.length));
  }
  function includeArtist(item: BuilderArtist) {
    setSimilar([...similar, item]);
    setSize(Math.max(size, Math.max(1, seedIds.length) + similar.length + 1));
  }
  function requestPreview() {
    if (!artist) return;
    Keyboard.dismiss();
    setReviewing(true);
    scroll.current?.scrollTo({ y: 0, animated: false });
    preview.mutate({
      source,
      ...(recommendationMode && { recommendationMode }),
      ...(exploreFurther && { maxHops }),
      artist,
      seedTrackIds: seedIds,
      similarArtists: similar,
      size,
    });
  }
  const seeds = options.data?.tracks ?? [];
  const suggestions =
    options.data?.similarArtists.filter(
      (item) =>
        ![artist, ...similar].some(
          (entry) => entry && artistKey(entry) === artistKey(item),
        ),
    ) ?? [];
  return (
    <ScrollView
      ref={scroll}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      {reviewing && artist ? (
        preview.isPending ? (
          <ScreenCenter>
            <ActivityIndicator accessibilityLabel="Building preview" />
            <Text variant="subtitle">Building your playlist…</Text>
          </ScreenCenter>
        ) : preview.isError ? (
          <>
            <Text variant="error">{preview.error.message}</Text>
            <Button title="Retry preview" onPress={requestPreview} />
            <Button
              variant="inline"
              title="Edit mix"
              onPress={() => setReviewing(false)}
            />
          </>
        ) : preview.data && preview.variables ? (
          <BuilderReview
            recipe={preview.variables}
            result={preview.data}
            onBack={(recipe) => {
              setSource(recipe.source);
              if (recipe.recommendationMode)
                setOnline(recipe.recommendationMode === "online");
              setReviewing(false);
            }}
          />
        ) : null
      ) : (
        <>
          <View style={styles.section}>
            <SectionLabel>Track source</SectionLabel>
            <SegmentedRow
              options={sources}
              value={source}
              onChange={(next) => {
                if (next !== source) chooseMode(next, online);
              }}
            />
            {recommendationsAvailable ? (
              <>
                <View style={styles.switchRow}>
                  <Text style={styles.song}>Online recommendations</Text>
                  <Switch
                    accessibilityLabel="Online recommendations"
                    value={online}
                    onValueChange={(value) => chooseMode(source, value)}
                  />
                </View>
                <Text variant="caption">
                  {online
                    ? source === "library"
                      ? "Check recommendations online and keep only songs in your Library."
                      : "Find recommendations in your Library and the discovery catalog."
                    : "Use your Library and previously cached recommendations."}
                </Text>
                {removedSeeds > 0 && (
                  <Text variant="caption">
                    {removedSeeds} catalog-only{" "}
                    {removedSeeds === 1 ? "seed was" : "seeds were"} removed.
                  </Text>
                )}
              </>
            ) : (
              <Text variant="caption">
                {source === "library"
                  ? "Use songs already in your Aurral Library."
                  : "Include songs from your Library and the discovery catalog."}
              </Text>
            )}
          </View>
          <View style={styles.section}>
            <SectionLabel>Main artist</SectionLabel>
            {artist ? (
              <Card style={styles.artist}>
                <BuilderPortrait
                  artist={artist}
                  source={source}
                  recommendationMode={recommendationMode}
                />
                <Text style={styles.artistName}>{artist.name}</Text>
                <Button
                  variant="inline"
                  title="Change"
                  onPress={() => chooseArtist(null)}
                />
              </Card>
            ) : (
              <BuilderArtistPicker
                key={source}
                source={source}
                recommendationMode={recommendationMode}
                label="Find a main artist"
                onPick={chooseArtist}
              />
            )}
          </View>
          {artist && (
            <>
              {options.isLoading ? (
                <ActivityIndicator accessibilityLabel="Loading songs and artists" />
              ) : options.isError ? (
                <View>
                  <Text variant="error">{options.error.message}</Text>
                  <Button
                    variant="inline"
                    title="Retry artist options"
                    onPress={() => void options.refetch()}
                  />
                </View>
              ) : (
                <View style={styles.section}>
                  <SectionLabel>Seed songs · {seedIds.length}/5</SectionLabel>
                  {!seeds.length && (
                    <Text variant="caption">
                      No seed songs available for {artist.name}.
                    </Text>
                  )}
                  {(expanded ? seeds : seeds.slice(0, 5)).map((track) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      selected={seedIds.includes(track.id)}
                      disabled={
                        !seedIds.includes(track.id) && seedIds.length >= 5
                      }
                      onPress={() => toggleSeed(track)}
                    />
                  ))}
                  {seeds.length > 5 && (
                    <Button
                      variant="inline"
                      title={
                        expanded
                          ? "Show fewer songs"
                          : `Show all ${seeds.length} songs`
                      }
                      onPress={() => setExpanded(!expanded)}
                    />
                  )}
                </View>
              )}
              <View style={styles.section}>
                <SectionLabel>
                  Similar artists · {similar.length}/5
                </SectionLabel>
                {similar.length > 0 && (
                  <View style={styles.chips}>
                    {similar.map((item) => (
                      <Chip
                        key={artistKey(item)}
                        label={item.name}
                        size="md"
                        variant="brand"
                        onRemove={() =>
                          setSimilar(
                            similar.filter(
                              (entry) => artistKey(entry) !== artistKey(item),
                            ),
                          )
                        }
                      />
                    ))}
                  </View>
                )}
                {similar.length < 5 && (
                  <>
                    {!!suggestions.length && (
                      <View style={styles.chips}>
                        {suggestions.map((item) => (
                          <Chip
                            key={artistKey(item)}
                            icon="add"
                            size="md"
                            label={item.name}
                            onPress={() => includeArtist(item)}
                          />
                        ))}
                      </View>
                    )}
                    <BuilderArtistPicker
                      key={artistKey(artist)}
                      source={source}
                      recommendationMode={recommendationMode}
                      excluded={[artist, ...similar]}
                      label="Add another artist"
                      onPick={includeArtist}
                    />
                  </>
                )}
              </View>
              <View style={styles.section}>
                <SectionLabel>Playlist length</SectionLabel>
                <SizeStepper
                  min={Math.max(1, seedIds.length) + similar.length}
                  value={size}
                  onChange={setSize}
                />
              </View>
              {exploreFurther && (
                <BuilderAdvancedOptions value={maxHops} onChange={setMaxHops} />
              )}
              <Button title="Preview playlist" onPress={requestPreview} />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function BuilderPortrait({
  artist,
  source,
  recommendationMode,
}: {
  artist: BuilderArtist;
  source: BuilderSource;
  recommendationMode?: RecommendationMode;
}) {
  const colors = useColors();
  const path = artist.libraryArtistId
    ? `/api/library/artists/${artist.libraryArtistId}/cover?cachedOnly=1`
    : source === "discovery" && recommendationMode !== "offline" && artist.mbid
      ? `/api/artists/${artist.mbid}/image`
      : null;
  return (
    <View style={[styles.portrait, { backgroundColor: colors.brandMuted }]}>
      <Ionicons name="musical-notes" size={24} color={colors.brand} />
      {path && (
        <Image
          source={serverImageSource(path)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={path}
        />
      )}
    </View>
  );
}

const pickReasonLabels = {
  seed: "Your seed song",
  recording: "Similar to a seed song",
  chosenArtist: "Selected artist",
  relatedArtist: "Related artist",
  genre: "Shared genre",
};

function TrackRow({
  track,
  selected,
  disabled,
  onPress,
}: {
  track: BuilderTrack;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const reason =
    track.pickReason === "recording" &&
    track.recommendationHop &&
    track.recommendationHop > 1
      ? `${track.recommendationHop} hops from a seed song`
      : track.pickReason && pickReasonLabels[track.pickReason];
  return (
    <Card
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={[
        track.trackName,
        track.artistName,
        track.source === "library" ? "Library" : "Discovery",
        reason,
      ]
        .filter(Boolean)
        .join(", ")}
      style={[styles.track, disabled && styles.disabled]}
    >
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={21}
        color={selected ? colors.brand : colors.subtle}
      />
      <View style={styles.trackText}>
        <Text numberOfLines={2} style={styles.song}>
          {track.trackName}
        </Text>
        <Text variant="caption" numberOfLines={2}>
          {[
            track.artistName,
            track.albumName,
            track.source === "library" ? "Library" : "Discovery",
            reason,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
    </Card>
  );
}

function BuilderReview({
  recipe,
  result,
  onBack,
}: {
  recipe: BuilderRecipe;
  result: BuilderPreview;
  onBack: (recipe: BuilderRecipe) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(`${recipe.artist.name} mix`);
  const [omitted, setOmitted] = useState<string[]>([]);
  const expansion = useMutation({ mutationFn: previewBuilder });
  const save = useMutation({ mutationFn: saveBuilder });
  const active =
    expansion.data && expansion.variables ? expansion.variables : recipe;
  const { artist, size, source, recommendationMode } = active;
  const { tracks, missingArtists, recommendationBasis } =
    expansion.data ?? result;
  const accepted = tracks.filter((track) => !omitted.includes(track.id));
  const busy = save.isPending || expansion.isPending;
  function submit() {
    if (!accepted.length || !name.trim() || busy) return;
    save.mutate(
      {
        source,
        ...(recommendationMode && { recommendationMode }),
        name: name.trim(),
        tracks: accepted,
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: flowKeys.status() });
          Burnt.toast({
            title: "Playlist queued",
            message: name.trim(),
            preset: "done",
          });
          router.replace("/(app)/(tabs)/(library)/playlists");
        },
      },
    );
  }
  return (
    <>
      <View style={styles.section}>
        <SectionLabel>Playlist preview</SectionLabel>
        <View style={styles.reviewArtist}>
          <BuilderPortrait
            artist={artist}
            source={source}
            recommendationMode={recommendationMode}
          />
          <Text variant="title" style={styles.trackText}>
            {artist.name} mix
          </Text>
        </View>
        <Text variant="subtitle">
          {tracks.length < size
            ? `Found ${tracks.length} of ${size} requested songs.`
            : `${tracks.length} songs`}
        </Text>
        {recommendationMode && recommendationBasis && (
          <Text variant="caption">
            {recommendationBasis === "recording"
              ? "Based on your seed songs."
              : "Based on your artists."}
          </Text>
        )}
        {missingArtists.length > 0 && (
          <Text variant="caption">
            No available songs from {missingArtists.join(", ")}.
          </Text>
        )}
        <Button
          variant="inline"
          title="Edit mix"
          disabled={busy}
          onPress={() => onBack(active)}
        />
      </View>
      {!!tracks.length && (
        <>
          <Input
            value={name}
            onChangeText={setName}
            editable={!busy}
            accessibilityLabel="Playlist name"
            placeholder="Playlist name"
            maxLength={500}
          />
          {save.isError && <Text variant="error">{save.error.message}</Text>}
          <Button
            title={`Save ${accepted.length} ${accepted.length === 1 ? "song" : "songs"}`}
            disabled={!accepted.length || !name.trim() || expansion.isPending}
            loading={save.isPending}
            onPress={submit}
          />
        </>
      )}
      {source === "library" && recommendationMode && (
        <BuilderDiscoveryTeaser
          recipe={recipe}
          tracks={result.discoveryTeaser ?? []}
          saving={save.isPending}
          expanding={expansion.isPending}
          error={expansion.error?.message}
          onExpand={(mode) =>
            expansion.mutate({
              ...recipe,
              source: "discovery",
              recommendationMode: mode,
            })
          }
        />
      )}
      <View style={styles.section}>
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            disabled={busy}
            selected={!omitted.includes(track.id)}
            onPress={() =>
              setOmitted((current) =>
                current.includes(track.id)
                  ? current.filter((id) => id !== track.id)
                  : [...current, track.id],
              )
            }
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 20 },
  section: { gap: 6 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  artist: { padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  portrait: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  artistName: { flex: 1, ...Fonts.bold, fontSize: 18 },
  track: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  reviewArtist: { flexDirection: "row", alignItems: "center", gap: 12 },
  trackText: { flex: 1 },
  song: { ...Fonts.medium },
  disabled: { opacity: 0.5 },
});
