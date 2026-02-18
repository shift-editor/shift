import type { GlyphRef } from "@/lib/tools/text/layout";
import { glyphRefFromUnicode, type GlyphNameResolverDeps } from "@/lib/utils/unicode";

export class GlyphNamingService {
  #deps: GlyphNameResolverDeps;

  constructor(deps: GlyphNameResolverDeps) {
    this.#deps = deps;
  }

  glyphRefFromUnicode(unicode: number): GlyphRef {
    return glyphRefFromUnicode(unicode, this.#deps);
  }
}
