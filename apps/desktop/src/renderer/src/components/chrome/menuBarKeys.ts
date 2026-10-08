import type { MenuBar } from "@shared/menu/types";

/**
 * Finds the top-level menu a key opens while menu mode is active.
 *
 * @param bar - the current menu bar.
 * @param key - `KeyboardEvent.key` pressed after tapping Alt or F10.
 * @returns the submenu's id, or null when no enabled menu uses that access key.
 */
export function menuForAccessKey(bar: MenuBar, key: string): string | null {
  if (key.length !== 1) return null;

  const accessKey = key.toUpperCase();
  const menu = bar.find(
    (item) => item.kind === "submenu" && item.enabled && item.accessKey === accessKey,
  );
  return menu?.id ?? null;
}

/**
 * Splits a label around its access key for underlining.
 *
 * @returns the text before the key, the key itself, and the text after it;
 * the key is empty when the label does not contain it.
 */
export function splitAccessKey(
  label: string,
  accessKey: string | null,
): readonly [string, string, string] {
  if (!accessKey) return [label, "", ""];

  const index = label.toUpperCase().indexOf(accessKey.toUpperCase());
  if (index < 0) return [label, "", ""];

  return [label.slice(0, index), label.charAt(index), label.slice(index + 1)];
}
