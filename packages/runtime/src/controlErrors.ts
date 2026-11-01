import type { GlyphId, GlyphName, NodeId, SelectableId } from "@shift/types";

/** Thrown when a command id names no app command. */
export class CommandNotFoundError extends Error {
  override readonly name = "CommandNotFoundError";
  readonly command: string;

  constructor(command: string) {
    super(`No command ${command}; commands.list lists the commands agents can run`);
    this.command = command;
  }
}

/**
 * Thrown when a command changes more than what a window shows: font data,
 * files, or anything outside the window. Agents may not run it.
 */
export class CommandNotRunnableError extends Error {
  override readonly name = "CommandNotRunnableError";
  readonly command: string;
  /** What the command changes: `font`, `file` or `app`. */
  readonly effect: string;

  constructor(command: string, effect: string) {
    super(
      `Agents can run only commands that change the view; ${command} changes ${effectNoun(effect)}`,
    );
    this.command = command;
    this.effect = effect;
  }
}

/** Thrown when a command cannot run in the window now, as its menu item is disabled. */
export class CommandDisabledError extends Error {
  override readonly name = "CommandDisabledError";
  readonly command: string;

  constructor(command: string) {
    super(`${command} cannot run in this window now; commands.list says which can`);
    this.command = command;
  }
}

/** Thrown when a tool id names no tool, or a tool this session disables. */
export class ToolNotFoundError extends Error {
  override readonly name = "ToolNotFoundError";
  readonly tool: string;
  /** The tools the window can switch to. */
  readonly available: readonly string[];

  constructor(tool: string, available: readonly string[]) {
    super(`No tool ${tool} in this window; the tools are ${available.join(", ")}`);
    this.tool = tool;
    this.available = available;
  }
}

/**
 * Thrown when a page id names no page in the window's document, or, with no
 * id, when the window shows no page.
 */
export class PageNotFoundError extends Error {
  override readonly name = "PageNotFoundError";
  /** The page asked for; null when the call meant the page shown. */
  readonly pageId: NodeId | null;

  constructor(pageId: NodeId | null) {
    super(
      pageId === null
        ? "This window shows no page; pass a pageId from editor.inspect's pages"
        : `No page ${pageId} in this document; editor.inspect lists its pages`,
    );
    this.pageId = pageId;
  }
}

/** Thrown when a glyph selector names no glyph in the font. */
export class GlyphNotFoundError extends Error {
  override readonly name = "GlyphNotFoundError";
  /** The glyph asked for, by the name or id it was given. */
  readonly glyph: GlyphName | GlyphId;

  constructor(glyph: GlyphName | GlyphId) {
    super(`Glyph ${glyph} is not in this font`);
    this.glyph = glyph;
  }
}

/** Thrown when ids to select name nothing the editor shows. */
export class ObjectNotFoundError extends Error {
  override readonly name = "ObjectNotFoundError";
  /** Each id that names nothing, in the order given. */
  readonly ids: readonly SelectableId[];

  constructor(ids: readonly SelectableId[]) {
    super(
      `Nothing in this window has the id ${ids.join(", ")}; select ids from layers.get or the open glyph`,
    );
    this.ids = ids;
  }
}

/** Thrown when the camera is moved to a point while the canvas has no size to centre it in. */
export class CanvasHiddenError extends Error {
  override readonly name = "CanvasHiddenError";

  constructor() {
    super("The canvas is not shown yet; open a glyph or show a page first");
  }
}

function effectNoun(effect: string): string {
  switch (effect) {
    case "font":
      return "font data";
    case "file":
      return "files";
    default:
      return "things outside the window";
  }
}
