import { Mat } from "@shift/geo";
import { NodeDefinition } from "./NodeDefinition";
import type { LocalBounds } from "../../types/coordinates";
import type { PageNode } from "../../types/node";
import type { PointerTarget } from "../../types/target";

/**
 * Behavior of a page, the root every other node sits on.
 *
 * @remarks
 * The canvas is the page, so a page has no bounds, is never hit, and draws
 * nothing. Its children keep their own positions; a page sits at the scene
 * origin in Y-down scene units.
 */
export class PageNodeDefinition extends NodeDefinition<PageNode> {
  readonly kind: PageNode["kind"] = "page";

  unitsTransform(_node: PageNode): Mat {
    return Mat.Identity();
  }

  bounds(_node: PageNode): LocalBounds | null {
    return null;
  }

  hit(_node: PageNode): PointerTarget | null {
    return null;
  }
}
