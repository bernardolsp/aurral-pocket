import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CircleButton } from "@/components/ui/CircleButton";
import { Text } from "@/components/ui/Text";
import { Fonts, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import type { BuilderHops } from "@/lib/api/playlist-builder";

const choices = [1, 2, 3] as const;
const explanation =
  "One hop finds songs like your seed songs. If a favorite acoustic track leads to a folk ballad, two hops also explore songs like that ballad. Three hops follow those matches one step further.";

export function BuilderAdvancedOptions({
  value,
  onChange,
}: {
  value: BuilderHops;
  onChange: (value: BuilderHops) => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Advanced options"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.heading}
      >
        <Text style={styles.label}>Advanced</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.subtle}
        />
      </Pressable>
      {open && (
        <>
          <View style={styles.labelRow}>
            <Text>Max hops</Text>
            <CircleButton
              size={32}
              icon="information-circle-outline"
              accessibilityLabel="About max hops"
              onPress={() => Alert.alert("Max hops", explanation)}
            />
          </View>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Max hops"
            style={styles.choices}
          >
            {choices.map((hops) => {
              const selected = hops === value;
              const label = hops === 1 ? "1 hop" : `${hops} hops`;
              return (
                <Pressable
                  key={hops}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: selected }}
                  onPress={() => onChange(hops)}
                  style={({ pressed }) => [
                    styles.choice,
                    {
                      backgroundColor: selected
                        ? colors.brand
                        : colors.inputBackground,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: selected ? colors.buttonPrimaryText : colors.text,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  heading: {
    minHeight: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: Fonts.semiBold,
  labelRow: {
    minHeight: 44,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  choices: { flexDirection: "row", gap: 6 },
  choice: {
    flex: 1,
    minHeight: 44,
    padding: 8,
    borderRadius: Radius.compact,
    alignItems: "center",
    justifyContent: "center",
  },
});
