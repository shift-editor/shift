import { useCallback, type PointerEvent } from "react";
import { useFontSession } from "@/workspace/WorkspaceContext";

/** What a click lands on when it means the control, not the sidebar's blank space. */
const CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "label",
  "[contenteditable]",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="gridcell"]',
  '[role="link"]',
  '[role="listbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="row"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="textbox"]',
  '[role="treeitem"]',
].join(", ");

/**
 * Clears the glyph grid's selection when a sidebar's blank space is clicked.
 *
 * @remarks
 * A click on a control (a button, a field, a list row) keeps the selection, so
 * the right sidebar can still edit the glyphs it shows.
 */
export function useDismissGridSelection(): (event: PointerEvent<HTMLElement>) => void {
  const session = useFontSession();

  return useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(CONTROL_SELECTOR)) return;

      const selection = session.tabs.gridSelectionCell.peek();
      if (selection.isEmpty) return;

      session.tabs.selectGlyphs(selection.clear());
    },
    [session.tabs],
  );
}
