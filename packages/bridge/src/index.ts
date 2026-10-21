import { Bridge } from "shift-bridge";
import type { BridgeApi } from "@shift/types";

// oxlint-disable-next-line eslint-js/no-restricted-syntax -- the bridge package re-exports every bridge type
export type * from "@shift/types";

export type ShiftBridge = BridgeApi;

export function createBridge(): ShiftBridge {
  return new Bridge() as ShiftBridge;
}
