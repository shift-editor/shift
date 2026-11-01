import { useCallback, useRef } from "react";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useToolIf } from "@/hooks/useToolIf";
import type { Editor } from "@shift/editor";
import { useSignalState } from "@shift/editor/signals";
import { lineBreakTextItem, type TextItem } from "@shift/editor/text";

/** Receives native text, clipboard, and IME events while a text node is active. */
export function TextInput() {
  const editor = useEditor();
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const tool = useToolIf("text");
  const editing = useSignalState(editor.textEditing.stateCell);

  const textareaRef = useCallback(
    (node: HTMLTextAreaElement) => {
      ref.current = node;
      node.focus();

      // Typing goes to the text until another control, such as a sidebar field or
      // popover, takes focus; it comes back when focus falls to the page again.
      let pending: ReturnType<typeof setTimeout> | undefined;
      const reclaimFocus = () => {
        clearTimeout(pending);
        pending = setTimeout(() => {
          const focused = document.activeElement;
          const focusIsFree = focused === null || focused === document.body;
          if (focusIsFree && editor.toolIf("text")?.state.type === "editing") node.focus();
        }, 0);
      };
      document.addEventListener("focusout", reclaimFocus);
      document.addEventListener("pointerdown", reclaimFocus);
      return () => {
        clearTimeout(pending);
        document.removeEventListener("focusout", reclaimFocus);
        document.removeEventListener("pointerdown", reclaimFocus);
        ref.current = null;
      };
    },
    [editor],
  );

  if (tool?.state.type !== "editing" || !editing) return null;

  const flushInput = () => {
    const textarea = ref.current;
    if (!textarea || composing.current || !textarea.value) return;
    editor.textEditing.typeText(textarea.value);
    textarea.value = "";
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composing.current) return;

    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      try {
        if (e.shiftKey) await editor.redo();
        else await editor.undo();
      } catch (error) {
        console.error("text history failed", error);
      }
      return;
    }

    const extend = e.shiftKey;
    const textEditing = editor.textEditing;
    switch (e.key) {
      case "Escape":
        editor.setActiveTool("select");
        e.preventDefault();
        return;
      case "Enter":
        textEditing.insert([lineBreakTextItem()]);
        e.preventDefault();
        return;
      case "Backspace":
        textEditing.deleteBackward();
        e.preventDefault();
        return;
      case "Delete":
        textEditing.deleteForward();
        e.preventDefault();
        return;
      case "ArrowLeft":
      case "ArrowRight":
        textEditing.move(e.key === "ArrowLeft" ? -1 : 1, horizontalGranularity(e), extend);
        e.preventDefault();
        return;
      case "ArrowUp":
      case "ArrowDown":
        textEditing.moveVertical(e.key === "ArrowUp" ? -1 : 1, extend);
        e.preventDefault();
        return;
      case "a":
        if (e.metaKey || e.ctrlKey) {
          textEditing.selectAll();
          e.preventDefault();
          return;
        }
        break;
      case "c":
        if (e.metaKey || e.ctrlKey) {
          const text = textEditing.selectedItems
            .map((item) => clipboardText(item, editor))
            .join("");
          try {
            if (text) await navigator.clipboard?.writeText(text);
          } catch (error) {
            console.error("writing text clipboard failed", error);
          }
          e.preventDefault();
          return;
        }
        break;
      case "v":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          try {
            textEditing.insertText((await navigator.clipboard?.readText()) ?? "");
          } catch (error) {
            console.error("reading text clipboard failed", error);
          }
          return;
        }
        break;
    }
  };

  return (
    <textarea
      ref={textareaRef}
      onInput={flushInput}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        flushInput();
      }}
      onKeyDown={handleKeyDown}
      aria-label="Text input"
      autoComplete="off"
      style={{
        position: "absolute",
        left: -9999,
        top: -9999,
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: "none",
      }}
    />
  );
}

function horizontalGranularity(e: React.KeyboardEvent): "character" | "word" | "line" {
  if (e.altKey) return "word";
  if (e.metaKey) return "line";
  return "character";
}

/** Copies a picked glyph as `/name`, which pasting reads back as the same glyph. */
function clipboardText(item: TextItem, editor: Editor): string {
  if (item.kind === "linebreak") return "\n";
  if (item.kind === "character") return String.fromCodePoint(item.codepoint);
  const name = editor.font.glyphName(item.glyphId);
  return name ? `/${name}` : "";
}
