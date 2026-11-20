import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { useDebouncedValue } from "@/hooks/search/use-debounced-value";
import {
  searchBuilderArtists,
  type BuilderArtist,
  type BuilderSource,
  type RecommendationMode,
} from "@/lib/api/playlist-builder";

export function artistKey(artist: BuilderArtist) {
  return (
    artist.mbid ?? String(artist.libraryArtistId ?? artist.name.toLowerCase())
  );
}

export function BuilderArtistPicker({
  source,
  recommendationMode,
  onPick,
  excluded = [],
  label,
}: {
  source: BuilderSource;
  recommendationMode?: RecommendationMode;
  onPick: (artist: BuilderArtist) => void;
  excluded?: BuilderArtist[];
  label: string;
}) {
  const [query, setQuery] = useState("");
  const term = useDebouncedValue(query.trim());
  const search = useQuery({
    queryKey: ["playlist-builder", "artists", source, recommendationMode, term],
    queryFn: ({ signal }) =>
      searchBuilderArtists(source, term, signal, recommendationMode),
    enabled: term.length > 0 && query.trim() === term,
    staleTime: 60_000,
    retry: false,
  });
  const matches = search.data?.filter(
    (artist) =>
      !excluded.some((other) => artistKey(artist) === artistKey(other)),
  );
  return (
    <View style={styles.field}>
      <Input
        placeholder={label}
        accessibilityLabel={label}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
        maxLength={500}
      />
      {query.trim().length > 0 &&
        (query.trim() !== term || search.isLoading ? (
          <ActivityIndicator accessibilityLabel="Searching artists" />
        ) : search.isError ? (
          <>
            <Text variant="error">{search.error.message}</Text>
            <Button
              variant="inline"
              title="Retry search"
              onPress={() => void search.refetch()}
            />
          </>
        ) : matches?.length ? (
          matches.map((artist) => (
            <Card
              key={artistKey(artist)}
              accessibilityRole="button"
              accessibilityLabel={artist.name}
              style={styles.result}
              onPress={() => {
                setQuery("");
                onPick(artist);
              }}
            >
              <Text>{artist.name}</Text>
            </Card>
          ))
        ) : (
          <Text variant="caption">No matching artists.</Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  result: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center" },
});
