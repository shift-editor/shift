import type {
  AppliedChange,
  FontIntent,
  FontSnapshot,
  GlyphId,
  GlyphPreview,
  GlyphSnapshot,
  GlyphSnapshotRequest,
  LayerId,
  LayerMatch,
  Location,
  WorkspaceDocumentState,
  WorkspaceSnapshot,
} from "@shift/types";
import type { FontStore } from "../lib/model/FontStore";
import type { PendingEditId } from "./editing";
import type { GlyphReader } from "./glyph";

export interface FontStoreOptions {
  readonly font?: FontSnapshot | null;
  readonly workspace?: WorkspaceSnapshot | null;
}

export interface WorkspaceEditCoordinator {
  push(intent: FontIntent): PendingEditId;
  transaction<TResult>(label: string, body: () => TResult): TResult;
  apply(intents: FontIntent[], label?: string): Promise<AppliedChange>;
  readGlyphSnapshots(requests: readonly GlyphSnapshotRequest[]): Promise<GlyphSnapshot[]>;
  readGlyphPreviews(glyphIds: readonly GlyphId[], location: Location): Promise<GlyphPreview[]>;
  matchLayers(referenceLayerId: LayerId, targetLayerId: LayerId): Promise<LayerMatch>;
  mapLocation(location: Location): Promise<Location>;
  settled(): Promise<void>;
  undo(): Promise<AppliedChange | null>;
  redo(): Promise<AppliedChange | null>;
  state(): Promise<WorkspaceDocumentState | null>;
  readonly settledCell: { readonly value: boolean };
}

export interface FontOptions {
  readonly store: FontStore;
  readonly glyphInfo?: {
    getGlyphName(codepoint: number): string | null;
    getGlyphByName(name: string): { readonly codepoint: number } | null;
  };
  readonly editCoordinator?: WorkspaceEditCoordinator;
  readonly reader?: GlyphReader;
}
