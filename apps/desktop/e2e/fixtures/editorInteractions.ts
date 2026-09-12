import type { Page } from "@playwright/test";

export async function addSquare(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const editor = window.shift?.editor;
    if (!editor) throw new Error("Expected editor");

    const inserted = editor.insertContent({
      contours: [
        {
          closed: true,
          points: [
            { x: 0, y: 0, pointType: "onCurve", smooth: false },
            { x: 100, y: 0, pointType: "onCurve", smooth: false },
            { x: 100, y: 100, pointType: "onCurve", smooth: false },
            { x: 0, y: 100, pointType: "onCurve", smooth: false },
          ],
        },
      ],
    });
    if (!inserted) throw new Error("Expected inserted contour");

    await editor.font.editCoordinator.settled();
    return inserted.length;
  });
}
