import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/contexts/auth-context";
import { getTvRemote, readTvSnapshot } from "@/lib/tv/remote";
import {
  getTvOutput,
  markTvUnreachable,
  resetTvOutput,
  updateTvOutput,
} from "@/lib/player/tv-output";

/** Discover playback started with the physical remote and refresh after Pocket wakes. */
export function useTvSession() {
  const { serverUrl, user, token } = useAuth();
  const userId = user?.id;
  useEffect(() => {
    resetTvOutput();
    if (!serverUrl || userId == null || !token) return;
    let live = true;
    let foreground =
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive";
    let busy = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      clearTimeout(timer);
      if (busy || !foreground || !live) return;
      busy = true;
      let delay = 10000;
      try {
        const remote = await getTvRemote(serverUrl!, userId!);
        if (!live || !foreground) return;
        if (!remote) {
          resetTvOutput();
          return;
        }
        const before = getTvOutput();
        try {
          const previous =
            before.remote?.key === remote.key ? before.status : null;
          const status = await readTvSnapshot(remote, previous);
          if (live && foreground && before === getTvOutput())
            updateTvOutput(remote, status);
          if (status.sessionId && status.currentEntryId) delay = 1800;
        } catch {
          if (live && foreground && before === getTvOutput())
            markTvUnreachable(remote);
        }
      } catch {
        // Protected storage can be unavailable while iOS is locking.
      } finally {
        busy = false;
        if (live && foreground) timer = setTimeout(poll, delay);
      }
    }
    void poll();
    const change = AppState.addEventListener("change", (state) => {
      foreground = state === "active";
      if (foreground) void poll();
      else clearTimeout(timer);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      change.remove();
      resetTvOutput();
    };
  }, [serverUrl, userId, token]);
}
