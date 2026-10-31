// The addon as the utility process calls it: each area through the client
// pack generates from its Rust trait, and what stays a napi method on `napi`.
// @shift/bridge builds the same object; this package cannot depend on it,
// since it depends on this one.
import { createRequire } from "module";
import { carryingNames } from "@shift/pack";
import { NativeAtlas, NativeSource, NativeWorkspace } from "@shift/types/native-protocol";

const require = createRequire(import.meta.url);
const { Bridge } = require("../index.js");

/** A native workspace with nothing open. */
export function nativeBridge() {
  const addon = new Bridge();
  const transport = (request) =>
    carryingNames((method, numbers, blobs) => request.call(addon, method, numbers, blobs));
  return {
    workspace: new NativeWorkspace(transport(addon.workspaceRequest)),
    atlas: new NativeAtlas(transport(addon.atlasRequest)),
    source: new NativeSource(transport(addon.sourceRequest)),
    napi: addon,
  };
}
