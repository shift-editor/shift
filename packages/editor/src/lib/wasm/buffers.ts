import { inputBuffer, nameOf, internName, outputBuffer, outputLength, wasm } from "@shift/wasm";

/**
 * Returns a view on the module's input buffer, sized and zeroed, to write a call's input into.
 *
 * @remarks
 * Views on module memory go stale when it grows, which any call can cause,
 * so take a fresh view for each call and don't keep it.
 */
export function inputView(length: number): Float64Array {
  return new Float64Array(wasm.memory.buffer, inputBuffer(length), length);
}

/** Returns a view on what the last call wrote; read it before the next call. */
export function outputView(): Float64Array {
  return new Float64Array(wasm.memory.buffer, outputBuffer(), outputLength());
}

// non-reactive: a string table mirrored from the module's, which only ever grows
const ids = new Map<string, number>();
const names: string[] = [];

/** Returns the module's id for a name, interning it once. */
export function nameId(name: string): number {
  let id = ids.get(name);
  if (id === undefined) {
    id = internName(name);
    ids.set(name, id);
    names[id] = name;
  }
  return id;
}

/** Returns the name the module's id stands for. */
export function nameFor(id: number): string {
  let name = names[id];
  if (name === undefined) {
    name = nameOf(id);
    names[id] = name;
    ids.set(name, id);
  }
  return name;
}
