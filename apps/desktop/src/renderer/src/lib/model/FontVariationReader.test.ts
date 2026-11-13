import { describe, expect, it } from "vitest";
import { computed, signal } from "@shift/editor/signals";
import { axisValue, externalAxisLocationFromRecord } from "@shift/editor/variation";
import { FONTS } from "@/testing/fontFixture";
import { createWorkspaceStack } from "@/testing/workspaceStack";

describe("the font's variation reader follows the window's engine", () => {
  it("reads nothing while the engine is closed and maps through the new session after reopen", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(FONTS.mappedWeight);
    const engine = stack.editCoordinator.engine;
    const [weight] = stack.font.designspace.axes;
    if (!weight) throw new Error("Expected MappedWeight's weight axis");
    const userWeight = signal(100);
    const design = computed(() =>
      axisValue(
        stack.font.designspace.toDesign(
          externalAxisLocationFromRecord({ [weight.id]: userWeight.value }),
        ),
        weight,
      ),
    );

    try {
      expect(design.value).toBeCloseTo(30);

      engine.dispose();
      userWeight.set(400);
      expect(() => design.value).toThrow("the font's engine is not open");

      await engine.reopen();
      userWeight.set(800);
      expect(design.value).toBeCloseTo(160);
    } finally {
      design.dispose();
      stack.dispose();
    }
  });
});
