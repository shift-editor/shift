import type { Editor } from "@/lib/editor/Editor";
import type { Font } from "@/lib/model/Font";
import type { GlyphCatalog } from "@/lib/catalog/GlyphCatalog";
import type { Workspace } from "@/workspace/Workspace";

interface FontSessionBase {
  readonly catalog: GlyphCatalog;
  readonly font: Font;
  readonly editor: Editor;
  dispose(): void;
}

export interface AuthoredFontSession extends FontSessionBase {
  readonly mode: "authored";
  readonly workspace: Workspace;
}

export interface PreviewFontSession extends FontSessionBase {
  readonly mode: "preview";
  readonly workspace: null;
}

export type FontSession = AuthoredFontSession | PreviewFontSession;
