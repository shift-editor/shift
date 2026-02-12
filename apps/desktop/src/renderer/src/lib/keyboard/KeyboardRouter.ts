import {
  createCanvasKeyDownBindings,
  createGlobalKeyDownBindings,
  createGlobalKeyUpBindings,
  createTextKeyDownBindings,
} from "./keymaps";
import { normalizeKeyboardEvent } from "./normalize";
import type { KeyBinding, KeyContext } from "./types";

export class KeyboardRouter {
  #getContext: () => KeyContext;
  #globalKeyDown: KeyBinding[];
  #textKeyDown: KeyBinding[];
  #canvasKeyDown: KeyBinding[];
  #globalKeyUp: KeyBinding[];
  #spacePreviewBeforeTemporary: boolean | null = null;

  constructor(getContext: () => KeyContext) {
    this.#getContext = getContext;
    const handlers = {
      activateTemporaryHand: (ctx: KeyContext) => this.#activateTemporaryHand(ctx),
      releaseTemporaryHand: (ctx: KeyContext) => this.#releaseTemporaryHand(ctx),
    };
    this.#globalKeyDown = createGlobalKeyDownBindings();
    this.#textKeyDown = createTextKeyDownBindings();
    this.#canvasKeyDown = createCanvasKeyDownBindings(handlers);
    this.#globalKeyUp = createGlobalKeyUpBindings(handlers);
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    const ctx = this.#getContext();

    if (this.#runBindings(this.#globalKeyDown, ctx, e)) {
      return true;
    }

    if (!ctx.canvasActive) {
      return false;
    }

    if (this.#runBindings(this.#textKeyDown, ctx, e)) {
      return true;
    }

    if (this.#runBindings(this.#canvasKeyDown, ctx, e)) {
      return true;
    }

    return ctx.toolManager.handleKeyDown(e);
  }

  handleKeyUp(e: KeyboardEvent): boolean {
    const ctx = this.#getContext();

    if (this.#runBindings(this.#globalKeyUp, ctx, e)) {
      return true;
    }

    if (!ctx.canvasActive) {
      return false;
    }

    return ctx.toolManager.handleKeyUp(e);
  }

  #runBindings(bindings: readonly KeyBinding[], ctx: KeyContext, e: KeyboardEvent): boolean {
    const event = normalizeKeyboardEvent(e);

    for (const binding of bindings) {
      if (binding.when && !binding.when(ctx)) continue;
      if (!binding.match(event, ctx)) continue;

      if (binding.preventDefault) {
        e.preventDefault();
      }

      const handled = binding.run(ctx, e);
      if (handled) return true;
    }

    return false;
  }

  #activateTemporaryHand(ctx: KeyContext): boolean {
    if (this.#spacePreviewBeforeTemporary !== null) {
      return true;
    }

    const wasPreview = ctx.editor.isPreviewMode();
    this.#spacePreviewBeforeTemporary = wasPreview;
    ctx.editor.requestTemporaryTool("hand", {
      onActivate: () => {
        ctx.editor.setPreviewMode(true);
      },
      onReturn: () => {
        const restore = this.#spacePreviewBeforeTemporary ?? wasPreview;
        ctx.editor.setPreviewMode(restore);
        this.#spacePreviewBeforeTemporary = null;
      },
    });
    return true;
  }

  #releaseTemporaryHand(ctx: KeyContext): boolean {
    if (this.#spacePreviewBeforeTemporary === null) {
      return false;
    }

    ctx.editor.returnFromTemporaryTool();
    this.#spacePreviewBeforeTemporary = null;
    return true;
  }
}
