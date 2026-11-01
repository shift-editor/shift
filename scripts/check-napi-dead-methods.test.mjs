import assert from "node:assert/strict";
import test from "node:test";

import { camelCase, deadMethods, rustMethodNames } from "./check-napi-dead-methods.mjs";

const BRIDGE = `
#[napi]
impl Bridge {
  #[napi(constructor)]
  pub fn new() -> Self { todo!() }

  #[napi]
  pub fn workspace_request<'env>(&mut self, env: &'env Env) -> u32 { 0 }

  #[napi]
  pub fn read_pair<'a, T: Into<u32>>(&self, value: T) -> u32 { 0 }

  #[napi]
  pub fn load_all<T>(&self, value: T) -> u32
  where
    T: Clone,
  { 0 }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 { 0 }
}
`;

test("reads method names past lifetimes, bounds and where clauses", () => {
  assert.deepEqual(rustMethodNames(BRIDGE), [
    "workspace_request",
    "read_pair",
    "load_all",
    "get_glyph_count",
  ]);
});

test("converts snake_case to the exported camelCase name", () => {
  assert.equal(camelCase("workspace_request"), "workspaceRequest");
  assert.equal(camelCase("get_glyph_count"), "getGlyphCount");
});

test("reports only methods without a caller", () => {
  const callers = "bridge.workspaceRequest(env, 1);\nbridge.readPair(2);\nbridge.loadAllThings();";
  assert.deepEqual(deadMethods(BRIDGE, callers), ["load_all", "get_glyph_count"]);
});
