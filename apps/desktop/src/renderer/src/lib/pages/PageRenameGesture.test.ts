import { describe, expect, it } from "vitest";
import { asNodeId } from "@shift/types";
import { PageRenameGesture } from "./PageRenameGesture";

const pageId = asNodeId("node_page1");
const click = (x: number, y: number, at: number, id = pageId) => ({ pageId: id, x, y, at });

describe("renaming a page with a double-click across the view swap", () => {
  it("takes a second click on the page's row, near the first and soon after, as the double-click", () => {
    const gesture = new PageRenameGesture();
    gesture.opened(click(100, 40, 1_000));

    expect(gesture.completes(click(102, 41, 1_200))).toBe(true);
  });

  it("leaves a click elsewhere, too late, or on another page as a click", () => {
    const gesture = new PageRenameGesture();
    const other = asNodeId("node_page2");

    gesture.opened(click(100, 40, 1_000));
    const far = gesture.completes(click(200, 40, 1_100));
    gesture.opened(click(100, 40, 2_000));
    const late = gesture.completes(click(100, 40, 2_600));
    gesture.opened(click(100, 40, 3_000));
    const elsewhere = gesture.completes(click(100, 40, 3_100, other));

    expect([far, late, elsewhere]).toEqual([false, false, false]);
  });

  it("forgets the first click once a click has been checked", () => {
    const gesture = new PageRenameGesture();
    gesture.opened(click(100, 40, 1_000));
    gesture.completes(click(300, 40, 1_100));

    expect(gesture.completes(click(100, 40, 1_200))).toBe(false);
  });
});
