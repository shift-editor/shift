import { matchChord, normalizeKeyboardEvent } from "./normalize";
import type { KeyBinding, KeyContext } from "./types";

export interface KeymapHandlers {
  activateTemporaryHand: (ctx: KeyContext) => boolean;
  releaseTemporaryHand: (ctx: KeyContext) => boolean;
}

export function createGlobalKeyDownBindings(): KeyBinding[] {
  return [
    {
      id: "global.copy",
      preventDefault: true,
      when: (ctx) => ctx.activeTool !== "text",
      match: (event) => matchChord(event, { key: "c", primaryModifier: true }),
      run: (ctx) => {
        ctx.editor.copy();
        return true;
      },
    },
    {
      id: "global.cut",
      preventDefault: true,
      when: (ctx) => ctx.activeTool !== "text",
      match: (event) => matchChord(event, { key: "x", primaryModifier: true }),
      run: (ctx) => {
        ctx.editor.cut();
        return true;
      },
    },
    {
      id: "global.paste",
      preventDefault: true,
      when: (ctx) => ctx.activeTool !== "text",
      match: (event) => matchChord(event, { key: "v", primaryModifier: true }),
      run: (ctx) => {
        ctx.editor.paste();
        return true;
      },
    },
    {
      id: "global.undo",
      preventDefault: true,
      match: (event) => matchChord(event, { key: "z", primaryModifier: true, shiftKey: false }),
      run: (ctx) => {
        ctx.editor.undo();
        return true;
      },
    },
    {
      id: "global.redo",
      preventDefault: true,
      match: (event) => matchChord(event, { key: "z", primaryModifier: true, shiftKey: true }),
      run: (ctx) => {
        ctx.editor.redo();
        return true;
      },
    },
  ];
}

export function createTextKeyDownBindings(): KeyBinding[] {
  return [
    {
      id: "text.paste",
      preventDefault: true,
      when: (ctx) => ctx.activeTool === "text",
      match: (event) => matchChord(event, { key: "v", primaryModifier: true }),
      run: (ctx) => {
        navigator.clipboard?.readText().then((text) => {
          for (const char of text) {
            const codepoint = char.codePointAt(0);
            if (codepoint !== undefined) {
              ctx.editor.insertTextCodepoint(codepoint);
            }
          }
          ctx.editor.recomputeTextRun();
          ctx.editor.requestRedraw();
        });
        return true;
      },
    },
    {
      id: "text.copy",
      preventDefault: true,
      when: (ctx) => ctx.activeTool === "text",
      match: (event) => matchChord(event, { key: "c", primaryModifier: true }),
      run: (ctx) => {
        const codepoints = ctx.editor.getTextRunCodepoints();
        if (codepoints.length > 0) {
          const text = String.fromCodePoint(...codepoints);
          navigator.clipboard?.writeText(text);
        }
        return true;
      },
    },
    {
      id: "text.capture",
      preventDefault: true,
      when: (ctx) => ctx.activeTool === "text",
      match: (event) => !event.metaKey && !event.ctrlKey,
      run: (ctx, e) => ctx.toolManager.handleKeyDown(e),
    },
  ];
}

export function createCanvasKeyDownBindings(handlers: KeymapHandlers): KeyBinding[] {
  return [
    {
      id: "canvas.zoomIn",
      preventDefault: true,
      match: (event) =>
        event.primaryModifier &&
        !event.shiftKey &&
        !event.altKey &&
        (event.code === "Equal" || event.code === "NumpadAdd"),
      run: (ctx) => {
        ctx.editor.zoomIn();
        ctx.editor.requestRedraw();
        return true;
      },
    },
    {
      id: "canvas.zoomOut",
      preventDefault: true,
      match: (event) =>
        event.primaryModifier &&
        !event.shiftKey &&
        !event.altKey &&
        (event.code === "Minus" || event.code === "NumpadSubtract"),
      run: (ctx) => {
        ctx.editor.zoomOut();
        ctx.editor.requestRedraw();
        return true;
      },
    },
    {
      id: "canvas.temporaryHand.activate",
      preventDefault: true,
      when: (ctx) => ctx.activeTool !== "text",
      match: (event) =>
        matchChord(event, {
          code: "Space",
          shiftKey: false,
          altKey: false,
          metaKey: false,
          ctrlKey: false,
        }),
      run: handlers.activateTemporaryHand,
    },
    {
      id: "canvas.toolShortcut",
      preventDefault: true,
      when: (ctx) => ctx.activeTool !== "text",
      match: (event, ctx) => {
        if (event.primaryModifier || event.shiftKey || event.altKey) return false;
        return ctx.editor
          .getToolShortcuts()
          .some(
            (entry) => entry.shortcut === event.key || entry.shortcut === event.key.toLowerCase(),
          );
      },
      run: (ctx, e) => {
        const event = normalizeKeyboardEvent(e);
        const shortcut = ctx.editor
          .getToolShortcuts()
          .find(
            (entry) => entry.shortcut === event.key || entry.shortcut === event.key.toLowerCase(),
          );
        if (!shortcut) return false;
        ctx.editor.setActiveTool(shortcut.toolId);
        ctx.editor.requestRedraw();
        return true;
      },
    },
    {
      id: "canvas.deleteSelection",
      preventDefault: true,
      when: (ctx) => ctx.activeTool !== "text",
      match: (event) => event.key === "Delete" || event.key === "Backspace",
      run: (ctx) => {
        ctx.editor.deleteSelectedPoints();
        return true;
      },
    },
    {
      id: "canvas.selectAll",
      preventDefault: true,
      match: (event) => matchChord(event, { key: "a", primaryModifier: true }),
      run: (ctx) => {
        ctx.editor.selectAll();
        return true;
      },
    },
  ];
}

export function createGlobalKeyUpBindings(handlers: KeymapHandlers): KeyBinding[] {
  return [
    {
      id: "global.temporaryHand.release",
      preventDefault: true,
      match: (event) => matchChord(event, { code: "Space" }),
      run: handlers.releaseTemporaryHand,
    },
  ];
}
