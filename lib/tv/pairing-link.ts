export interface TvLink {
  address: string;
  port: number;
  id: string;
  key: string;
}

export function parseTvLink(raw: string): TvLink | null {
  // Parse the QR's literal fields before any URL normalization can reinterpret
  // a hostname, integer host, non-decimal address, or encoded delimiter.
  if (
    raw.length > 300 ||
    !/^aurralpocket:\/\/tv-pair\?[a-zA-Z0-9_.=&-]+$/.test(raw)
  )
    return null;
  const params = new URLSearchParams(raw.slice(raw.indexOf("?") + 1));
  const fields = ["v", "address", "port", "id", "key"];
  if (
    [...params.keys()].length !== fields.length ||
    fields.some((name) => params.getAll(name).length !== 1) ||
    params.get("v") !== "1"
  )
    return null;
  const portText = params.get("port")!;
  if (!/^[1-9][0-9]{0,4}$/.test(portText)) return null;
  const link = {
    address: params.get("address")!,
    port: Number(portText),
    id: params.get("id")!,
    key: params.get("key")!,
  };
  return validTvLink(link) ? link : null;
}

export function validTvLink({ address, port, id, key }: TvLink) {
  const octets = address.split(".");
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !/^(0|[1-9][0-9]{0,2})$/.test(octet) || Number(octet) > 255,
    )
  )
    return false;
  const [a, b] = octets.map(Number);
  if (
    a !== 10 &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && b === 168)
  )
    return false;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  // The last base64url character encodes four data bits and two zero bits.
  if (
    !/^[a-f0-9]{32}$/.test(id) ||
    !/^[a-zA-Z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(key)
  )
    return false;
  return true;
}

export type PendingLink = {
  link: TvLink;
  signal: AbortSignal;
  sequence: number;
};
let sequence = 0;
let pending: PendingLink | "sent" | null = null;
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
export function subscribeTvLink(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getPendingTvLink = () => pending;

export function clearTvLink(
  expected: typeof pending,
  result: "sent" | null = null,
) {
  if (expected !== pending || expected === result) return;
  controller?.abort();
  controller = undefined;
  clearTimeout(timer);
  pending = result;
  listeners.forEach((listener) => listener());
}

export function receiveTvLink(raw: string) {
  clearTvLink(pending);
  const link = parseTvLink(raw);
  if (link) {
    controller = new AbortController();
    const current = { link, signal: controller.signal, sequence: ++sequence };
    pending = current;
    timer = setTimeout(() => clearTvLink(current), 120_000);
    listeners.forEach((listener) => listener());
  }
}
