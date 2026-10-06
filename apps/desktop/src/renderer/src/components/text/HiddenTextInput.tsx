import { useCallback, useRef } from "react";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState } from "@shift/editor/signals";
import {
  glyphTextItem,
  lineBreakTextItem,
  type SpacingEdge,
  type TextItem,
} from "@shift/editor/text";

/** Receives native text, clipboard, and IME events while a text node is active. */
export function TextInput() {
  const editor = useEditor();
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const tool = useSignalState(editor.toolCell);
  const editing = useSignalState(editor.textEditing.stateCell);

  const textareaRef = useCallback((node: HTMLTextAreaElement | null) => {
    ref.current = node;
    node?.focus();
  }, []);

  if (tool?.id !== "text" || tool.state.type !== "editing" || !editing) return null;

  const insertLiteral = (text: string) => {
    const items = [...text.replaceAll("\r\n", "\n")].map((char) => {
      if (char === "\n") return lineBreakTextItem();
      const codepoint = char.codePointAt(0)!;
      const handle = editor.font.glyphHandleForUnicode(codepoint);
      return glyphTextItem(handle.name, codepoint);
    });
    editor.textEditing.insert(items);
  };

  const flushInput = () => {
    const textarea = ref.current;
    if (!textarea || composing.current || !textarea.value) return;
    insertLiteral(textarea.value);
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
      case "ArrowRight": {
        const direction = e.key === "ArrowLeft" ? -1 : 1;
        const spacing = spacingKey(e, direction);
        if (spacing) textEditing.adjustSpacing(spacing.edge, spacing.delta);
        else textEditing.move(direction, e.altKey ? "word" : "character", extend);
        e.preventDefault();
        return;
      }
      case "Home":
      case "End":
        textEditing.move(e.key === "Home" ? -1 : 1, "line", extend);
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
          const text = textEditing.selectedItems.map(clipboardText).join("");
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
      onBlur={() => {
        setTimeout(() => {
          if (editor.toolIf("text")?.state.type === "editing") ref.current?.focus();
        }, 0);
      }}
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

/**
 * Maps a horizontal arrow to a spacing change, Glyphs-style: the arrow points
 * where the edge moves. ⌘ = right sidebearing, ⌥⌘ (or ⌃, when Mission
 * Control leaves it free) = left sidebearing, ⌃⌘ = outline; ⇧ = ×10.
 */
function spacingKey(
  e: React.KeyboardEvent,
  direction: -1 | 1,
): { edge: SpacingEdge; delta: number } | null {
  const step = e.shiftKey ? 10 : 1;
  if (e.metaKey && e.ctrlKey) return { edge: "outline", delta: direction * step };
  if ((e.metaKey && e.altKey) || (e.ctrlKey && !e.metaKey && !e.altKey)) {
    return { edge: "left", delta: -direction * step };
  }
  if (e.metaKey) return { edge: "right", delta: direction * step };
  return null;
}

function clipboardText(item: TextItem): string {
  if (item.kind === "linebreak") return "\n";
  if (item.codepoint === null) return `/${item.glyphName}`;
  return String.fromCodePoint(item.codepoint);
}
