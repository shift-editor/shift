/**
 * Playwright's `expect` with the shared test matchers registered, so a spec
 * asserts as a behaviour test does.
 *
 * @example
 * await expect.poll(() => editor.pointPosition(handle)).toBeNear({ x: 186.6, y: 150 });
 */
import { expect as playwrightExpect } from "@playwright/test";
import { toBeNear } from "../../src/renderer/src/testing/toBeNear";

export const expect = playwrightExpect.extend({ toBeNear });
