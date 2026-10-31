import type { Names } from "@shift/pack";

/**
 * A module's name table, mirrored on this side so each name crosses as text
 * once: every module (`@shift/wasm` and its engine build) interns
 * its own names.
 */
export function moduleNames(
  internName: (name: string) => number,
  nameOf: (id: number) => string,
): Names {
  // non-reactive: a string table mirrored from the module's, which only ever grows
  const ids = new Map<string, number>();
  const names: string[] = [];
  return {
    id(name) {
      let id = ids.get(name);
      if (id === undefined) {
        id = internName(name);
        ids.set(name, id);
        names[id] = name;
      }
      return id;
    },
    name(id) {
      let name = names[id];
      if (name === undefined) {
        name = nameOf(id);
        names[id] = name;
        ids.set(name, id);
      }
      return name;
    },
  };
}
