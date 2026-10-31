import type { Canvas } from "../../editor/rendering/Canvas";
import type { Editor } from "../../editor/Editor";

/**
 * Marks every glyph's advance on its baseline in the editor's text runs, for
 * the Spacing and Kerning tools: a
 * small tee at the advance's start and end, each arm pointing into its glyph.
 *
 * @remarks
 * Shows the line's rhythm of advances without lines through the glyphs. Two
 * unkerned neighbours' tees meet back to back; a kern pulls them apart or
 * crosses them, unless it is too small to see at this zoom, when they draw as
 * one. They fade out when zoomed far enough out that they would be as big
 * as the letters.
 */
/** The em size, in screen pixels, at and above which the tees show fully, and below which they fade out to none at {@link HIDDEN_EM_PX}. */
const SHOWN_EM_PX = 120;
const HIDDEN_EM_PX = 80;

/** How close, in screen pixels, one glyph's advance end and the next's start draw as one tick. */
const MERGE_PX = 2;

export function drawAdvanceTees(canvas: Canvas, editor: Editor): void {
  const { color, widthPx, tickPx, armPx } = canvas.theme.advanceTee;
  for (const node of editor.scene.nodesOfKind("textRun")) {
    const layout = editor.text.layout(node.runId);
    if (!layout || layout.placedGlyphs.length === 0) continue;
    canvas.withTransform(editor.sceneTransform(node), (local) => {
      local.withScreenSpace((screen, project) => {
        // Fade out as glyphs shrink, until the tees would be as big as the letters.
        const unitsPerEm = editor.font.metrics.unitsPerEm;
        const emPx = Math.abs(
          project.point({ x: unitsPerEm, y: 0 }).x - project.point({ x: 0, y: 0 }).x,
        );
        const opacity = Math.min(
          Math.max((emPx - HIDDEN_EM_PX) / (SHOWN_EM_PX - HIDDEN_EM_PX), 0),
          1,
        );
        if (opacity === 0) return;

        const ctx = screen.ctx;
        ctx.beginPath();
        const tick = (x: number, y: number) => {
          ctx.moveTo(x, y - tickPx / 2);
          ctx.lineTo(x, y + tickPx / 2);
        };
        const arm = (x: number, y: number, length: number) => {
          ctx.moveTo(x, y);
          ctx.lineTo(x + length, y);
        };

        const glyphs = layout.placedGlyphs;
        // The end of the glyph before on the same line, drawn when it meets this start.
        let pending: { x: number; y: number; line: number; inward: number } | null = null;
        for (const placed of glyphs) {
          const start = project.point({ x: placed.left, y: placed.baseline });
          const end = project.point({ x: placed.left + placed.glyph.xAdvance, y: placed.baseline });
          const inward = Math.sign(end.x - start.x) || 1;

          if (
            pending &&
            pending.line === placed.lineIndex &&
            Math.abs(pending.x - start.x) < MERGE_PX
          ) {
            // A kern too small to see at this zoom: one tick, an arm into each glyph.
            const x = (pending.x + start.x) / 2;
            tick(x, start.y);
            arm(x, start.y, -pending.inward * armPx);
            arm(x, start.y, inward * armPx);
          } else {
            if (pending) {
              tick(pending.x, pending.y);
              arm(pending.x, pending.y, -pending.inward * armPx);
            }
            tick(start.x, start.y);
            arm(start.x, start.y, inward * armPx);
          }
          pending = { x: end.x, y: end.y, line: placed.lineIndex, inward };
        }
        if (pending) {
          tick(pending.x, pending.y);
          arm(pending.x, pending.y, -pending.inward * armPx);
        }
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.lineWidth = widthPx;
        ctx.stroke();
        ctx.restore();
      });
    });
  }
}
