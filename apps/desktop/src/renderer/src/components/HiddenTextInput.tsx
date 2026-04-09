/**
 * Hidden textarea that captures text input when the text tool is active.
 *
 * Handles IME composition, clipboard paste, and special characters natively.
 * The textarea is positioned off-screen but remains focused. Input events
 * feed into the TextRunController; rendering updates reactively.
 */
import { useEffect, useRef, useState } from "react";
import { getEditor } from "@/store/store";
import { effect } from "@/lib/reactive/signal";
import type { TextRunController } from "@/lib/tools/text/TextRunController";

function moveCursorVertically(ctrl: TextRunController, direction: 1 | -1, extend: boolean): void {
  const state = ctrl.state.peek();
  if (!state) return;

  const { layout } = state;
  const slots = layout.slots;
  if (slots.length === 0) return;

  const cursorIdx = ctrl.cursor;
  const cursorSlot = cursorIdx > 0 ? slots[cursorIdx - 1] : slots[0];
  if (!cursorSlot) return;

  const currentY = cursorSlot.y;
  const cursorX = cursorIdx > 0 ? cursorSlot.x + cursorSlot.advance : cursorSlot.x;

  // Find unique line Y values, sorted descending (UPM: higher Y = higher on screen)
  const lineYs = [...new Set(slots.map((s) => s.y))].sort((a, b) => b - a);
  const currentLineIdx = lineYs.indexOf(currentY);
  if (currentLineIdx === -1) return;

  // direction 1 = down = next line (lower Y in UPM)
  // direction -1 = up = previous line (higher Y in UPM)
  const targetLineIdx = currentLineIdx + direction;
  if (targetLineIdx < 0 || targetLineIdx >= lineYs.length) return;

  const targetY = lineYs[targetLineIdx];

  // Find closest slot on target line by X position
  let bestIdx = 0;
  let bestDist = Infinity;
  for (const [i, slot] of slots.entries()) {
    if (slot.y !== targetY) continue;
    const slotMidX = slot.x + slot.advance / 2;
    const dist = Math.abs(slotMidX - cursorX);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i + 1; // cursor goes after this slot
    }
  }

  // Check if cursor should be before the first slot on the target line
  const firstOnLine = slots.find((s) => s.y === targetY);
  if (firstOnLine && cursorX <= firstOnLine.x) {
    bestIdx = slots.indexOf(firstOnLine);
  }

  if (extend) {
    ctrl.extendSelection(bestIdx);
  } else {
    ctrl.placeCaret(bestIdx);
  }
}

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

  useEffect(() => {
    if (!isTextTool || !ref.current) return;
    ref.current.focus();

    // Re-focus textarea when canvas steals focus (e.g. click on canvas)
    const handleFocusLost = () => {
      if (editor.getActiveTool() === "text") {
        setTimeout(() => ref.current?.focus(), 0);
      }
    };

    ref.current.addEventListener("blur", handleFocusLost);
    return () => ref.current?.removeEventListener("blur", handleFocusLost);
  }, [isTextTool, editor]);

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
          ctrl.moveCursorToStart(extend);
        } else {
          ctrl.moveCursorLeft(extend);
        }
        e.preventDefault();
        return;

      case "ArrowRight":
        if (e.metaKey) {
          ctrl.moveCursorToEnd(extend);
        } else {
          ctrl.moveCursorRight(extend);
        }
        e.preventDefault();
        return;

      case "ArrowUp":
        moveCursorVertically(ctrl, -1, extend);
        e.preventDefault();
        return;

      case "ArrowDown":
        moveCursorVertically(ctrl, 1, extend);
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
      ref={ref}
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
