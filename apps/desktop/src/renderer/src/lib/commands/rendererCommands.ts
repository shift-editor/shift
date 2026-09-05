import type { EditorCommandId } from "@shared/commands";
import type { ContourId } from "@shift/types";
import type { Editor } from "@/lib/editor/Editor";
import { electronSystemClipboard } from "@/lib/clipboard";
import { objectIsKindOf } from "@/types";

const TEXT_EDIT_COMMANDS = new Set<EditorCommandId>([
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.deleteSelection",
  "edit.selectAll",
]);

/**
 * Executes a renderer-owned app command against one editor.
 *
 * Focused text controls retain conventional Edit-menu behavior. Otherwise the
 * command targets Shift's canvas editor and canonical workspace history.
 *
 * @param editor - Editor whose current selection and document state supply command context.
 * @param id - Shared command identity requested by native shell or renderer UI.
 * @returns true when the command mutates or handles current state.
 */
export async function runRendererCommand(editor: Editor, id: EditorCommandId): Promise<boolean> {
  if (TEXT_EDIT_COMMANDS.has(id)) {
    const textResult = await runFocusedTextEditCommand(id);
    if (textResult !== null) return textResult;
  }

  if (editor.sessionMode === "preview" && id === "edit.selectAll") return false;

  switch (id) {
    case "edit.undo":
      await editor.undo();
      return true;

    case "edit.redo":
      await editor.redo();
      return true;

    case "edit.cut":
      return editor.cut();

    case "edit.copy":
      return editor.copy();

    case "edit.paste":
      return editor.paste();

    case "edit.deleteSelection":
      return editor.deleteSelection();

    case "edit.duplicate": {
      const inserted = editor.duplicateSelection();
      if (inserted.length === 0) return false;

      editor.selection.select(inserted);
      await editor.font.editCoordinator.settled();
      return true;
    }

    case "edit.selectAll":
      editor.selectAll();
      return editor.selection.ids.length > 0;

    case "edit.deselect": {
      const hadSelection = editor.selection.hasSelection();
      editor.selection.clear();
      return hadSelection;
    }

    case "view.zoomIn":
      editor.zoomIn();
      return true;

    case "view.zoomOut":
      editor.zoomOut();
      return true;

    case "glyph.reverseSelectedContour": {
      const contourIds = new Set<ContourId>();

      for (const object of editor.objects(editor.selection.ids)) {
        switch (object.kind) {
          case "point":
          case "segment":
          case "contour":
            contourIds.add(object.contourId);
            break;

          case "anchor":
          case "node":
            break;
        }
      }

      const contours = [...contourIds]
        .map((contourId) => editor.object(contourId))
        .filter((object) => objectIsKindOf(object, "contour"));

      if (contours.length === 0) return false;

      const layer = editor.layerForGeometry({
        contours: contours.map((contour) => contour.contourId),
      });
      if (!layer || layer.sourceId !== editor.activeSourceId) return false;

      editor.transaction("Reverse Contours", () => {
        for (const contour of contours) layer.reverseContour(contour.contourId);
      });

      return true;
    }
  }
}

async function runFocusedTextEditCommand(id: EditorCommandId): Promise<boolean | null> {
  const target = focusedEditableElement();
  if (!target) return null;

  switch (id) {
    case "edit.undo":
      return runDocumentEditCommand("undo");
    case "edit.redo":
      return runDocumentEditCommand("redo");
    case "edit.copy": {
      const text = selectedText(target);
      if (text.length === 0) return false;
      await electronSystemClipboard.writeText(text);
      return true;
    }
    case "edit.cut": {
      const text = selectedText(target);
      if (text.length === 0) return false;
      await electronSystemClipboard.writeText(text);
      return replaceSelectedText(target, "", "deleteByCut");
    }
    case "edit.paste": {
      const text = await electronSystemClipboard.readText();
      return replaceSelectedText(target, text, "insertFromPaste");
    }
    case "edit.deleteSelection":
      return replaceSelectedText(target, "", "deleteContentForward", true);
    case "edit.selectAll":
      return selectAllText(target);
    case "edit.duplicate":
    case "edit.deselect":
    case "view.zoomIn":
    case "view.zoomOut":
    case "glyph.reverseSelectedContour":
      return null;
  }
}

function focusedEditableElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const target = document.activeElement;
  if (!(target instanceof HTMLElement)) return null;
  if (target.matches("input, textarea") || target.isContentEditable) return target;
  return null;
}

function selectedText(target: HTMLElement): string {
  if (isTextControl(target)) {
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start === null || end === null) return "";
    return textControlValue(target).slice(start, end);
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return "";
  const range = selection.getRangeAt(0);
  if (!target.contains(range.commonAncestorContainer)) return "";
  return selection.toString();
}

function replaceSelectedText(
  target: HTMLElement,
  text: string,
  inputType: string,
  deleteForward = false,
): boolean {
  if (isTextControl(target)) {
    if (target.disabled || target.readOnly) return false;
    const start = target.selectionStart;
    let end = target.selectionEnd;
    if (start === null || end === null) return runDocumentEditCommand("insertText", text);
    const value = textControlValue(target);
    if (deleteForward && start === end) end = Math.min(end + 1, value.length);

    const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
    setTextControlValue(target, nextValue);
    const caret = start + text.length;
    target.setSelectionRange(caret, caret);
    dispatchInput(target, inputType, text);
    return true;
  }

  if (!target.isContentEditable) return false;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!target.contains(range.commonAncestorContainer)) return false;
  if (deleteForward && range.collapsed) return runDocumentEditCommand("forwardDelete");

  range.deleteContents();
  if (text.length > 0) {
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  dispatchInput(target, inputType, text);
  return true;
}

function selectAllText(target: HTMLElement): boolean {
  if (isTextControl(target)) {
    target.select();
    return true;
  }

  if (!target.isContentEditable) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function textControlValue(target: HTMLInputElement | HTMLTextAreaElement): string {
  const prototype = textControlPrototype(target);
  const getter = Object.getOwnPropertyDescriptor(prototype, "value")?.get;
  if (!getter) throw new Error("Focused text control has no native value getter");
  return String(getter.call(target));
}

function setTextControlValue(target: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = textControlPrototype(target);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("Focused text control has no native value setter");
  setter.call(target, value);
}

function textControlPrototype(
  target: HTMLInputElement | HTMLTextAreaElement,
): typeof HTMLInputElement.prototype | typeof HTMLTextAreaElement.prototype {
  return target instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : HTMLTextAreaElement.prototype;
}

function dispatchInput(target: HTMLElement, inputType: string, data: string): void {
  target.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data,
      inputType,
    }),
  );
}

function runDocumentEditCommand(command: string, value?: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  return document.execCommand(command, false, value);
}

function isTextControl(target: HTMLElement): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
