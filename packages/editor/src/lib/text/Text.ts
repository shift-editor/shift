import {
  isNodeId,
  mintRunId,
  type GlyphId,
  type GlyphName,
  type NodeId,
  type RunId,
  type SelectableId,
  type TextItemId,
} from "@shift/types";
import { Mat, type Point2D } from "@shift/geo";
import { localPoint } from "../editor/spaces";
import type { TextBoxContent, TextBoxItemContent } from "../clipboard/types";
import { computed, effect, keyedCache, signal, track, untracked } from "../signals";
import type { ComputedSignal, Effect, Signal } from "../signals";
import type { Editor } from "../editor/Editor";
import type { ShiftStore } from "../store/ShiftStore";
import type { StoreIndex } from "../store/StoreIndex";
import type { ShiftEditorRecord } from "../../types/records";
import type { TextRunNode, TextVerticalAlign } from "../../types/node";
import type { Sizing } from "../../types/frame";
import { sameSizing } from "../frames/pageLayout";
import type { TextRunRecord } from "../../types/text";
import {
  characterTextItem,
  glyphTextItem,
  lineBreakTextItem,
  glyphIdForItem,
  type TextItem,
  type TextLayout,
} from "./layout";
import { RunText, type ShapedText } from "./RunText";
import { TextShaper } from "./TextShaper";
import { GlyphNameParser, type TextParseContext, type TextParser } from "./parsing";

/** Owns proof text records and one reactive layout per run identity. */
export class Text {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly #glyphsLoadedCell = signal(0);
  /** Made with the first run's layout, so shaping loads only once text exists. */
  #shaper: TextShaper | null = null;
  // non-reactive: in-flight glyph loads, deduped; a new run's layout checks it, and
  // `#glyphsLoadedCell` bumps when a load ends
  readonly #loading = new Map<GlyphId, Promise<void>>();
  readonly #runsByItem: StoreIndex<TextItemId, TextRunRecord>;
  readonly #unsubscribeStore: () => void;
  readonly #parseContext: TextParseContext = {
    glyphNamed: (name) => {
      const entry = this.#editor.font.entryForName(name);
      return entry ? this.glyphItem(entry.id) : null;
    },
  };
  #parser: TextParser = new GlyphNameParser();
  // non-reactive: one wrapped layout per text box, pruned by #boxPruner when boxes leave the scene
  readonly #boxLayouts = new Map<NodeId, ComputedSignal<TextLayout | null>>();
  #boxPruner: Effect | null = null;
  /** The size the last box was set to or edited at; new boxes start from it. Session-only. */
  #lastBoxSize: number | null = null;
  readonly #runs = keyedCache({
    name: "text.run",
    key: (runId: RunId) => runId,
    dispose: (runText: RunText) => runText.dispose(),
    create: (runIdCell: Signal<RunId>) =>
      // Created on a layout's first read; its shaping effect must not join that computed.
      untracked(
        () =>
          new RunText(this.#editor, runIdCell, {
            run: (id) => this.run(id),
            glyphsLoadedCell: this.#glyphsLoadedCell,
            isLoading: (glyphId) => this.#loading.has(glyphId),
            shaperCell: this.#textShaper().shaperCell,
            onShaped: (shaped) => this.#acquireShapedGlyphs(shaped),
          }),
      ),
  });

  constructor(store: ShiftStore<ShiftEditorRecord>, editor: Editor) {
    this.#store = store;
    this.#editor = editor;
    this.#runsByItem = store.index("textrun", (run) => run.items.map((item) => item.id));
    this.#unsubscribeStore = store.onChange((change) => {
      if (change.after?.type === "textrun") this.#acquireGlyphs(change.after.items);
    });
    for (const record of store.records()) {
      if (record.type === "textrun") this.#acquireGlyphs(record.items);
    }
  }

  /** Returns the run holding an item and the item itself, or null for an unknown id. */
  itemLocation(id: TextItemId): { readonly run: TextRunRecord; readonly item: TextItem } | null {
    const run = this.runForItem(id);
    const item = run?.items.find((candidate) => candidate.id === id);
    return run && item ? { run, item } : null;
  }

  /**
   * Returns a new item that shows a glyph in the font.
   *
   * @remarks
   * A glyph the font maps a character to becomes that character, so it takes
   * part in shaping like typed text; any other glyph is picked by identity.
   *
   * @returns null when the glyph is not in the font.
   */
  glyphItem(glyphId: GlyphId): TextItem | null {
    const font = this.#editor.font;
    const entry = font.entryForId(glyphId);
    if (!entry) return null;
    const typed = entry.unicodes.find((unicode) => font.entryForUnicode(unicode)?.id === glyphId);
    return typed === undefined ? glyphTextItem(glyphId) : characterTextItem(typed);
  }

  /**
   * Returns the glyph an item shows in its run's layout.
   *
   * @returns null for a line break, an unknown item, or a character the font maps no glyph to.
   */
  glyphIdForItem(id: TextItemId): GlyphId | null {
    const run = this.runForItem(id);
    if (!run) return null;
    return this.layoutCell(run.id).peek()?.placedGlyphForItem(id)?.glyph.glyphId ?? null;
  }

  /** Stores an independent proof text source. */
  createRun(items: readonly TextItem[]): TextRunRecord {
    const record: TextRunRecord = {
      id: mintRunId(),
      type: "textrun",
      scope: "document",
      items: [...items],
    };
    this.#store.put(record);
    return record;
  }

  /**
   * Returns a run record.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns only when this run changes.
   */
  run(id: RunId | null): TextRunRecord | null {
    if (!id) return null;
    const record = this.#store.record(id);
    return record?.type === "textrun" ? record : null;
  }

  /**
   * Returns the items of the run a node places.
   *
   * @remarks
   * Reactive like {@link run}. Empty when the run record is gone.
   */
  items(node: TextRunNode): readonly TextItem[] {
    return this.run(node.runId)?.items ?? [];
  }

  /**
   * Returns the run holding an item, or null for an unknown item.
   *
   * @remarks
   * Reactive: the reader reruns when the item is added to or removed from a run.
   */
  runForItem(id: TextItemId): TextRunRecord | null {
    return this.#runsByItem.get(id)[0] ?? null;
  }

  /** Replaces a run's items; the run's definition removes a child whose item went (`onContentChange`). */
  setItems(id: RunId, items: readonly TextItem[]): void {
    const run = this.run(id);
    if (run) this.#store.put({ ...run, items: [...items] });
  }

  /**
   * Inserts items into a run directly after one of its items.
   *
   * @returns false when the run or `afterId` is missing.
   */
  insertAfter(id: RunId, afterId: TextItemId, items: readonly TextItem[]): boolean {
    const current = this.run(id)?.items;
    const index = current?.findIndex((item) => item.id === afterId) ?? -1;
    if (!current || index < 0) return false;

    this.setItems(id, [...current.slice(0, index + 1), ...items, ...current.slice(index + 1)]);
    return true;
  }

  deleteRun(id: RunId): void {
    this.#store.delete(id);
  }

  /** Returns a stable computed whose layout invalidates on content, location, source, or glyph acquisition. */
  layoutCell(id: RunId): ComputedSignal<TextLayout | null> {
    return this.#runs.get(id).layoutCell;
  }

  /**
   * The layout a text box shows: its run's layout wrapped to the box's width.
   *
   * @remarks
   * A box that hugs shows its run's layout as is; a fixed box wraps at its
   * width, and a box filling a frame wraps at the width the frame gives it.
   * Wrapping regroups the run's positioned glyphs into lines without shaping
   * again, so several boxes of one run share its shaping. Reruns when the
   * run's layout, the box's size or width, or (for `fill`) its frame changes.
   */
  boxLayoutCell(node: TextRunNode): ComputedSignal<TextLayout | null> {
    let cell = this.#boxLayouts.get(node.id);
    if (cell) return cell;

    const nodeId = node.id;
    cell = computed(
      () => {
        const box = this.#editor.scene.record(nodeId);
        if (box?.kind !== "textRun") return null;
        const runLayout = this.layoutCell(box.runId);
        track(runLayout);
        return runLayout.peek()?.withWrapWidth(this.#wrapWidth(box)) ?? null;
      },
      { name: "text.boxLayout" },
    );
    this.#boxLayouts.set(nodeId, cell);
    this.#boxPruner ??= effect(
      () => {
        const structure = this.#editor.scene.structureCell.value;
        for (const [id, layout] of this.#boxLayouts) {
          if (structure.get(id) !== null) continue;
          layout.dispose();
          this.#boxLayouts.delete(id);
        }
      },
      { name: "text.boxLayouts.prune" },
    );
    return cell;
  }

  /**
   * Returns the text boxes among `ids` as portable clipboard content.
   *
   * @remarks
   * Glyphs picked by identity travel by name, so a paste into another font
   * finds its glyph of that name; one it lacks is left out.
   */
  boxContent(ids: readonly SelectableId[]): TextBoxContent[] {
    const scene = this.#editor.scene;
    const boxes: TextBoxContent[] = [];
    for (const id of ids) {
      const node = isNodeId(id) ? scene.nodeOfKind(id, "textRun") : null;
      if (!node) continue;

      const items: TextBoxItemContent[] = [];
      for (const item of this.items(node)) {
        const content = this.#itemContent(item);
        if (content) items.push(content);
      }
      boxes.push({
        items,
        position: this.#pagePosition(node),
        size: node.size,
        width: node.width.kind === "fill" ? { kind: "hug" } : node.width,
        height: node.height,
        rotation: node.rotation,
        verticalAlign: node.verticalAlign,
      });
    }
    return boxes;
  }

  /**
   * Places copied text boxes on the active page, `offset` scene units from
   * where they were, each with a run of its own, and returns their ids.
   *
   * @remarks
   * Writes records, so call it inside a history capture.
   */
  placeBoxes(boxes: readonly TextBoxContent[], offset: Point2D): NodeId[] {
    const scene = this.#editor.scene;
    const page = scene.ensurePage();
    return boxes.map((box) => {
      const items = box.items.flatMap((item) => this.#itemFromContent(item) ?? []);
      const run = this.createRun(items);
      return scene.createNode<TextRunNode>({
        kind: "textRun",
        parentId: page.id,
        runId: run.id,
        size: box.size,
        width: box.width,
        height: box.height,
        rotation: box.rotation,
        verticalAlign: box.verticalAlign ?? "top",
        position: { x: box.position.x + offset.x, y: box.position.y + offset.y },
      }).id;
    });
  }

  /** A box's top-left corner on its page, also for a box a frame places. */
  #pagePosition(node: TextRunNode): Point2D {
    if (this.#editor.scene.parent(node.id)?.kind === "page") return { ...node.position };

    // The run's units map the box's corner to its frame origin; undo that, then place it.
    const units = this.#editor.nodeDefinition("textRun").unitsTransform(node);
    const corner = Mat.applyToPoint(Mat.Inverse(units), { x: 0, y: 0 });
    const { x, y } = this.#editor.toScene(node, localPoint(corner.x, corner.y));
    return { x, y };
  }

  #itemContent(item: TextItem): TextBoxItemContent | null {
    switch (item.kind) {
      case "character":
        return { kind: "character", codepoint: item.codepoint };
      case "linebreak":
        return { kind: "linebreak" };
      case "glyph": {
        const name = this.#editor.font.entryForId(item.glyphId)?.name;
        return name ? { kind: "glyph", name } : null;
      }
    }
  }

  #itemFromContent(content: TextBoxItemContent): TextItem | null {
    switch (content.kind) {
      case "character":
        return characterTextItem(content.codepoint);
      case "linebreak":
        return lineBreakTextItem();
      case "glyph": {
        const entry = this.#editor.font.entryForName(content.name as GlyphName);
        return entry ? glyphTextItem(entry.id) : null;
      }
    }
  }

  /**
   * The size a new text box starts at: the size of the box last edited or
   * resized, else the font's own size (one scene unit per font unit).
   */
  get newBoxSize(): number {
    return this.#lastBoxSize ?? this.#editor.font.metricsCell.peek().unitsPerEm;
  }

  /** Notes that the user is working in a box of `size`, so the next new box matches it. */
  rememberBoxSize(size: number): void {
    if (size > 0) this.#lastBoxSize = size;
  }

  /**
   * Sets a text box's size, in scene units per em.
   *
   * @remarks
   * One undo step, joining an open capture; unchanged or non-positive sizes
   * record nothing.
   */
  setSize(nodeId: NodeId, size: number): void {
    const node = this.#editor.scene.nodeOfKind(nodeId, "textRun");
    if (!node || !(size > 0) || node.size === size) return;

    this.#lastBoxSize = size;
    this.#editor.history.captureOrJoin("Resize text", () =>
      this.#editor.scene.updateNode({ id: nodeId, size }),
    );
  }

  /**
   * Sets how a text box's width follows its text: `hug`, `fixed` at a width
   * in scene units, or `fill` its frame.
   *
   * @remarks
   * One undo step, joining an open capture; an unchanged width records nothing.
   */
  setWidth(nodeId: NodeId, width: Sizing): void {
    const node = this.#editor.scene.nodeOfKind(nodeId, "textRun");
    if (!node || sameSizing(node.width, width)) return;

    this.#editor.history.captureOrJoin("Resize text", () =>
      this.#editor.scene.updateNode({ id: nodeId, width }),
    );
  }

  /** Sets where a text box's lines sit in a box taller than its text; one undo step. */
  setVerticalAlign(nodeId: NodeId, verticalAlign: TextVerticalAlign): void {
    const node = this.#editor.scene.nodeOfKind(nodeId, "textRun");
    if (!node || node.verticalAlign === verticalAlign) return;

    this.#editor.history.captureOrJoin("Align text", () =>
      this.#editor.scene.updateNode({ id: nodeId, verticalAlign }),
    );
  }

  /**
   * Sets a text box's height: `hug` its lines, or `fixed` at a height in
   * scene units.
   *
   * @remarks
   * One undo step, joining an open capture; an unchanged height records nothing.
   */
  setHeight(nodeId: NodeId, height: Sizing): void {
    const node = this.#editor.scene.nodeOfKind(nodeId, "textRun");
    if (!node || sameSizing(node.height, height)) return;

    this.#editor.history.captureOrJoin("Resize text", () =>
      this.#editor.scene.updateNode({ id: nodeId, height }),
    );
  }

  /**
   * The width a box wraps its lines at, in font units; null to keep each
   * paragraph on one line.
   */
  #wrapWidth(node: TextRunNode): number | null {
    const metrics = this.#editor.font.metricsCell;
    track(metrics);
    const scale = node.size / metrics.peek().unitsPerEm;
    if (scale <= 0) return null;

    switch (node.width.kind) {
      case "hug":
        return null;
      case "fixed":
        return node.width.size / scale;
      case "fill": {
        const placed = this.#editor.frames.laidOut(node.id);
        return placed ? placed.box.width / scale : null;
      }
    }
  }

  /** The parser for typed and pasted text; replace it to change the input syntax for every run. */
  get parser(): TextParser {
    return this.#parser;
  }

  set parser(parser: TextParser) {
    this.#parser = parser;
  }

  /** Parses typed, pasted, or imported text with {@link parser}. */
  itemsFromText(text: string): TextItem[] {
    return this.#parser.parse(text, this.#parseContext);
  }

  /**
   * Resolves once the shaper reflects the latest glyph directory and every
   * glyph text needs has loaded.
   *
   * @remarks
   * Loading a glyph can reshape text and ask for more glyphs, so this waits
   * until a pass finds nothing pending.
   */
  async settled(): Promise<void> {
    for (;;) {
      await this.#shaper?.settled();
      const loads = this.#loading.values().toArray();
      if (loads.length === 0) return;
      await Promise.all(loads);
    }
  }

  dispose(): void {
    this.#boxPruner?.dispose();
    for (const layout of this.#boxLayouts.values()) layout.dispose();
    this.#boxLayouts.clear();
    this.#unsubscribeStore();
    this.#shaper?.dispose();
    this.#runsByItem.dispose();
    this.#runs.clear();
  }

  #acquireGlyphs(items: readonly TextItem[]): void {
    for (const item of items) {
      if (item.kind === "linebreak") continue;
      const glyphId = glyphIdForItem(item, this.#editor.font);
      if (glyphId && !this.#editor.glyphForId(glyphId)) void this.#loadGlyph(glyphId);
    }
  }

  /** Loads glyphs the shaper substituted in, which no item names directly. */
  #textShaper(): TextShaper {
    this.#shaper ??= new TextShaper(this.#editor);
    return this.#shaper;
  }

  #acquireShapedGlyphs(shaped: ShapedText): void {
    for (const runs of shaped.paragraphs) {
      for (const run of runs ?? []) {
        for (const glyph of run.glyphs) {
          if (glyph.glyphId && !this.#editor.glyphForId(glyph.glyphId)) {
            void this.#loadGlyph(glyph.glyphId);
          }
        }
      }
    }
  }

  #loadGlyph(id: GlyphId): Promise<void> {
    const pending = this.#loading.get(id);
    if (pending) return pending;
    const load = this.#loadGlyphOnce(id);
    this.#loading.set(id, load);
    return load;
  }

  async #loadGlyphOnce(id: GlyphId): Promise<void> {
    try {
      await this.#editor.font.loadGlyph(id);
    } catch (error) {
      console.error("failed to load text glyph", error);
    } finally {
      // After the delete, so a run waiting on this glyph sees the load over, loaded or not.
      this.#loading.delete(id);
      this.#glyphsLoadedCell.update((version) => version + 1);
    }
  }
}
