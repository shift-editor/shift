import type { GlyphCodecErrorCode } from "./types";

export class GlyphCodecError extends Error {
  readonly code: GlyphCodecErrorCode;

  constructor(code: GlyphCodecErrorCode, message: string) {
    super(message);
    this.name = "GlyphCodecError";
    this.code = code;
  }
}

export function fail(code: GlyphCodecErrorCode, message: string): never {
  throw new GlyphCodecError(code, message);
}
