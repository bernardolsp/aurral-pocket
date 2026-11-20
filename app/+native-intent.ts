import { receiveTvLink } from "@/lib/tv/pairing-link";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  if (!/^aurralpocket:\/\/tv-pair(?:[/?#]|$)/i.test(path)) return path;
  receiveTvLink(path);
  // Navigation history contains only the screen name.
  return "/tv-setup";
}
