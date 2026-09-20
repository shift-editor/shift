import type { Editor } from "@shift/editor";
import type { Font } from "@shift/editor/model";
import type { GlyphCatalog } from "@/lib/catalog/GlyphCatalog";
import type { Workspace } from "@/workspace/Workspace";

interface FontSessionBase {
  readonly catalog: GlyphCatalog;
  readonly font: Font;
  readonly editor: Editor;
  dispose(): void;
}

export interface WorkspaceFontSession extends FontSessionBase {
  readonly mode: "workspace";
  readonly workspace: Workspace;
}

export interface MemoryFontSession extends FontSessionBase {
  readonly mode: "memory";
  readonly workspace: null;
}

export interface PreviewFontSession extends FontSessionBase {
  readonly mode: "preview";
  readonly canConvert: boolean;
  readonly workspace: null;
}

export type FontSession = PreviewFontSession | MemoryFontSession | WorkspaceFontSession;
