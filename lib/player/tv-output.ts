import { useSyncExternalStore } from "react";
import type { TvRemote, TvSnapshot } from "@/lib/tv/remote";

type Output = {
  remote: TvRemote | null;
  status: TvSnapshot | null;
  selected: boolean;
  reachable: boolean;
};
const idle: Output = {
  remote: null,
  status: null,
  selected: false,
  reachable: false,
};
let output = idle;
let dismissed: { key: string; sessionId: string | null } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(value: Output) {
  if (output === value) return;
  output = value;
  for (const listener of listeners) listener();
}
export const getTvOutput = () => output;
export const useTvOutput = () =>
  useSyncExternalStore(subscribe, getTvOutput, getTvOutput);
export const useHasTvQueue = () =>
  useSyncExternalStore(subscribe, hasTvQueue, hasTvQueue);
const isTvSelected = () => output.selected;
export const useTvSelected = () =>
  useSyncExternalStore(subscribe, isTvSelected, isTvSelected);
function hasTvQueue() {
  return !!(
    output.remote &&
    output.status?.sessionId &&
    output.status.currentEntryId
  );
}
export function selectTvOutput(remote: TvRemote, status?: TvSnapshot) {
  dismissed = null;
  const last = output.remote?.key === remote.key ? output.status : null;
  publish({ remote, status: status ?? last, selected: true, reachable: true });
}
export function updateTvOutput(remote: TvRemote, status: TvSnapshot) {
  if (dismissed?.key === remote.key && dismissed.sessionId === status.sessionId)
    return;
  if (!status.sessionId || !status.currentEntryId) {
    if (output.remote?.key === remote.key) publish(idle);
    return;
  }
  const sameRemote = output.remote?.key === remote.key;
  if (
    sameRemote &&
    output.status?.sessionId === status.sessionId &&
    output.status.revision > status.revision
  )
    return;
  publish({
    remote,
    status,
    selected: sameRemote && output.selected,
    reachable: true,
  });
}
export function markTvUnreachable(remote: TvRemote) {
  if (output.remote?.key !== remote.key) return;
  if (!output.selected) publish(idle);
  else if (output.reachable) publish({ ...output, reachable: false });
}
export function clearTvOutput() {
  if (output.remote)
    dismissed = {
      key: output.remote.key,
      sessionId: output.status?.sessionId ?? null,
    };
  publish(idle);
}
export function resetTvOutput() {
  dismissed = null;
  publish(idle);
}
