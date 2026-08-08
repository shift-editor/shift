import type { FontSnapshot } from "@shift/types";
import type { WorkspaceSnapshot } from "@shared/workspace/protocol";
import type { FontStore } from "@/lib/model/FontStore";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import type { GlyphReader } from "./glyph";

export interface FontStoreOptions {
  readonly font?: FontSnapshot | null;
  readonly workspace?: WorkspaceSnapshot | null;
}

export interface FontOptions {
  readonly store: FontStore;
  readonly editCoordinator?: WorkspaceEditCoordinator;
  readonly reader?: GlyphReader;
}
