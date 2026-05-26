import { ShiftSourceDocument } from "shift-bridge";
import type { GlyphEntry } from "shift-bridge";
import { asGlyphId, type GlyphId } from "@shift/types";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class PackageFixture {
  readonly dir: string;
  readonly path: string;
  readonly document: ShiftSourceDocument;

  constructor(prefix = "shift-package-") {
    this.dir = mkdtempSync(join(tmpdir(), prefix));
    this.path = join(this.dir, "TestSans.shift");
    this.document = new ShiftSourceDocument();
    this.document.initializeSaved(this.path);
  }

  reopen(): ShiftSourceDocument {
    const document = new ShiftSourceDocument();
    document.open(this.path);
    return document;
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
  glyph(glyphId: string): GlyphEntry | undefined {
    return this.document.glyphs().find((glyph) => glyph.id === glyphId);
  }

  glyphId(glyphId: string): GlyphId {
    return asGlyphId(glyphId);
  }
}

export function createPackageFixture(): PackageFixture {
  return new PackageFixture();
}
