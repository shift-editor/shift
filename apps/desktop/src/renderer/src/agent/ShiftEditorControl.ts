import {
  CanvasHiddenError,
  LastTabError,
  ObjectNotFoundError,
  PageNotFoundError,
  ToolNotFoundError,
  type EditorSetViewInput,
  type GlyphSelector,
  type ShiftReadInput,
} from "@shift/runtime";
import type { Editor } from "@shift/editor";
import type { Font } from "@shift/editor/model";
import type { NodeId, SelectableId } from "@shift/types";
import type { CommandId } from "@shared/commands";
import { editorPath } from "@/lib/editorRoute";
import { WindowNavigation, type WindowRouter } from "@/lib/tabs/WindowNavigation";
import type { WindowTabs } from "@/lib/tabs/WindowTabs";
import { ShiftSelectors } from "./ShiftSelectors";
import { ShiftViewport } from "./ShiftViewport";

/**
 * Changes what one window's editor shows, as its toolbar, pages list, glyph
 * overview, zoom and selection do: the tool, the page, the open glyph, the
 * camera and the selection.
 *
 * @remarks
 * Each method makes the same model calls the UI makes for it. None changes
 * font data or is an undo step: tools, pages shown, tabs, the camera and the
 * selection are session state. The one document change is the UI's own:
 * opening a glyph that has no tab yet adds a glyph page to the document, as
 * the glyph overview does. Every method checks its input first and changes
 * nothing when it throws.
 */
export class ShiftEditorControl {
  readonly #editor: Editor;
  readonly #font: Font;
  readonly #tabs: WindowTabs;
  readonly #router: WindowRouter;
  readonly #navigation: WindowNavigation;
  readonly #selectors: ShiftSelectors;
  readonly #viewport: ShiftViewport;

  /**
   * @param tabs - The window's tabs, which pages and glyphs open in.
   * @param router - The window's route, which follows the tab shown.
   */
  constructor(editor: Editor, font: Font, tabs: WindowTabs, router: WindowRouter) {
    this.#editor = editor;
    this.#font = font;
    this.#tabs = tabs;
    this.#router = router;
    this.#navigation = new WindowNavigation(editor, tabs, router);
    this.#selectors = new ShiftSelectors(font);
    this.#viewport = new ShiftViewport(editor);
  }

  /**
   * Makes `tool` the active tool, as its toolbar button or menu item does.
   *
   * @throws {ToolNotFoundError} when the window has no such tool, or this session disables it.
   */
  setTool(tool: string): void {
    const editor = this.#editor;
    const available = editor.toolManager.manifests
      .values()
      .filter((manifest) => !manifest.disabled)
      .map((manifest) => manifest.id)
      .toArray();
    if (!available.includes(tool)) throw new ToolNotFoundError(tool, available);

    // A tool picked from a toolbar slot's menu (Kerning, under Spacing) shows in its slot.
    for (const [slotId, slot] of editor.toolRegistry) {
      const menuItem = slot.menuItems?.find((item) => item.toolId === tool);
      if (!menuItem) continue;

      editor.chooseToolMenuItem(slotId, menuItem.id);
      return;
    }

    editor.setActiveTool(tool);
  }

  /**
   * Shows one of the document's pages, as clicking it in the pages list does.
   *
   * @throws {PageNotFoundError} when no page in the list has that id.
   */
  showPage(pageId: NodeId): void {
    if (!this.#editor.pages.page(pageId)) throw new PageNotFoundError(pageId);

    this.#navigation.showPage(pageId);
  }

  /**
   * Opens a glyph in its tab, as double-clicking it in the glyph overview does:
   * the tab it is already open in, or a new tab framed on the glyph.
   *
   * @remarks
   * A new tab puts the glyph on a new glyph page, which the document saves, so
   * the document then has unsaved changes, as it does when the user opens it.
   *
   * @throws {GlyphNotFoundError} when the font has no such glyph.
   */
  async openGlyph(selector: GlyphSelector): Promise<void> {
    const glyphId = this.#selectors.glyphId(selector);
    await this.#font.loadGlyph(glyphId);

    const opened = this.#tabs.openGlyph(glyphId);
    if (!opened.node) throw new Error(`Glyph ${glyphId} could not be shown`);
    if (opened.placed) this.#editor.fitGlyphFrame(opened.node);

    this.#router.navigate(editorPath(glyphId));
  }

  /**
   * Refuses an app command that would close the window instead of changing
   * what it shows: Close Tab while only the glyph overview is left.
   *
   * @throws {LastTabError} when `command` is Close Tab and no tab but the overview is open.
   */
  checkCommand(command: CommandId): void {
    if (command !== "tab.close") return;
    if (this.#navigation.closeShownClosesWindow()) throw new LastTabError(command);
  }

  /**
   * Zooms the canvas, then centres it on a point, as the zoom controls and the
   * Hand tool do.
   *
   * @throws {CanvasHiddenError} when `center` is given while the canvas has no size.
   */
  setView({ zoom, center }: ShiftReadInput<EditorSetViewInput>): void {
    if (center && !this.#viewport.shown) throw new CanvasHiddenError();

    if (zoom !== undefined) this.#editor.setZoom(zoom);
    if (center) this.#viewport.centerOn(center);
  }

  /**
   * Replaces the selection with `ids`, in order; an empty list clears it.
   *
   * @throws {ObjectNotFoundError} when an id names nothing the editor shows.
   */
  select(ids: readonly SelectableId[]): void {
    const editor = this.#editor;
    const missing = ids.filter((id) => editor.object(id) === null);
    if (missing.length > 0) throw new ObjectNotFoundError(missing);

    editor.selection.select(ids);
  }
}
