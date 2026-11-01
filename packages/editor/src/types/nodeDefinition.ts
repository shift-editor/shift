import type { GlyphNodeDefinition } from "../lib/nodes/GlyphNodeDefinition";
import type { NodeDefinitionConstructor } from "../lib/nodes/NodeDefinition";
import type { PageNodeDefinition } from "../lib/nodes/PageNodeDefinition";
import type { TextRunNodeDefinition } from "../lib/nodes/TextRunNodeDefinition";

/** Built-in node behavior registered for each scene-node kind. */
export interface NodeDefinitionByKind {
  readonly glyph: GlyphNodeDefinition;
  readonly textRun: TextRunNodeDefinition;
  readonly page: PageNodeDefinition;
}

/** Optional built-in definition replacements that preserve each kind's public contract. */
export type NodeDefinitionConstructors = {
  readonly [Kind in keyof NodeDefinitionByKind]: NodeDefinitionConstructor<
    NodeDefinitionByKind[Kind]
  >;
};
