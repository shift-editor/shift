import { createMockToolContext, type MockToolContext } from "./services";

export type TestEditor = MockToolContext;

export function createTestEditor(): TestEditor {
  return createMockToolContext();
}
