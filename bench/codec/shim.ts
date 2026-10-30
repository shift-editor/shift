// Stands in for "@shift/wasm" and "@shift/wasm/engine" under the bench bundle,
// so the real generated files (imported unchanged) and the prototype call the
// same swappable bindings: the real module (full call) or a canned reply
// (codec only: encode the request, decode the reply the real module returned).
import * as real from "../../packages/wasm/src/index";

export type Binding = (input: Float64Array) => Float64Array;

const names = [
  "contourGeometry",
  "composeTransform",
  "decomposeMatrix",
  "dragMoves",
  "prepareDrag",
  "followAnchors",
  "propagateAnchors",
  "blendDecomposedGlyph",
  "svgPathContours",
  "engineKerningRun",
  "engineKerningPairs",
  "engineSourceMetricsAt",
] as const;
export type BindingName = (typeof names)[number];

export const bindings = {} as Record<BindingName, Binding>;
const missing: Binding = () => {
  throw new Error("binding not set");
};
for (const name of names) bindings[name] = missing;

export const realBinding = (name: BindingName): Binding => (real as unknown as Record<string, Binding>)[name]!;

export function useReal(name: BindingName): void {
  bindings[name] = realBinding(name);
}

export const contourGeometry: Binding = (i) => bindings.contourGeometry(i);
export const composeTransform: Binding = (i) => bindings.composeTransform(i);
export const decomposeMatrix: Binding = (i) => bindings.decomposeMatrix(i);
export const dragMoves: Binding = (i) => bindings.dragMoves(i);
export const prepareDrag: Binding = (i) => bindings.prepareDrag(i);
export const followAnchors: Binding = (i) => bindings.followAnchors(i);
export const propagateAnchors: Binding = (i) => bindings.propagateAnchors(i);
export const blendDecomposedGlyph: Binding = (i) => bindings.blendDecomposedGlyph(i);
export const svgPathContours: Binding = (i) => bindings.svgPathContours(i);
export const engineKerningRun: Binding = (i) => bindings.engineKerningRun(i);
export const engineKerningPairs: Binding = (i) => bindings.engineKerningPairs(i);
export const engineSourceMetricsAt: Binding = (i) => bindings.engineSourceMetricsAt(i);
export const internName = real.internName;
export const nameOf = real.nameOf;
export const releaseDrag = real.releaseDrag;
export const realPrepareDrag = real.prepareDrag;
