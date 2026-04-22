import type { Contour, Point, PointId, Rect2D } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { Glyph } from "@/lib/model/Glyph";
import type { Signal } from "@/lib/reactive/signal";
import type { Selection } from "@/types/selection";
import type { CommandHistory } from "@/lib/commands";
import { CutCommand, PasteCommand } from "@/lib/commands";
import { Contours } from "@shift/font";
import { Polygon } from "@shift/geo";
import { Validate } from "@shift/validation";
import { ValidateClipboard } from "@shift/validation";
import type {
  SystemClipboard,
  ClipboardContent,
  ClipboardImporter,
  ClipboardPayload,
  ContourContent,
  PointContent,
} from "./types";
import { SvgImporter } from "./importers/SvgImporter";

const DEFAULT_PASTE_OFFSET = 20;

const EMPTY_BOUNDS: Rect2D = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
};

export interface ClipboardDeps {
  readonly glyph: Signal<Glyph | null>;
  readonly selection: Selection;
  readonly commands: CommandHistory;
  readonly clipboard: SystemClipboard;
}

interface ClipboardState {
  content: ClipboardContent | null;
  bounds: Rect2D | null;
  timestamp: number;
}

/**
 * Clipboard — owns copy/cut/paste orchestration, content resolution,
 * serialization, and external format importing.
 */
export class Clipboard {
  readonly #deps: ClipboardDeps;
  readonly #importers: ClipboardImporter[] = [];
  #internalState: ClipboardState = {
    content: null,
    bounds: null,
    timestamp: 0,
  };
  #pasteCount = 0;

  constructor(deps: ClipboardDeps) {
    this.#deps = deps;
    this.#importers.push(new SvgImporter());
  }

  async copy(): Promise<boolean> {
    const content = this.#resolveContent();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.#deps.glyph.peek();
    return this.#write(content, glyph?.name);
  }

  async cut(): Promise<boolean> {
    const content = this.#resolveContent();
    if (!content || content.contours.length === 0) return false;

    const glyph = this.#deps.glyph.peek();
    const written = await this.#write(content, glyph?.name);
    if (!written) return false;

    const pointIds = [...this.#deps.selection.pointIds];
    this.#deps.commands.execute(new CutCommand(pointIds));
    this.#deps.selection.clear();
    return true;
  }

  async paste(): Promise<void> {
    const state = await this.#read();
    if (!state.content || state.content.contours.length === 0) return;

    const offset = DEFAULT_PASTE_OFFSET * (this.#pasteCount + 1);
    this.#pasteCount++;
    const cmd = new PasteCommand(state.content, { offset: { x: offset, y: -offset } });
    this.#deps.commands.execute(cmd);

    if (cmd.createdPointIds.length > 0) {
      this.#deps.selection.select(cmd.createdPointIds.map((id) => ({ kind: "point", id })));
    }
  }

  #resolveContent(): ClipboardContent | null {
    const glyph = this.#deps.glyph.peek();
    if (!glyph) return null;
    return resolveClipboardContent(
      glyph,
      this.#deps.selection.pointIds,
      this.#deps.selection.segmentIds,
    );
  }

  async #write(content: ClipboardContent, sourceGlyph?: string): Promise<boolean> {
    const bounds = Polygon.boundingRect(content.contours.flatMap((c) => c.points)) ?? EMPTY_BOUNDS;
    this.#internalState = { content, bounds, timestamp: Date.now() };
    this.#pasteCount = 0;

    try {
      const payload: ClipboardPayload = {
        version: 1,
        format: "shift/glyph-data",
        content,
        metadata: { bounds, timestamp: Date.now(), ...(sourceGlyph ? { sourceGlyph } : {}) },
      };
      this.#deps.clipboard.writeText(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  async #read(): Promise<{ content: ClipboardContent | null }> {
    try {
      const text = this.#deps.clipboard.readText();

      const native = tryDeserialize(text);
      if (native) return { content: native };

      for (const importer of this.#importers) {
        if (importer.canImport(text)) {
          const imported = importer.import(text);
          if (imported) return { content: imported };
        }
      }
    } catch {
      // Fall through
    }
    return this.#internalState;
  }
}

/** Resolve selected points/segments into copyable contour content. */
export function resolveClipboardContent(
  glyph: Glyph,
  pointIds: ReadonlySet<PointId>,
  segmentIds: ReadonlySet<SegmentId>,
): ClipboardContent | null {
  const allPointIds = new Set(pointIds);
  for (const segId of segmentIds) {
    const [id1, id2] = segId.split(":");
    allPointIds.add(id1 as PointId);
    allPointIds.add(id2 as PointId);
  }

  if (allPointIds.size === 0) return null;

  const contours: ContourContent[] = [];

  for (const contour of glyph.contours) {
    const selectedIndices = new Set<number>();

    for (const [idx, point] of contour.points.entries()) {
      if (allPointIds.has(point.id)) {
        selectedIndices.add(idx);
      }
    }

    if (selectedIndices.size === 0) continue;

    if (selectedIndices.size === contour.points.length) {
      contours.push({
        points: contour.points.map(toContent),
        closed: contour.closed,
      });
    } else {
      const expanded = expandPartialSelection(contour, selectedIndices);
      if (!Validate.hasValidAnchor(expanded)) continue;
      contours.push({ points: expanded.map(toContent), closed: false });
    }
  }

  return contours.length > 0 ? { contours } : null;
}

function toContent(point: Point): PointContent {
  return { x: point.x, y: point.y, pointType: point.pointType, smooth: point.smooth };
}

function tryDeserialize(text: string): ClipboardContent | null {
  try {
    const payload = JSON.parse(text);
    if (payload.format !== "shift/glyph-data" || payload.version > 1) return null;
    if (!ValidateClipboard.isClipboardContent(payload.content)) return null;
    return payload.content;
  } catch {
    return null;
  }
}

function expandPartialSelection(contour: Contour, selectedIndices: Set<number>): readonly Point[] {
  const expanded = new Set<number>(selectedIndices);

  for (const idx of selectedIndices) {
    const point = Contours.at(contour, idx, false);
    if (!point) continue;

    if (Validate.isOnCurve(point)) {
      expandForOnCurve(contour, idx, expanded);
    } else {
      expandForOffCurve(contour, idx, expanded);
    }
  }

  return [...expanded]
    .sort((a, b) => a - b)
    .map((idx) => Contours.at(contour, idx, false))
    .filter((p): p is Point => p !== null);
}

function expandForOnCurve(contour: Contour, idx: number, expanded: Set<number>): void {
  const prev = Contours.at(contour, idx - 1, false);
  if (prev && Validate.isOffCurve(prev)) {
    expanded.add(idx - 1);
    const prevPrev = Contours.at(contour, idx - 2, false);
    if (prevPrev && Validate.isOffCurve(prevPrev)) expanded.add(idx - 2);
  }

  const next = Contours.at(contour, idx + 1, false);
  if (next && Validate.isOffCurve(next)) {
    expanded.add(idx + 1);
    const nextNext = Contours.at(contour, idx + 2, false);
    if (nextNext && Validate.isOffCurve(nextNext)) expanded.add(idx + 2);
  }
}

function expandForOffCurve(contour: Contour, idx: number, expanded: Set<number>): void {
  const prev = Contours.at(contour, idx - 1, false);
  if (prev) expanded.add(idx - 1);
  const next = Contours.at(contour, idx + 1, false);
  if (next) expanded.add(idx + 1);
}
