/**
 * Playwright's `expect` with the shared test matchers registered, so a spec
 * asserts as a behaviour test does.
 *
 * @example
 * await expect.poll(() => editor.point(handle)).toBeNear({ x: 186.6, y: 150 });
 * expect(await editor.outline()).toDrawLike(fitted);
 */
import { expect as playwrightExpect } from "@playwright/test";
import { toBeNear } from "../../src/renderer/src/testing/toBeNear";
import { toDrawLike } from "../../src/renderer/src/testing/toDrawLike";

export const expect = playwrightExpect.extend({ toBeNear, toDrawLike });
