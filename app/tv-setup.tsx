import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { useAuth } from "@/contexts/auth-context";
import { useServerHealth } from "@/hooks/auth/use-server-health";
import { useColors } from "@/hooks/use-colors";
import {
  clearTvLink,
  getPendingTvLink,
  type PendingLink,
  subscribeTvLink,
} from "@/lib/tv/pairing-link";
import { sendTvSetup, tvFingerprint, validTvSettings } from "@/lib/tv/pairing";

export default function TvSetupScreen() {
  const request = useSyncExternalStore(
    subscribeTvLink,
    getPendingTvLink,
    () => null,
  );
  return (
    <TvSetupContent
      key={
        typeof request === "object" && request
          ? request.sequence
          : (request ?? "empty")
      }
      request={request}
    />
  );
}

function TvSetupContent({ request }: { request: PendingLink | "sent" | null }) {
  const colors = useColors();
  const router = useRouter();
  const { serverUrl, token, customHeaders } = useAuth();
  const health = useServerHealth();
  const pending = typeof request === "object" ? request : null;
  const sent = request === "sent";
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState("");
  const operation = useRef<AbortController | null>(null);
  const fingerprint = pending ? tvFingerprint(pending.link) : null;
  useEffect(
    () => () => {
      clearTvLink(request);
    },
    [request],
  );
  // A change of signed-in session or server invalidates a send in progress.
  useEffect(
    () => () => {
      operation.current?.abort();
    },
    [serverUrl, token, customHeaders],
  );

  function dismiss() {
    clearTvLink(request);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  async function confirm() {
    if (
      !pending ||
      pending.signal.aborted ||
      !serverUrl ||
      !token ||
      !fingerprint ||
      operation.current ||
      notice
    )
      return;
    const active = new AbortController();
    operation.current = active;
    const cancel = () => active.abort();
    pending.signal.addEventListener("abort", cancel, { once: true });
    const deadline = setTimeout(cancel, 20_000);
    setSending(true);
    setFailure("");
    try {
      await sendTvSetup(pending.link, serverUrl, customHeaders, active.signal);
      if (!active.signal.aborted) {
        clearTvLink(pending, "sent");
      }
    } catch {
      if (!pending.signal.aborted)
        setFailure(
          "The TV did not confirm setup. Check that both devices are on the same network and scan a new code on the TV.",
        );
    } finally {
      clearTimeout(deadline);
      pending.signal.removeEventListener("abort", cancel);
      if (operation.current === active) {
        operation.current = null;
        setSending(false);
      }
    }
  }

  let notice = "";
  if (sent)
    notice =
      "Your TV received its sign-in and server settings. Continue on the TV.";
  else if (!pending)
    notice =
      "Open setup on your TV and scan its current QR code with your phone camera.";
  else if (!serverUrl || !token)
    notice = "Sign in to Pocket, then scan the QR code on your TV again.";
  else if (
    !validTvSettings(serverUrl, customHeaders) ||
    Object.values(customHeaders).some(
      (value) => value === token || value === "Bearer " + token,
    )
  )
    notice =
      "Your server address or a saved header is incompatible with TV setup. Review them in Settings.";
  else if (health.isPending) notice = "Checking your server’s pairing support…";
  else if (health.isError)
    notice =
      "Pocket could not reach your Aurral server. Check your connection and scan the TV again.";
  else if (!health.data?.api?.features?.includes("pairing"))
    notice =
      "Your Aurral server needs device pairing support to set up this TV.";

  const names = Object.keys(customHeaders);
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="title" accessibilityRole="header">
          {sent ? "Setup sent" : "Set up your TV"}
        </Text>
        {notice ? (
          <Text variant="subtitle">{notice}</Text>
        ) : (
          pending && (
            <>
              <Text variant="subtitle">
                Compare this fingerprint with the one on your TV before sharing
                access.
              </Text>
              <Card bordered style={styles.card}>
                <Text variant="caption">TV fingerprint</Text>
                <Text variant="title" selectable>
                  {fingerprint ?? "Checking…"}
                </Text>
                <Text variant="caption">
                  {pending.link.address}:{pending.link.port}
                </Text>
              </Card>
              <View style={styles.details}>
                <Text>
                  Your TV will receive a one-time sign-in code for this server.
                </Text>
                <Text variant="subtitle">{serverUrl}</Text>
                {names.length > 0 && (
                  <>
                    <Text>
                      These saved proxy headers and their values will also be
                      shared with this TV.
                    </Text>
                    <Text variant="subtitle">{names.join(", ")}</Text>
                  </>
                )}
              </View>
              {!!failure && (
                <Text variant="error" accessibilityRole="alert">
                  {failure}
                </Text>
              )}
              <Button
                accessibilityRole="button"
                title="Fingerprints match — send setup"
                disabled={!fingerprint || !!failure}
                loading={sending}
                onPress={confirm}
              />
            </>
          )
        )}
        <Button
          accessibilityRole="button"
          title={notice ? "Done" : "Cancel"}
          variant="inline"
          onPress={dismiss}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, padding: 24, gap: 18, justifyContent: "center" },
  card: { padding: 18, gap: 6 },
  details: { gap: 8 },
});
