import type { Glyph } from "@shift/types";
import {
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "../reactive/signal";
import { deriveGlyphSidebearings } from "./sidebearings";
import type { Bounds } from "@shift/geo";

export type SidebarGlyphInfo = {
  unicode: number;
  xAdvance: number;
  lsb: number | null;
  rsb: number | null;
};

export type SidebarSelectionBounds = Bounds | null;

type SidebarViewModelConfig = {
  glyph: Signal<Glyph | null>;
  getSelectionBounds: () => SidebarSelectionBounds;
};

export class SidebarViewModel {
  #glyph: Signal<Glyph | null>;
  #getSelectionBounds: () => SidebarSelectionBounds;
  #frozenGlyph: WritableSignal<Glyph | null>;
  #glyphInfoOverride: WritableSignal<SidebarGlyphInfo | null>;
  #selectionBoundsOverride: WritableSignal<SidebarSelectionBounds>;
  #$glyph: ComputedSignal<Glyph | null>;
  #$glyphInfo: ComputedSignal<SidebarGlyphInfo | null>;
  #$selectionBounds: ComputedSignal<SidebarSelectionBounds>;

  constructor(config: SidebarViewModelConfig) {
    this.#glyph = config.glyph;
    this.#getSelectionBounds = config.getSelectionBounds;
    this.#frozenGlyph = signal<Glyph | null>(null);
    this.#glyphInfoOverride = signal<SidebarGlyphInfo | null>(null);
    this.#selectionBoundsOverride = signal<SidebarSelectionBounds>(null);
    this.#$glyph = computed<Glyph | null>(() => {
      const frozenGlyph = this.#frozenGlyph.value;
      if (frozenGlyph) return frozenGlyph;
      return this.#glyph.value;
    });
    this.#$glyphInfo = computed<SidebarGlyphInfo | null>(() => {
      const override = this.#glyphInfoOverride.value;
      if (override) return override;

      const glyph = this.#glyph.value;
      if (!glyph) return null;

      const sidebearings = deriveGlyphSidebearings(glyph);
      return {
        unicode: glyph.unicode,
        xAdvance: glyph.xAdvance,
        lsb: sidebearings.lsb,
        rsb: sidebearings.rsb,
      };
    });
    this.#$selectionBounds = computed<SidebarSelectionBounds>(() => {
      const override = this.#selectionBoundsOverride.value;
      if (override) return override;
      return this.#getSelectionBounds();
    });
  }

  get glyph(): Signal<Glyph | null> {
    return this.#$glyph;
  }

  get glyphInfo(): Signal<SidebarGlyphInfo | null> {
    return this.#$glyphInfo;
  }

  get selectionBounds(): Signal<SidebarSelectionBounds> {
    return this.#$selectionBounds;
  }

  freezeGlyph(glyph: Glyph | null): void {
    this.#frozenGlyph.set(glyph);
  }

  overrideGlyphInfo(info: SidebarGlyphInfo | null): void {
    this.#glyphInfoOverride.set(info);
  }

  overrideSelectionBounds(bounds: SidebarSelectionBounds): void {
    this.#selectionBoundsOverride.set(bounds);
  }

  clearTransientState(): void {
    this.#frozenGlyph.set(null);
    this.#glyphInfoOverride.set(null);
    this.#selectionBoundsOverride.set(null);
  }

  clearSelectionBoundsOverride(): void {
    this.#selectionBoundsOverride.set(null);
  }
}
