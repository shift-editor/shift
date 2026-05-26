import { Bridge, ShiftSourceDocument } from "shift-bridge";
import type { BridgeApi } from "@shift/types";

export type * from "@shift/types";

export type ShiftBridge = BridgeApi;
export type ShiftSourceBridge = ShiftSourceDocument;

export function createBridge(): ShiftBridge {
  return new Bridge() as ShiftBridge;
}

export function createShiftSourceBridge(): ShiftSourceBridge {
  return new ShiftSourceDocument();
}
