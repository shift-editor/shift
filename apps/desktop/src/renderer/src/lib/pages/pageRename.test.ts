import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asNodeId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import { pageRenameRequests, renameOnDoubleClick, type ClickTarget } from "./pageRename";

const pageId = asNodeId("page-1");

// The tests run without a DOM: a plain event target stands in for the window.
// Its timers are looked up per call, so they are the fake ones each test installs.
const target = Object.assign(new EventTarget(), {
  setTimeout: (handler: () => void, delay: number) => globalThis.setTimeout(handler, delay),
  clearTimeout: (id: number) => globalThis.clearTimeout(id),
}) as unknown as ClickTarget & EventTarget;

function press(x: number, y: number): Event {
  const event = Object.assign(new Event("pointerdown", { cancelable: true }), {
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
  return event;
}

describe("renaming a page opened by a double-click", () => {
  const editor = useTestEditor();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it("asks for the rename when the second press lands by the first, and swallows it", () => {
    renameOnDoubleClick(editor.asEditor(), pageId, { x: 100, y: 40 }, target);

    const second = press(102, 41);

    expect(pageRenameRequests(editor.asEditor()).peek()).toBe(pageId);
    expect(second.defaultPrevented).toBe(true);
  });

  it("leaves a press elsewhere or after the double-click time alone", () => {
    renameOnDoubleClick(editor.asEditor(), pageId, { x: 100, y: 40 }, target);
    const far = press(200, 40);
    renameOnDoubleClick(editor.asEditor(), pageId, { x: 100, y: 40 }, target);
    vi.advanceTimersByTime(600);
    const late = press(100, 40);

    expect(pageRenameRequests(editor.asEditor()).peek()).toBeNull();
    expect([far.defaultPrevented, late.defaultPrevented]).toEqual([false, false]);
  });
});
