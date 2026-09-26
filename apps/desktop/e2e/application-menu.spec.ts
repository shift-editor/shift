import fs from "node:fs";
import type { ElectronApplication, Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import {
  documentTest as launcherTest,
  documentWorkspaceTest as authoredTest,
  expect,
  FONT_PATH,
  UFO_FONT_PATH,
  waitForWorkspaceReady,
} from "./fixtures/electronApp";
import { applicationMenuItemEnabled, clickApplicationMenuItem } from "./fixtures/documentLifecycle";
import type { EditorDriver } from "./fixtures/EditorDriver";

const binaryPreviewTest = launcherTest.extend({
  openFontPath: FONT_PATH,
});
const convertiblePreviewTest = launcherTest.extend({
  openFontPath: UFO_FONT_PATH,
});

async function openSelectedPreview(page: Page, electronApp: ElectronApplication): Promise<Page> {
  const workspaceWindow = electronApp.waitForEvent("window");
  await page.getByRole("button", { name: /Load font/ }).click();

  const workspacePage = await workspaceWindow;
  await workspacePage.waitForURL(/#\/home$/);
  await expect(workspacePage.getByLabel("Glyph catalog", { exact: true })).toBeVisible();
  return workspacePage;
}

async function expectCloseOnlyWindowControls(page: Page): Promise<void> {
  const platform = await page.evaluate(() => window.shiftHost?.platform);
  const windowControls = page.getByRole("toolbar", { name: "Window controls" });

  if (platform !== "darwin") {
    await expect(windowControls).toHaveCount(0);
    return;
  }

  await expect(windowControls.getByRole("button", { name: "close" })).toBeVisible();
  await expect(windowControls.getByRole("button", { name: "minimize" })).toHaveCount(0);
  await expect(windowControls.getByRole("button", { name: "maximize" })).toHaveCount(0);
}

async function openFirstAuthoredGlyph(editor: EditorDriver): Promise<void> {
  const glyphId = await editor.page.evaluate(() => {
    const entry = window.shiftSession?.font.glyphEntries()[0];
    if (!entry) throw new Error("Expected authored glyph entry");
    return entry.id;
  });
  await editor.openGlyph(glyphId);
}

launcherTest("application menu exposes native shell actions", async ({ electronApp, page }) => {
  await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "window.close")).toBe(true);

  // Item identities, labels, and accelerators are unit-tested in menuItems.test.ts; this
  // test owns the platform-specific native roles and menu placement.
  const menu = await electronApp.evaluate(({ app, Menu }) => {
    const items = Menu.getApplicationMenu()?.items ?? [];
    const submenuIds = (label: string) =>
      items.find((item) => item.label === label)?.submenu?.items.map((item) => item.id) ?? [];

    return {
      packaged: app.isPackaged,
      platform: process.platform,
      topLevelLabels: items.map((item) => item.label),
      topLevelRoles: items.map((item) => item.role?.toLowerCase()),
      roles: items.flatMap(
        (item) =>
          item.submenu?.items.map((child) => child.role?.toLowerCase()).filter(Boolean) ?? [],
      ),
      viewLabels:
        items.find((item) => item.label === "View")?.submenu?.items.map((item) => item.label) ?? [],
      fileIds: submenuIds("File"),
      editIds: submenuIds("Edit"),
      glyphIds: submenuIds("Glyph"),
      settingsInstalled: Menu.getApplicationMenu()?.getMenuItemById("app.showSettings") !== null,
      addComponentAccelerator:
        Menu.getApplicationMenu()?.getMenuItemById("glyph.addComponent")?.accelerator,
    };
  });

  if (menu.platform === "darwin") {
    expect(menu.topLevelLabels).toContain("Window");
    expect(menu.topLevelRoles).toContain("windowmenu");
    expect(menu.roles).toEqual(
      expect.arrayContaining([
        "services",
        "hide",
        "hideothers",
        "unhide",
        "minimize",
        "zoom",
        "front",
      ]),
    );
  } else {
    expect(menu.roles).toContain("quit");
  }

  expect(menu.settingsInstalled).toBe(true);
  expect(menu.fileIds).not.toContain("app.showSettings");
  expect(menu.editIds.includes("app.showSettings")).toBe(menu.platform !== "darwin");
  expect(menu.glyphIds).toContain("glyph.addComponent");
  expect(menu.addComponentAccelerator).toBe("CmdOrCtrl+Shift+C");
  expect(menu.viewLabels.includes("Developer")).toBe(!menu.packaged && menu.platform === "darwin");
});

launcherTest("About uses platform-appropriate window controls", async ({ electronApp, page }) => {
  const aboutOpened = electronApp.waitForEvent("window");

  await clickApplicationMenuItem(page, electronApp, "app.showAbout");
  const aboutPage = await aboutOpened;
  await aboutPage.waitForURL(/#\/about\?/);

  await expectCloseOnlyWindowControls(aboutPage);

  const aboutWindow = await electronApp.browserWindow(aboutPage);
  expect(await aboutWindow.evaluate((window) => window.isModal())).toBe(false);
  await aboutWindow.dispose();
});

launcherTest("Update uses platform-appropriate window controls", async ({ page }) => {
  await page.evaluate(() => {
    window.location.hash = "/update?state=ready&version=1.2.3";
  });
  await page.waitForURL(/#\/update\?state=ready&version=1\.2\.3$/);

  await expectCloseOnlyWindowControls(page);
  await expect(page.getByRole("button", { name: "Restart and install" })).toBeVisible();
});

launcherTest("Feedback opens a modeless composer", async ({ electronApp, page }) => {
  const feedbackOpened = electronApp.waitForEvent("window");

  await clickApplicationMenuItem(page, electronApp, "help.emailFeedback");
  const feedbackPage = await feedbackOpened;
  await feedbackPage.waitForURL(/#\/feedback$/);

  const feedback = feedbackPage.getByRole("textbox", { name: "Email message" });
  const sendFeedback = feedbackPage.getByRole("button", { name: "Send Feedback" });
  await expect(feedbackPage.getByRole("heading", { name: "Feedback" })).toBeVisible();
  await expect(sendFeedback).toBeDisabled();
  await expect(feedbackPage.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(feedbackPage.getByRole("link", { name: "open an issue on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/shift-editor/shift/issues/new?template=bug_report.yml",
  );
  await expect(feedbackPage.getByRole("link", { name: "Discord" })).toHaveAttribute(
    "href",
    "https://discord.gg/tgcy4R3Va4",
  );

  await feedback.fill("   ");
  await expect(sendFeedback).toBeDisabled();
  await feedback.fill("The editor is working well.");
  await expect(sendFeedback).toBeEnabled();
  await expect(sendFeedback).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");

  await feedback.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  expect(
    await feedback.evaluate((textarea: HTMLTextAreaElement) => ({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
      length: textarea.value.length,
    })),
  ).toEqual({ start: 0, end: 27, length: 27 });

  await expectCloseOnlyWindowControls(feedbackPage);

  const feedbackWindow = await electronApp.browserWindow(feedbackPage);
  expect(await feedbackWindow.evaluate((window) => window.isModal())).toBe(false);
  await feedbackWindow.dispose();
});

authoredTest("Settings opens the active font configuration", async ({ electronApp, page }) => {
  await clickApplicationMenuItem(page, electronApp, "app.showSettings");

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Font", exact: true })).toBeVisible();
});

authoredTest(
  "Add Component picks, selects, deletes, and restores a glyph reference",
  async ({ editor, page }) => {
    await openFirstAuthoredGlyph(editor);

    const candidate = await page.evaluate(async () => {
      const session = window.shiftSession;
      const editor = window.shift?.editor;
      const glyphNodes = editor?.scene.nodesOfKind("glyph") ?? [];
      const currentGlyphId = glyphNodes.length === 1 ? glyphNodes[0]?.glyphId : null;
      if (!session || !editor || !currentGlyphId) throw new Error("Expected active glyph editor");

      const recordsById = new Map(session.font.glyphRecords().map((record) => [record.id, record]));
      const referencesCurrentGlyph = (candidateId: GlyphId): boolean => {
        const pending = [candidateId];
        const visited = new Set<GlyphId>();

        while (pending.length > 0) {
          const glyphId = pending.pop();
          if (!glyphId || visited.has(glyphId)) continue;
          if (glyphId === currentGlyphId) return true;

          visited.add(glyphId);
          pending.push(...(recordsById.get(glyphId)?.componentBaseGlyphIds ?? []));
        }

        return false;
      };
      let item = null;
      for (const candidate of session.catalog.glyphsCell.peek()) {
        if (candidate.id === currentGlyphId || referencesCurrentGlyph(candidate.id)) continue;

        const candidateGlyph = await editor.font.loadGlyph(candidate.id);
        if (candidateGlyph.geometryAt(editor.externalLocation).contours.length === 0) continue;

        item = candidate;
        break;
      }
      if (!item) throw new Error("Expected eligible component glyph with visible contours");

      const activeSourceId = editor.activeSourceId;
      const glyph = editor.glyphForId(currentGlyphId);
      if (!activeSourceId || !glyph) throw new Error("Expected active glyph layer");

      return {
        id: item.id,
        name: item.name,
        displayName: item.displayName,
        initialCount: glyph.layerForSource(activeSourceId)?.components.length ?? 0,
      };
    });

    await editor.press(process.platform === "darwin" ? "Meta+Shift+C" : "Control+Shift+C");
    const picker = page.getByRole("dialog", { name: "Add Component" });
    await expect(picker).toBeVisible();
    const search = picker.getByRole("textbox", { name: "Search components" });
    await search.fill(candidate.name);
    await expect(
      picker.getByRole("button", { name: `Add ${candidate.displayName} as a component` }),
    ).toBeVisible();
    await search.press("Enter");

    await expect(picker).not.toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount + 1);
    await expect
      .poll(() =>
        page.evaluate((baseGlyphId) => {
          const [object] = window.shift!.editor.objects(window.shift!.editor.selection.ids);
          return object?.kind === "component" && object.component.glyphId === baseGlyphId;
        }, candidate.id),
      )
      .toBe(true);

    const contextTarget = await page.evaluate(() => {
      const editor = window.shift!.editor;
      const [componentId] = editor.selection.ids;
      const object = componentId ? editor.object(componentId) : null;
      const bounds = object?.kind === "component" ? object.bounds() : null;
      const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
      if (!componentId || !bounds || !canvas) throw new Error("Expected selected component bounds");

      const canvasBounds = canvas.getBoundingClientRect();
      for (let row = 1; row < 20; row += 1) {
        for (let column = 1; column < 20; column += 1) {
          const scene = {
            x: bounds.left + (bounds.width * column) / 20,
            y: bounds.top + (bounds.height * row) / 20,
          };
          const target = editor.getPointerTarget(scene);
          if (target.kind !== "component" || target.id !== componentId) continue;

          const screen = editor.projectSceneToScreen(scene);
          return {
            componentId,
            x: canvasBounds.left + screen.x,
            y: canvasBounds.top + screen.y,
          };
        }
      }

      throw new Error("Expected a hittable component position");
    });
    await page.evaluate(() => window.shift!.editor.selection.clear());
    await page.mouse.click(contextTarget.x, contextTarget.y, { button: "right" });
    await expect
      .poll(() => page.evaluate(() => window.shift!.editor.selection.ids))
      .toEqual([contextTarget.componentId]);

    const contextMenuDelete = page.getByRole("menuitem", { name: "Delete", exact: true });
    await expect(contextMenuDelete).toBeVisible();
    await contextMenuDelete.click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount);

    await editor.undo();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount + 1);

    await page.evaluate(
      (componentId) => window.shift!.editor.selection.select([componentId]),
      contextTarget.componentId,
    );
    await editor.press("Delete");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount);

    await editor.undo();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount + 1);

    const componentRow = page.getByTestId(`object-${contextTarget.componentId}`);
    await expect(componentRow).toBeVisible();
    await page.evaluate(() => window.shift!.editor.selection.clear());
    await componentRow.click({ button: "right" });
    await expect
      .poll(() => page.evaluate(() => window.shift!.editor.selection.ids))
      .toEqual([contextTarget.componentId]);
    await expect(contextMenuDelete).toBeVisible();
    await contextMenuDelete.click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount);

    await editor.undo();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount + 1);

    await componentRow.click();
    await componentRow.press("Backspace");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount);

    await editor.undo();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          return node
            ? editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length
            : undefined;
        }),
      )
      .toBe(candidate.initialCount + 1);
  },
);

authoredTest(
  "Add Component creates a missing glyph after confirmation",
  async ({ electronApp, editor, page }) => {
    await openFirstAuthoredGlyph(editor);

    const candidate = await page.evaluate(() => {
      const session = window.shiftSession;
      const editor = window.shift?.editor;
      const [node] = editor?.scene.nodesOfKind("glyph") ?? [];
      const activeSourceId = editor?.activeSourceId;
      if (!session || !editor || !node || !activeSourceId) {
        throw new Error("Expected active glyph editor");
      }

      const choices = [
        { name: "aacute", unicode: 0x00e1 },
        { name: "arrowleft", unicode: 0x2190 },
        { name: "Omega", unicode: 0x03a9 },
      ];
      const entries = session.font.glyphEntries();
      const candidate = choices.find(
        ({ name, unicode }) =>
          !entries.some(
            (glyph) =>
              glyph.name.toLowerCase() === name.toLowerCase() || glyph.unicodes.includes(unicode),
          ),
      );
      if (!candidate) throw new Error("Expected a missing Unicode glyph");

      const glyph = editor.glyphForId(node.glyphId);
      return {
        ...candidate,
        initialCount: glyph?.layerForSource(activeSourceId)?.components.length ?? 0,
      };
    });

    await clickApplicationMenuItem(page, electronApp, "glyph.addComponent");
    const picker = page.getByRole("dialog", { name: "Add Component" });
    const search = picker.getByRole("textbox", { name: "Search components" });
    await search.fill(candidate.name);
    await expect
      .poll(() =>
        picker
          .getByRole("button")
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
      )
      .toContain(`Create and add ${candidate.name} as a component`);
    await search.press("Enter");

    const confirmation = page.getByRole("dialog", { name: `Create ${candidate.name}?` });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Create", exact: true }).click();

    await expect
      .poll(() =>
        page.evaluate(({ name, initialCount }) => {
          const session = window.shiftSession!;
          const editor = window.shift!.editor;
          const record = session.font.glyphEntries().find((glyph) => glyph.name === name);
          const [node] = editor.scene.nodesOfKind("glyph");
          const components = node
            ? (editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)
                ?.components ?? [])
            : [];

          return (
            record !== undefined &&
            components.length === initialCount + 1 &&
            components.some(({ baseGlyphId }) => baseGlyphId === record.id)
          );
        }, candidate),
      )
      .toBe(true);

    await clickApplicationMenuItem(page, electronApp, "edit.undo");
    await expect
      .poll(() =>
        page.evaluate(({ name, initialCount }) => {
          const session = window.shiftSession!;
          const editor = window.shift!.editor;
          const [node] = editor.scene.nodesOfKind("glyph");
          const componentCount = node
            ? (editor.glyphForId(node.glyphId)?.layerForSource(editor.activeSourceId!)?.components
                .length ?? 0)
            : 0;

          return {
            componentCount,
            glyphExists: session.font.glyphEntries().some((glyph) => glyph.name === name),
            initialCount,
          };
        }, candidate),
      )
      .toEqual({
        componentCount: candidate.initialCount,
        glyphExists: false,
        initialCount: candidate.initialCount,
      });
  },
);

authoredTest(
  "Settings rounds mapping display without losing editing precision",
  async ({ page }) => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Axes", exact: true }).click();
    await settings.getByRole("button", { name: "Create axis", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add custom axis" }).click();
    await settings.getByRole("tab", { name: "Mapping", exact: true }).click();

    const input = settings.getByLabel("Source mapping point 2", { exact: true });
    await input.focus();
    await expect(input).toBeFocused();
    await input.fill("42.85278");
    await expect(input).toHaveValue("42.85278");
    await settings.getByRole("heading", { name: "Source Mapping" }).click();
    await expect(input).toHaveValue("42.85");

    await expect
      .poll(() =>
        page.evaluate(() =>
          window
            .shiftSession!.font.getAxisMappings()
            .flatMap((mapping) =>
              mapping.points.flatMap((point) => Object.values(point.output.values)),
            ),
        ),
      )
      .toContain(42.85278);

    const mappings = await page.evaluate(() => window.shiftSession!.font.getAxisMappings());
    await input.focus();
    await expect(input).toHaveValue("42.85278");
    await settings.getByRole("heading", { name: "Source Mapping" }).click();
    await expect(input).toHaveValue("42.85");
    expect(await page.evaluate(() => window.shiftSession!.font.getAxisMappings())).toEqual(
      mappings,
    );
  },
);

authoredTest(
  "Mapping graph keeps a crossed-point drag as one undoable edit",
  async ({ electronApp, page }) => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Axes", exact: true }).click();
    await settings.getByRole("button", { name: "Create axis", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add custom axis" }).click();
    await settings.getByRole("tab", { name: "Mapping", exact: true }).click();
    await settings.getByRole("button", { name: "Add point", exact: true }).click();
    await settings.getByRole("button", { name: "Add point", exact: true }).click();

    const graph = settings.getByRole("img", {
      name: "Custom Axis external to source mapping",
    });
    const handle = graph.getByTestId("mapping-point-2");
    await expect(handle).toBeVisible();
    expect(await graph.locator("text").allTextContents()).toEqual([
      "0",
      "20",
      "40",
      "60",
      "80",
      "100",
      "0",
      "20",
      "40",
      "60",
      "80",
      "100",
    ]);

    const mappingCoordinates = async (): Promise<readonly [number, number][]> =>
      page.evaluate(() => {
        const mapping = window.shiftSession!.font.getAxisMappings()[0];
        const axisId = mapping?.inputs[0];
        if (!mapping || !axisId) throw new Error("Expected an independent axis mapping");

        return mapping.points.map((point) => [
          point.input.values[axisId]!,
          point.output.values[axisId]!,
        ]);
      });
    const centerOf = async (testId: string): Promise<{ x: number; y: number }> => {
      const bounds = await graph.getByTestId(testId).boundingBox();
      if (!bounds) throw new Error(`Expected ${testId} to be visible`);

      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    };

    const userField = settings.getByLabel("User mapping point 2", { exact: true });
    const sourceField = settings.getByLabel("Source mapping point 2", { exact: true });
    const before = await mappingCoordinates();
    const beforeCenter = await centerOf("mapping-point-2");
    const neighborCenter = await centerOf("mapping-point-3");
    const endpointCenter = await centerOf("mapping-point-4");
    await expect(handle).toHaveCSS("cursor", "grab");

    await page.mouse.move(beforeCenter.x, beforeCenter.y);
    await page.mouse.down();
    await expect(handle).toHaveCSS("cursor", "grabbing");
    await expect(graph).toHaveCSS("cursor", "grabbing");

    const crossedX = neighborCenter.x + (endpointCenter.x - neighborCenter.x) * 0.4;
    await page.mouse.move(crossedX, beforeCenter.y - 15, { steps: 3 });
    await expect
      .poll(async () => Number(await userField.inputValue()))
      .toBeGreaterThan(before[2]![0]);
    const firstCrossedUser = Number(await userField.inputValue());
    expect(await mappingCoordinates()).toEqual(before);

    const continuedX = neighborCenter.x + (endpointCenter.x - neighborCenter.x) * 0.65;
    await page.mouse.move(continuedX, beforeCenter.y - 25, { steps: 2 });
    await expect
      .poll(async () => Number(await userField.inputValue()))
      .toBeGreaterThan(firstCrossedUser);
    expect(Number(await sourceField.inputValue())).toBeGreaterThan(before[1]![1]);
    await expect(handle).toHaveCSS("cursor", "grabbing");
    await page.mouse.up();

    await expect.poll(mappingCoordinates).not.toEqual(before);
    const after = await mappingCoordinates();
    const afterCenter = await centerOf("mapping-point-2");
    expect(after[1]![0]).toBeGreaterThan(before[2]![0]);
    expect(Number(await userField.inputValue())).toBeCloseTo(after[1]![0], 2);
    expect(Number(await sourceField.inputValue())).toBeCloseTo(after[1]![1], 2);

    await clickApplicationMenuItem(page, electronApp, "edit.undo");
    await expect.poll(mappingCoordinates).toEqual(before);
    await expect
      .poll(async () => Number(await userField.inputValue()))
      .toBeCloseTo(before[1]![0], 2);
    await expect
      .poll(async () => (await centerOf("mapping-point-2")).x)
      .toBeCloseTo(beforeCenter.x);

    await clickApplicationMenuItem(page, electronApp, "edit.redo");
    await expect.poll(mappingCoordinates).toEqual(after);
    await expect
      .poll(async () => Number(await sourceField.inputValue()))
      .toBeCloseTo(after[1]![1], 2);
    await expect.poll(async () => (await centerOf("mapping-point-2")).x).toBeCloseTo(afterCenter.x);
  },
);

convertiblePreviewTest(
  "View menu distinguishes canvas zoom from interface size",
  async ({ electronApp, page }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);
    await clickApplicationMenuItem(workspacePage, electronApp, "file.save");
    await waitForWorkspaceReady(workspacePage);

    const browserWindow = await electronApp.browserWindow(workspacePage);
    const originalInterfaceSize = await browserWindow.evaluate((window) =>
      window.webContents.getZoomFactor(),
    );
    const originalCanvasZoom = await workspacePage.evaluate(
      () => window.shiftSession?.editor.zoom ?? 0,
    );

    await clickApplicationMenuItem(workspacePage, electronApp, "view.zoomIn");
    const canvasZoom = await workspacePage.evaluate(() => window.shiftSession?.editor.zoom ?? 0);
    expect(canvasZoom).toBeGreaterThan(originalCanvasZoom);
    expect(await browserWindow.evaluate((window) => window.webContents.getZoomFactor())).toBe(
      originalInterfaceSize,
    );

    await clickApplicationMenuItem(workspacePage, electronApp, "ui.increaseSize");
    expect(
      await browserWindow.evaluate((window) => window.webContents.getZoomFactor()),
    ).toBeGreaterThan(originalInterfaceSize);
    expect(await workspacePage.evaluate(() => window.shiftSession?.editor.zoom ?? 0)).toBe(
      canvasZoom,
    );
    await browserWindow.dispose();
  },
);

authoredTest("Home focuses one reusable launcher window", async ({ electronApp, page }) => {
  authoredTest.skip(process.platform !== "darwin", "Home currently lives in the macOS Window menu");
  const initialWindowCount = electronApp.windows().length;
  const launcherOpened = electronApp.waitForEvent("window");

  await clickApplicationMenuItem(page, electronApp, "window.showHome");
  const launcher = await launcherOpened;
  await launcher.waitForURL(/#\/launcher$/);
  expect(electronApp.windows()).toHaveLength(initialWindowCount + 1);

  await clickApplicationMenuItem(page, electronApp, "window.showHome");
  expect(electronApp.windows()).toHaveLength(initialWindowCount + 1);
  await expect.poll(() => launcher.evaluate(() => document.hasFocus())).toBe(true);
});

launcherTest(
  "application menu disables document commands on the launcher",
  async ({ electronApp, page }) => {
    await expect
      .poll(() => applicationMenuItemEnabled(page, electronApp, "app.showSettings"))
      .toBe(false);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "file.new")).toBe(true);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "file.open")).toBe(true);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "file.save")).toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(page, electronApp, "file.saveAs"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(page, electronApp, "file.exportTtf"))
      .toBe(false);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "edit.copy")).toBe(false);
  },
);

binaryPreviewTest(
  "application menu keeps binary previews read-only",
  async ({ electronApp, page }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "app.showSettings"))
      .toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.save"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.saveAs"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.exportTtf"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "edit.copy"))
      .toBe(false);
  },
);

convertiblePreviewTest(
  "application menu converts a preview and refreshes authored capabilities",
  async ({ electronApp, page, saveShiftPath }) => {
    const workspacePage = await openSelectedPreview(page, electronApp);

    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.save"))
      .toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.saveAs"))
      .toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.exportTtf"))
      .toBe(false);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "edit.copy"))
      .toBe(false);

    await clickApplicationMenuItem(workspacePage, electronApp, "file.save");
    await waitForWorkspaceReady(workspacePage);
    await expect
      .poll(() => workspacePage.evaluate(() => window.shiftSession?.mode))
      .toBe("workspace");
    expect(fs.existsSync(saveShiftPath)).toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "file.exportTtf"))
      .toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(workspacePage, electronApp, "edit.copy"))
      .toBe(true);
  },
);

authoredTest(
  "native Edit menu targets text controls and canvas authoring",
  async ({ electronApp, page, editor }) => {
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "file.save")).toBe(true);
    await expect
      .poll(() => applicationMenuItemEnabled(page, electronApp, "file.exportTtf"))
      .toBe(true);
    await expect.poll(() => applicationMenuItemEnabled(page, electronApp, "edit.copy")).toBe(true);

    const search = page.getByPlaceholder("Search glyphs...");
    await search.fill("Alpha");
    await search.evaluate((input: HTMLInputElement) => input.select());
    await clickApplicationMenuItem(page, electronApp, "edit.copy");
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("Alpha");

    await electronApp.evaluate(({ clipboard }) => clipboard.writeText("Beta"));
    await clickApplicationMenuItem(page, electronApp, "edit.paste");
    await expect(search).toHaveValue("Beta");
    await search.fill("");

    await openFirstAuthoredGlyph(editor);
    const originalPointCount = await editor.pointCount();
    expect(originalPointCount).toBeGreaterThan(0);

    await clickApplicationMenuItem(page, electronApp, "edit.selectAll");
    await expect.poll(async () => (await editor.selectionIds()).length).toBe(originalPointCount);
    await clickApplicationMenuItem(page, electronApp, "edit.copy");
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .not.toBe("");

    await clickApplicationMenuItem(page, electronApp, "edit.paste");
    await expect.poll(() => editor.pointCount()).toBe(originalPointCount * 2);

    await clickApplicationMenuItem(page, electronApp, "edit.undo");
    await expect.poll(() => editor.pointCount()).toBe(originalPointCount);
    await clickApplicationMenuItem(page, electronApp, "edit.redo");
    await expect.poll(() => editor.pointCount()).toBe(originalPointCount * 2);

    await clickApplicationMenuItem(page, electronApp, "edit.deleteSelection");
    await expect.poll(() => editor.pointCount()).toBe(originalPointCount);
    await clickApplicationMenuItem(page, electronApp, "edit.undo");
    await expect.poll(() => editor.pointCount()).toBe(originalPointCount * 2);

    await clickApplicationMenuItem(page, electronApp, "edit.selectAll");
    await clickApplicationMenuItem(page, electronApp, "edit.cut");
    await expect.poll(() => editor.pointCount()).toBe(0);
    await clickApplicationMenuItem(page, electronApp, "edit.undo");
    await expect.poll(() => editor.pointCount()).toBe(originalPointCount * 2);
  },
);
