import type { Axis, GlyphId, SlugAtlas, SlugGlyph, SourceId, SourceMetrics } from "@shift/types";
import type { RefObject } from "react";
import type { AxisLocation } from "./variation";

export interface SlugAtlasSections {
  readonly glyphs: Uint8Array<ArrayBuffer>;
  readonly componentGlyphs: Uint8Array<ArrayBuffer>;
}

export type SlugGlyphMap = ReadonlyMap<GlyphId, SlugGlyph>;

export interface SlugGlyphSelection {
  readonly glyphId: GlyphId;
  readonly sourceId: SourceId | null;
  readonly pixelRect: readonly [number, number, number, number];
}

export interface SlugScratch {
  readonly curveCount: number;
  readonly bandCount: number;
  readonly indexCount: number;
  readonly glyphCount: number;
  readonly componentTransformCount: number;
}

export interface SlugFrame {
  readonly instances: Uint8Array<ArrayBuffer>;
  readonly scratch: SlugScratch;
  readonly instanceCount: number;
}

export interface SlugDraw {
  readonly weights: Float32Array<ArrayBuffer>;
  readonly selections: readonly SlugGlyphSelection[];
  readonly preview: SlugPreviewStyle;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface SlugRendererOptions {
  readonly atlas: SlugAtlas;
  readonly atlasBuffer: GPUBuffer;
  readonly sections: SlugAtlasSections;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly onDeviceLost: (reason: string) => void;
}

export interface SlugPreviewStyle {
  readonly viewHeight: number;
  readonly fontTop: number;
  readonly previewHeight: number;
  readonly sideMargin: number;
  readonly color: readonly [number, number, number, number];
}

export interface SlugGlyphGridProps {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly glyphIds: readonly GlyphId[];
  readonly location: AxisLocation;
  readonly axes: readonly Axis[];
  readonly metrics: SourceMetrics;
  readonly sourceId: SourceId | null;
  readonly atlasRevision: unknown;
  readonly visible: boolean;
  readonly onFirstFrame: () => void;
  readonly onUnavailable: () => void;
}

export interface SlugDiagnostics {
  readonly atlasUploadBytes: number;
  readonly residentBufferBytes: number;
  readonly scratchBufferBytes: number;
  readonly allocatedBufferBytes: number;
  readonly geometryUploads: number;
  readonly geometryUploadBytes: number;
  readonly weightUploadBytes: number;
  readonly instanceUploadBytes: number;
  readonly frames: number;
  readonly deviceLosses: number;
}
