/**
 * Drawing & interaction benchmarks — pen tool placement and hover hit-testing.
 *
 * Key scenarios:
 * - Pen tool rapid point placement (high-frequency pointer events)
 * - Continuous hover on a complex glyph (mousemove -> hit-test -> hover resolve)
 */

import { bench, describe } from "vitest";
import { createPointMark } from "@/testing/pointMark";
import { TestEditor } from "@/testing/TestEditor";

const pm1k = createPointMark(1_000);
pm1k.editor.selectTool("select");

const pm10k = createPointMark(10_000);
pm10k.editor.selectTool("select");

const pm50k = createPointMark(50_000);
pm50k.editor.selectTool("select");

describe("pen tool — rapid point placement", () => {
  bench("place 100 points sequentially", () => {
    const editor = new TestEditor();
    editor.startSession("pen-bench");
    editor.selectTool("pen");
    for (let i = 0; i < 100; i++) {
      editor.click(i * 10, i * 5);
    }
  });
});

const marks = [
  { label: "1K", pm: pm1k },
  { label: "10K", pm: pm10k },
  { label: "50K", pm: pm50k },
] as const;

for (const { label, pm } of marks) {
  describe(`hover hit-testing — ${label} points`, () => {
    bench("pointerMove — 10 frames across glyph", () => {
      for (let i = 0; i < 10; i++) {
        pm.editor.pointerMove(i * 50, i * 30);
      }
    });

    bench("pointerMove — single frame near points", () => {
      pm.editor.pointerMove(100, 200);
    });
  });
}
