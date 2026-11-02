import type { Axis, AxisMapping, FontIntent, Source } from "@shift/types";
import { newMemoryFontSource } from "@shift/editor";
import { SessionEngine } from "@shift/editor/model";
import { computed, signal } from "@shift/editor/signals";
import { Designspace, FontVariation } from "@shift/editor/variation";

/** The axes, mappings and sources of a font a test builds a designspace over. */
export interface DesignspaceFont {
  readonly axes: readonly Axis[];
  readonly sources: readonly Source[];
  // oxlint-disable-next-line shift/no-optional-collection-field -- absent means an unmapped font
  readonly mappings?: readonly AxisMapping[];
}

/** A designspace, and the engine that evaluates its variation; dispose it after the test. */
export interface OpenDesignspace {
  readonly designspace: Designspace;
  dispose(): void;
}

/**
 * A designspace over `font`, its mapping evaluated by an engine whose font
 * has `font`'s axes and mappings, built through the engine's own intents, as
 * a font's designspace is.
 */
export async function openDesignspace({
  axes,
  sources,
  mappings = [],
}: DesignspaceFont): Promise<OpenDesignspace> {
  const { font } = await newMemoryFontSource({ familyName: "Designspace", unitsPerEm: 1000 });
  const engine = await SessionEngine.open({ kind: "resident", font });
  const intents: FontIntent[] = [
    ...axes.map((axis): FontIntent => ({ kind: "createAxis", createAxis: { axis } })),
    { kind: "setAxisMappings", setAxisMappings: { mappings } },
  ];
  engine.beginEdit(null);
  engine.apply(intents);
  engine.endEdit();

  const cells = {
    axesCell: signal(axes),
    mappingBasesCell: signal(engine.fontHeader().axisMappingBases),
    sourcesCell: signal(sources),
  };
  const variationCell = computed(() => {
    const variation = engine.variationCell.value;
    return variation && new FontVariation(variation, cells);
  });
  return {
    designspace: new Designspace({ ...cells, variationCell }),
    dispose() {
      variationCell.dispose();
      engine.dispose();
    },
  };
}
