import type { BridgeApi } from "@shift/bridge";

export type { BridgeApi, GlyphHandle } from "@shift/bridge";

declare global {
  interface Window {
    shiftBridge?: BridgeApi;
  }
}
