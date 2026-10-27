import { internName, nameOf } from "./index";

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
