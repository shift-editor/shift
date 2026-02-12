import type { KeyChord, NormalizedKeyboardEvent } from "./types";

export function normalizeKeyboardEvent(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): NormalizedKeyboardEvent {
  return {
    key: normalizeKey(e.key),
    code: e.code,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    primaryModifier: e.metaKey || e.ctrlKey,
  };
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function matchChord(event: NormalizedKeyboardEvent, chord: KeyChord): boolean {
  if (chord.key !== undefined && event.key !== normalizeKey(chord.key)) return false;
  if (chord.code !== undefined && event.code !== chord.code) return false;
  if (chord.metaKey !== undefined && event.metaKey !== chord.metaKey) return false;
  if (chord.ctrlKey !== undefined && event.ctrlKey !== chord.ctrlKey) return false;
  if (chord.shiftKey !== undefined && event.shiftKey !== chord.shiftKey) return false;
  if (chord.altKey !== undefined && event.altKey !== chord.altKey) return false;
  if (chord.primaryModifier !== undefined && event.primaryModifier !== chord.primaryModifier) {
    return false;
  }
  return true;
}
