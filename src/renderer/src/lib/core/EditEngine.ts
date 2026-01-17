import type { GlyphSnapshot, MatchedRule } from "@/types/generated";
import type { PointId } from "@/types/ids";
import { asPointId } from "@/types/ids";
import type { NativeFontEngine } from "@/engine/native";

export interface EditEngineContext {
  native: NativeFontEngine;
  hasSession: () => boolean;
  emitSnapshot: (snapshot: GlyphSnapshot | null) => void;
}

interface EditResultJson {
  success: boolean;
  snapshot: GlyphSnapshot | null;
  affectedPointIds: string[];
  matchedRules: MatchedRule[];
  error: string | null;
}

export class EditEngine {
  #ctx: EditEngineContext;

  constructor(ctx: EditEngineContext) {
    this.#ctx = ctx;
  }

  applyEdits(selectedPoints: ReadonlySet<PointId>, dx: number, dy: number): PointId[] {
    if (!this.#ctx.hasSession()) {
      return [];
    }

    const pointIds = [...selectedPoints];
    const resultJson = this.#ctx.native.applyEditsUnified(pointIds, dx, dy);
    const result: EditResultJson = JSON.parse(resultJson);

    if (result.success && result.snapshot) {
      this.#ctx.emitSnapshot(result.snapshot);
    }

    return result.affectedPointIds?.map(asPointId) ?? [];
  }
}
