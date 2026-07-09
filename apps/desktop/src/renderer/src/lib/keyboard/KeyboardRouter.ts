import {
  createCanvasKeyDownBindings,
  createGlobalKeyDownBindings,
  createGlobalKeyUpBindings,
  createTextKeyDownBindings,
} from "./keymaps";
import { normalizeKeyboardEvent } from "./normalize";
import type { KeyBinding, KeyContext } from "./types";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as {
    isContentEditable?: boolean;
    tagName?: string;
    closest?: (selector: string) => unknown;
  };
  if (element.isContentEditable === true) return true;
  const tag = (element.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!element.closest?.('[contenteditable="true"], input, textarea, select');
}

export class KeyboardRouter {
  #getContext: () => KeyContext;
  #globalKeyDown: KeyBinding[];
  #textKeyDown: KeyBinding[];
  #canvasKeyDown: KeyBinding[];
  #globalKeyUp: KeyBinding[];
  #temporaryHandActive = false;

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

  async handleKeyDown(e: KeyboardEvent): Promise<boolean> {
    if (isEditableTarget(e.target)) {
      return false;
    }

    const ctx = this.#getContext();

    if (await this.#runBindings(this.#globalKeyDown, ctx, e)) {
      return true;
    }

    if (!ctx.canvasActive) {
      return false;
    }

    if (await this.#runBindings(this.#textKeyDown, ctx, e)) {
      return true;
    }

    if (await this.#runBindings(this.#canvasKeyDown, ctx, e)) {
      return true;
    }

    return ctx.toolManager.handleKeyDown(e);
  }

  async handleKeyUp(e: KeyboardEvent): Promise<boolean> {
    if (isEditableTarget(e.target)) {
      return false;
    }

    const ctx = this.#getContext();

    if (await this.#runBindings(this.#globalKeyUp, ctx, e)) {
      return true;
    }

    if (!ctx.canvasActive) {
      return false;
    }

    return ctx.toolManager.handleKeyUp(e);
  }

  async #runBindings(
    bindings: readonly KeyBinding[],
    ctx: KeyContext,
    e: KeyboardEvent,
  ): Promise<boolean> {
    const event = normalizeKeyboardEvent(e);

    for (const binding of bindings) {
      if (binding.when && !binding.when(ctx)) continue;
      if (!binding.match(event, ctx)) continue;

      if (binding.preventDefault) {
        e.preventDefault();
      }

      const handled = await binding.run(ctx, e);
      if (handled) return true;
    }

    return false;
  }

  #activateTemporaryHand(ctx: KeyContext): boolean {
    if (this.#temporaryHandActive) {
      return true;
    }

    this.#temporaryHandActive = true;
    ctx.editor.requestTemporaryTool("hand", {});
    return true;
  }

  #releaseTemporaryHand(ctx: KeyContext): boolean {
    if (!this.#temporaryHandActive) {
      return false;
    }

    ctx.editor.returnFromTemporaryTool();
    this.#temporaryHandActive = false;
    return true;
  }
}
