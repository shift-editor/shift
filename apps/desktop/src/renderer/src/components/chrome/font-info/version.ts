import type { FontMetadata } from "@shift/types";

export function versionText(metadata: FontMetadata): string {
  return metadata.versionMajor === undefined
    ? ""
    : `${metadata.versionMajor}.${metadata.versionMinor ?? 0}`;
}

export function parseVersion(
  value: string,
): Pick<FontMetadata, "versionMajor" | "versionMinor"> | null {
  const trimmed = value.trim();
  if (!trimmed) return { versionMajor: undefined, versionMinor: undefined };

  const match = trimmed.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;

  return {
    versionMajor: Number.parseInt(match[1], 10),
    versionMinor: match[2] ? Number.parseInt(match[2], 10) : 0,
  };
}
