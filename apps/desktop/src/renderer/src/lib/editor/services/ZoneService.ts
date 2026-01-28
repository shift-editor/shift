import type { FocusZone } from "@/types/focus";

export interface ZoneServiceDeps {
  getZone: () => FocusZone;
}

export class ZoneService {
  #deps: ZoneServiceDeps;

  constructor(deps: ZoneServiceDeps) {
    this.#deps = deps;
  }

  getZone(): FocusZone {
    return this.#deps.getZone();
  }
}
