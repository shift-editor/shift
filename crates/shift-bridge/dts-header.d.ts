import type {
  ContourId,
  PointId,
  AnchorId,
  AxisId,
  ComponentId,
  GlyphId,
  GuidelineId,
  GlyphName,
  LayerId,
  SourceId,
  Unicode,
} from "@shift/types";

export type SourceReadiness =
  | "singleSource"
  | "ready"
  | "missingSourceLayers"
  | "interpolationIncompatible"
  | "missingSourceLayersAndInterpolationIncompatible";

export type OpenPreviewStatus =
  | "ready"
  | "readyWithCleanup"
  | "recoveryRequired"
  | "blockedByRecovery";

export type OpenAction =
  | "load"
  | "cleanupThenLoad"
  | "recoverThenLoad"
  | "block";

export type SavePreviewStatus =
  | "unchanged"
  | "ready"
  | "blockedByExternalChanges"
  | "blockedByStagedCommit";

export type SaveAction =
  | "nothingToSave"
  | "save"
  | "resolveExternalChanges"
  | "resolveStagedCommit";

export type SaveStatus = "unchanged" | "saved";

export type GlyphRemovalStrategy =
  | "direct"
  | "removeComponentUses";

export type MasterLayerWorkStatus =
  | "ready"
  | "missingLayers"
  | "hasInterpolationMismatches"
  | "missingLayersAndInterpolationMismatches";
