import type { FontIntent, SourceId } from "@shift/types";
import type { SystemClipboard } from "../lib/clipboard";
import {
  createMemoryFontSession,
  memoryFontSession,
  newMemoryFontSource,
} from "../createMemoryFontSession";
import { SessionEngine } from "../lib/engine/SessionEngine";
import type { MemoryFontSession, MemoryToolName } from "../types/fontSession";

/** A clipboard held in memory, for sessions under test. */
export class MemoryClipboard implements SystemClipboard {
  #value = "";

  writeText(value: string): Promise<void> {
    this.#value = value;
    return Promise.resolve();
  }

  readText(): Promise<string> {
    return Promise.resolve(this.#value);
  }
}

/** What a new font's intents build on: the one source it starts with. */
export interface NewFontDefaults {
  readonly sourceId: SourceId;
}

/** A memory session's font and tools, as a test builds them. */
export interface MemorySessionSetup {
  /** The intents that build the font from a new one, applied in one edit before the session opens. */
  readonly build?: (defaults: NewFontDefaults) => readonly FontIntent[];
  /** Tools to register, the first active; Select then Hand by default. */
  // oxlint-disable-next-line shift/no-optional-collection-field -- absent means Select then Hand, as for the session
  readonly tools?: readonly MemoryToolName[];
}

/**
 * Starts a workspace-free editor over a new font with one source and no
 * glyphs, for subject tests of editor parts that need an `Editor` but no
 * font data.
 *
 * @param tools - Tools to register, the first active; Select then Hand by default.
 */
export async function startEmptyMemorySession(
  tools?: readonly MemoryToolName[],
): Promise<MemoryFontSession> {
  return createMemoryFontSession({
    clipboard: new MemoryClipboard(),
    tools,
    source: await newMemoryFontSource({ familyName: "Empty", unitsPerEm: 1000 }),
  });
}

/**
 * Starts a workspace-free editor over a new font that `build`'s intents
 * shape first, through the session's own engine, as the font a consumer
 * hands a memory session would already be.
 */
export async function startMemorySession({
  build,
  tools,
}: MemorySessionSetup = {}): Promise<MemoryFontSession> {
  const { font } = await newMemoryFontSource({ familyName: "Memory Test", unitsPerEm: 1000 });
  const engine = await SessionEngine.open({ kind: "resident", font });
  try {
    const [source] = engine.fontRecords().sources;
    if (!source) throw new Error("a new font starts with one source");
    const intents = build?.({ sourceId: source.id }) ?? [];
    if (intents.length > 0) {
      engine.beginEdit(null);
      engine.apply(intents);
      engine.endEdit();
    }
    return memoryFontSession(engine, { clipboard: new MemoryClipboard(), tools });
  } catch (error) {
    engine.dispose();
    throw error;
  }
}
