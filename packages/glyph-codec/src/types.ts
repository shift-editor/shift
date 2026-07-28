export type OutlineCommand =
  | { readonly kind: "move"; readonly x: number; readonly y: number }
  | { readonly kind: "line"; readonly x: number; readonly y: number }
  | {
      readonly kind: "quad";
      readonly cx: number;
      readonly cy: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "cubic";
      readonly c1x: number;
      readonly c1y: number;
      readonly c2x: number;
      readonly c2y: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: "close" };

export type LayerPointType = "on-curve" | "off-curve" | "qcurve";

export type LayerPoint = {
  readonly id: string;
  readonly type: LayerPointType;
  readonly smooth: boolean;
  readonly x: number;
  readonly y: number;
};

export type LayerContour = {
  readonly id: string;
  readonly closed: boolean;
  readonly points: readonly LayerPoint[];
};

export type LayerTransform = {
  readonly translateX: number;
  readonly translateY: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly skewX: number;
  readonly skewY: number;
  readonly centerX: number;
  readonly centerY: number;
};

export type LayerComponent = {
  readonly id: string;
  readonly baseGlyphId: string;
  readonly baseGlyphName: string;
  readonly transform: LayerTransform;
};

export type LayerAnchor = {
  readonly id: string;
  readonly name: string | null;
  readonly x: number;
  readonly y: number;
};

export type LayerGuideline = {
  readonly id: string;
  readonly x: number | null;
  readonly y: number | null;
  readonly angle: number | null;
  readonly name: string | null;
  readonly color: string | null;
};

export type LayerLibValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "integer"; readonly value: bigint }
  | { readonly kind: "unsigned-integer"; readonly value: bigint }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "array"; readonly value: readonly LayerLibValue[] }
  | { readonly kind: "dict"; readonly value: ReadonlyMap<string, LayerLibValue> }
  | { readonly kind: "data"; readonly value: Uint8Array }
  | { readonly kind: "date"; readonly value: string }
  | { readonly kind: "uid"; readonly value: bigint };

export type GlyphLayer = {
  readonly id: string;
  readonly sourceId: string;
  readonly width: number;
  readonly height: number | null;
  readonly contours: readonly LayerContour[];
  readonly components: readonly LayerComponent[];
  readonly anchors: readonly LayerAnchor[];
  readonly guidelines: readonly LayerGuideline[];
  readonly lib: ReadonlyMap<string, LayerLibValue>;
};

export type GlyphCodecErrorCode =
  | "header-truncated"
  | "wrong-magic"
  | "unsupported-kind"
  | "unsupported-version"
  | "unknown-flags"
  | "unknown-layer-flags"
  | "unknown-record-flags"
  | "non-zero-reserved"
  | "unknown-command"
  | "unknown-point-type"
  | "unknown-lib-tag"
  | "invalid-boolean"
  | "invalid-utf8"
  | "invalid-string-offsets"
  | "duplicate-string"
  | "string-reference-out-of-range"
  | "non-canonical-string-reference"
  | "unreferenced-strings"
  | "duplicate-identity"
  | "non-canonical-map-order"
  | "invalid-command-order"
  | "coordinate-count-mismatch"
  | "point-count-mismatch"
  | "lib-length-mismatch"
  | "non-zero-padding"
  | "non-finite-coordinate"
  | "non-finite-input-coordinate"
  | "coordinate-out-of-f32-range"
  | "non-finite-number"
  | "non-canonical-absent-number"
  | "integer-out-of-range"
  | "nesting-limit-exceeded"
  | "truncated"
  | "length-overflow"
  | "length-mismatch"
  | "limit-exceeded";
