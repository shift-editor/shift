/**
 * Hidden textarea that captures text input when the text tool is active.
 *
 * Handles IME composition, clipboard paste, and special characters natively.
 * The textarea is positioned off-screen but remains focused. Input events
 * feed into the TextRunController; rendering updates reactively.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getEditor } from "@/store/store";
import { effect } from "@/lib/reactive/signal";

export function HiddenTextInput() {
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
      (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
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

  const ctrl = editor.textRunController;

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

    switch (e.key) {
      case "Escape":
        editor.setActiveTool("select");
        e.preventDefault();
        return;

      case "Enter":
        ctrl.insert({ glyphName: ".newline", unicode: 10 });
        e.preventDefault();
        return;

      case "Backspace":
        ctrl.delete();
        e.preventDefault();
        return;

      case "Delete":
        ctrl.deleteForward();
        e.preventDefault();
        return;

      case "ArrowLeft":
        if (e.metaKey) {
          ctrl.moveCursorToLineStart(extend);
        } else if (e.altKey) {
          ctrl.moveCursorByWord(-1, extend);
        } else {
          ctrl.moveCursorLeft(extend);
        }
        e.preventDefault();
        return;

      case "ArrowRight":
        if (e.metaKey) {
          ctrl.moveCursorToLineEnd(extend);
        } else if (e.altKey) {
          ctrl.moveCursorByWord(1, extend);
        } else {
          ctrl.moveCursorRight(extend);
        }
        e.preventDefault();
        return;

      case "ArrowUp":
        ctrl.moveCursorVertically(-1, extend);
        e.preventDefault();
        return;

      case "ArrowDown":
        ctrl.moveCursorVertically(1, extend);
        e.preventDefault();
        return;

      case "a":
        if (e.metaKey || e.ctrlKey) {
          ctrl.selectAll();
          e.preventDefault();
          return;
        }
        break;

      case "c":
        if (e.metaKey || e.ctrlKey) {
          const codepoints = ctrl.getCodepoints();
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
