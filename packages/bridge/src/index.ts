import { Bridge } from "shift-bridge";
import type { BridgeApi } from "@shift/types";

export type * from "@shift/types";

export type ShiftBridge = BridgeApi;

export function createBridge(): ShiftBridge {
  return new Bridge() as ShiftBridge;
}
