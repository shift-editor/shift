import type { MemoryFontSource } from "@shift-editor/sdk";
import fixture from "./inter-a.json";

/**
 * Inter's lowercase `a` with every master, packed by `shift-cli font pack`
 * (`generate-inter-a-fixture.mjs`) and served from memory.
 */
export function interASource(): MemoryFontSource {
  return { font: Uint8Array.from(atob(fixture.font), (character) => character.charCodeAt(0)) };
}
