import { createBridge } from "@shift/bridge";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Reads glyph names from a saved `.shift` document through the native engine.
 *
 * @param documentPath - canonical document written by the application under test.
 * @param testRoot - scratch directory for the validation recovery store.
 * @returns every persisted glyph name in document order.
 */
export function savedGlyphNames(documentPath: string, testRoot: string): string[] {
  const bridge = createBridge();
  const recoveryPath = path.join(testRoot, `${crypto.randomUUID()}.recovery.sqlite`);
  bridge.openDocument(documentPath, recoveryPath);

  try {
    return bridge.getGlyphs().map((glyph) => glyph.name);
  } finally {
    bridge.closeWorkspace();
    fs.rmSync(recoveryPath, { force: true });
  }
}

/**
 * Reads glyph names from an exported binary font through the native font reader.
 *
 * @param fontPath - TrueType or OpenType file written by Export.
 * @returns every glyph name the exported font declares.
 */
export function exportedGlyphNames(fontPath: string): string[] {
  const bridge = createBridge();
  try {
    return bridge.openFontSource(fontPath).glyphs.map((glyph) => glyph.name);
  } finally {
    bridge.closeFontSource();
  }
}
