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

export type GlyphCodecErrorCode =
  | "header-truncated"
  | "wrong-magic"
  | "unsupported-kind"
  | "unsupported-version"
  | "unknown-flags"
  | "unknown-command"
  | "invalid-command-order"
  | "coordinate-count-mismatch"
  | "non-zero-padding"
  | "non-finite-coordinate"
  | "non-finite-input-coordinate"
  | "coordinate-out-of-f32-range"
  | "length-overflow"
  | "length-mismatch"
  | "limit-exceeded";
