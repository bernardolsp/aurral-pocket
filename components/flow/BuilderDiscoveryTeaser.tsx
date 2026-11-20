import { StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Text } from "@/components/ui/Text";
import { Fonts } from "@/constants/theme";
import {
  previewBuilder,
  type BuilderRecipe,
  type BuilderTrack,
  type RecommendationMode,
} from "@/lib/api/playlist-builder";

type Props = {
  recipe: BuilderRecipe;
  tracks: BuilderTrack[];
  saving: boolean;
  expanding: boolean;
  error?: string;
  onExpand: (mode: RecommendationMode) => void;
};

export function BuilderDiscoveryTeaser({
  recipe,
  tracks,
  saving,
  expanding,
  error,
  onExpand,
}: Props) {
  const comparison = useMutation({ mutationFn: previewBuilder });
  const teaser = comparison.data?.discoveryTeaser ?? tracks;
  const offline = recipe.recommendationMode === "offline";
  const canCheck = offline && !comparison.isSuccess;
  return (
    <Card style={styles.card}>
      <SectionLabel>Discovery could add</SectionLabel>
      {teaser.length > 0 ? (
        <>
          {canCheck && (
            <Text variant="caption">From cached recommendations.</Text>
          )}
          {teaser.map((track) => (
            <View key={track.id}>
              <Text style={styles.song}>{track.trackName}</Text>
              <Text variant="caption">{track.artistName}</Text>
            </View>
          ))}
          {offline && comparison.isSuccess && (
            <Text variant="caption">
              Including these discoveries enables online recommendations for
              this mix.
            </Text>
          )}
          {error && <Text variant="error">{error}</Text>}
          <Button
            variant="inline"
            title={expanding ? "Updating preview…" : "Include discoveries"}
            disabled={saving || expanding || comparison.isPending}
            onPress={() => onExpand(canCheck ? "offline" : "online")}
          />
        </>
      ) : (
        <Text variant="caption">
          {canCheck
            ? "Check the catalog once to see songs outside your Library."
            : "No additional catalog songs found for this mix."}
        </Text>
      )}
      {canCheck && (
        <>
          {comparison.isError && (
            <Text variant="error">{comparison.error.message}</Text>
          )}
          <Button
            variant="inline"
            title={
              comparison.isPending ? "Checking Discovery…" : "Check Discovery"
            }
            disabled={saving || expanding || comparison.isPending}
            onPress={() =>
              comparison.mutate({ ...recipe, recommendationMode: "online" })
            }
          />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 8 },
  song: Fonts.medium,
});
