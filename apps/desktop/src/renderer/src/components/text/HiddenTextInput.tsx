/**
 * Hidden textarea that captures text input when the text tool is active.
 *
 * Handles IME composition, clipboard paste, and special characters natively.
 * The textarea is positioned off-screen but remains focused. Input events
 * feed into `editor.textRun`; rendering updates reactively via signals.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getEditor } from "@/store/store";
import { effect } from "@/lib/signals/signal";
import { linebreakCell } from "@/lib/text/layout";

export function TextInput() {
  const editor = getEditor();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [isTextTool, setIsTextTool] = useState(false);

  useEffect(() => {
    const fx = effect(() => {
      setIsTextTool(editor.getActiveTool() === "text");
    });
    return () => fx.dispose();
  }, [editor]);

  const textareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      ref.current = node;
      if (!node) return;

      node.focus();

      const handleFocusLost = () => {
        if (editor.getActiveTool() === "text") {
          setTimeout(() => node.focus(), 0);
        }
      };

      node.addEventListener("blur", handleFocusLost);
    },
    [editor],
  );

  if (!isTextTool) return null;

  const handleInput = () => {
    const textarea = ref.current;
    if (!textarea) return;

    const text = textarea.value;
    if (!text) return;

    for (const char of text) {
      const codepoint = char.codePointAt(0);
      if (codepoint !== undefined) {
        editor.insertTextCodepoint(codepoint);
      }
    }

    textarea.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const extend = e.shiftKey;
    const run = editor.textRun;

    switch (e.key) {
      case "Escape":
        editor.setActiveTool("select");
        e.preventDefault();
        return;

      case "Enter":
        run.insert(linebreakCell());
        e.preventDefault();
        return;

      case "Backspace":
        run.delete();
        e.preventDefault();
        return;

      case "Delete":
        run.deleteForward();
        e.preventDefault();
        return;

      case "ArrowLeft":
        if (e.altKey) {
          run.moveCursorByWord(-1, extend);
        } else if (e.metaKey) {
          run.moveCursorToLineStart(extend);
        } else {
          run.moveCursorLeft(extend);
        }
        e.preventDefault();
        return;

      case "ArrowRight":
        if (e.altKey) {
          run.moveCursorByWord(1, extend);
        } else if (e.metaKey) {
          run.moveCursorToLineEnd(extend);
        } else {
          run.moveCursorRight(extend);
        }
        e.preventDefault();
        return;

      case "ArrowUp":
        run.moveCursorUp(extend);
        e.preventDefault();
        return;

      case "ArrowDown":
        run.moveCursorDown(extend);
        e.preventDefault();
        return;

      case "a":
        if (e.metaKey || e.ctrlKey) {
          run.buffer.selectAll();
          e.preventDefault();
          return;
        }
        break;

      case "c":
        if (e.metaKey || e.ctrlKey) {
          const codepoints = run.buffer.selectedCells
            .map((cell) => (cell.kind === "glyph" ? cell.codepoint : 10))
            .filter((cp): cp is number => cp !== null);
          if (codepoints.length > 0) {
            const text = String.fromCodePoint(...codepoints);
            navigator.clipboard?.writeText(text);
          }
          e.preventDefault();
          return;
        }
        break;

      case "v":
        if (e.metaKey || e.ctrlKey) {
          navigator.clipboard?.readText().then((text) => {
            for (const char of text) {
              const codepoint = char.codePointAt(0);
              if (codepoint !== undefined) {
                editor.insertTextCodepoint(codepoint);
              }
            }
          });
          e.preventDefault();
          return;
        }
        break;
    }
  };

  return (
    <textarea
      ref={textareaRef}
      onInput={handleInput}
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
