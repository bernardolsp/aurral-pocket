import * as SecureStore from "expo-secure-store";

const storageKey = "aurral.paired-tv.remote";
export type TvRemote = {
  address: string;
  key: string;
  serverUrl: string;
  userId: number;
};
export function privateAddress(address: string) {
  const fields = address.split(".");
  if (
    fields.length !== 4 ||
    !fields.every((x) => /^(0|[1-9][0-9]{0,2})$/.test(x) && +x < 256)
  )
    return false;
  const [a, b] = fields.map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

export function rememberTvRemote(remote: TvRemote) {
  return SecureStore.setItemAsync(storageKey, JSON.stringify(remote), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
export function forgetTvRemote() {
  return SecureStore.deleteItemAsync(storageKey);
}
export async function getTvRemote(
  serverUrl: string,
  userId: number,
): Promise<TvRemote | null> {
  const raw = await SecureStore.getItemAsync(storageKey);
  if (!raw) return null;
  try {
    const item = JSON.parse(raw) as TvRemote;
    if (
      item.userId === userId &&
      item.serverUrl === serverUrl &&
      typeof item.address === "string" &&
      privateAddress(item.address) &&
      typeof item.key === "string" &&
      /^[a-f0-9]{64}$/.test(item.key)
    )
      return item;
  } catch {
    /* An older or incomplete pairing can be replaced by scanning again. */
  }
  return null;
}
