/**
 * Identifies an app command that can be requested through the Shift host API.
 *
 * Command IDs are shared between renderer-facing UI, native menus, and the main
 * process command registry. The ID is only an identity token; main owns the
 * behavior for each command.
 */
export type CommandId =
  | "app.checkForUpdates"
  | "app.installCommandLineTool"
  | "app.showAbout"
  | "app.showSettings"
  | "help.openWebsite"
  | "help.openDiscord"
  | "help.openX"
  | "help.reportIssue"
  | "help.showLogs"
  | "help.emailFeedback"
  | "file.new"
  | "file.open"
  | "file.openFolder"
  | "file.save"
  | "file.saveAs"
  | "file.export"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.deleteSelection"
  | "edit.duplicate"
  | "edit.selectAll"
  | "edit.deselect"
  | "glyph.addComponent"
  | "glyph.addAnchor"
  | "glyph.decomposeComponents"
  | "glyph.reverseSelectedContour"
  | "glyph.makeFirstPoint"
  | GlyphColorCommandId
  | "window.showHome"
  | "tab.close"
  | "window.close"
  | "window.minimise"
  | "window.maximise"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.toggleGrid"
  | "view.toggleSnapToGrid"
  | "ui.increaseSize"
  | "ui.decreaseSize"
  | "ui.resetSize";

/** A command that tags glyphs with one of the main colours, or clears their colour. */
export type GlyphColorCommandId =
  | "glyph.color.red"
  | "glyph.color.orange"
  | "glyph.color.yellow"
  | "glyph.color.green"
  | "glyph.color.blue"
  | "glyph.color.purple"
  | "glyph.color.pink"
  | "glyph.color.none";

/** One entry of the Glyph › Colour menu. */
export interface GlyphColorCommand {
  readonly id: GlyphColorCommandId;
  readonly label: string;
  /** The named mark colour the command tags with; null clears the colour. */
  readonly color:
    | "red"
    | "orange"
    | "yellow"
    | "darkGreen"
    | "darkBlue"
    | "purple"
    | "magenta"
    | null;
  /** The digit pressed with Control for it. */
  readonly digit: string;
}

/** The Glyph › Colour menu in order: the seven main colours on 1–7, then None on 0. */
export const glyphColorCommands: readonly GlyphColorCommand[] = [
  { id: "glyph.color.red", label: "Red", color: "red", digit: "1" },
  { id: "glyph.color.orange", label: "Orange", color: "orange", digit: "2" },
  { id: "glyph.color.yellow", label: "Yellow", color: "yellow", digit: "3" },
  { id: "glyph.color.green", label: "Green", color: "darkGreen", digit: "4" },
  { id: "glyph.color.blue", label: "Blue", color: "darkBlue", digit: "5" },
  { id: "glyph.color.purple", label: "Purple", color: "purple", digit: "6" },
  { id: "glyph.color.pink", label: "Pink", color: "magenta", digit: "7" },
  { id: "glyph.color.none", label: "None", color: null, digit: "0" },
];

/** Whether `id` is one of the Glyph › Colour commands. */
export function isGlyphColorCommandId(id: CommandId): id is GlyphColorCommandId {
  return glyphColorCommands.some((command) => command.id === id);
}

/** The named mark colour a colour command tags with; null for the one that clears. */
export function glyphColorOf(id: GlyphColorCommandId): GlyphColorCommand["color"] {
  return glyphColorCommands.find((command) => command.id === id)?.color ?? null;
}

/** A command in the Help menu. */
export type HelpCommandId = Extract<CommandId, `help.${string}`>;

/** What the Help menu and the launcher's help button call each help command. */
export const helpCommandLabels = {
  "help.openWebsite": "Website",
  "help.openDiscord": "Discord",
  "help.openX": "X / Twitter",
  "help.reportIssue": "Report a Problem…",
  "help.showLogs": "Show Logs",
  "help.emailFeedback": "Feedback…",
} satisfies Record<HelpCommandId, string>;

/** Help commands in menu order: the links, then ways to report a problem. */
export const helpCommandGroups: readonly (readonly HelpCommandId[])[] = [
  ["help.openWebsite", "help.openDiscord", "help.openX"],
  ["help.reportIssue", "help.showLogs", "help.emailFeedback"],
];

/**
 * Platform-neutral keyboard chord assigned to an application command.
 *
 * @remarks
 * A chord without the primary modifier is a canvas key, such as G: the
 * renderer routes it only while no text field has focus, and native menus
 * leave it unregistered so it never swallows typing.
 */
export interface CommandShortcut {
  readonly key: string;
  readonly primaryModifier: boolean;
  /**
   * The Control key itself, on every platform: ⌃ on macOS, where the primary
   * modifier is ⌘, and the same key as the primary modifier elsewhere.
   */
  readonly controlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** Canonical keyboard shortcuts shared by native menus and renderer routing. */
export const commandShortcuts = {
  "app.showSettings": shortcut(","),
  "tab.close": shortcut("w"),
  "window.close": shortcut("w", true),
  "window.minimise": shortcut("m"),
  "view.zoomIn": shortcut("+"),
  "view.zoomOut": shortcut("-"),
  "ui.increaseSize": shortcut("+", false, true),
  "ui.decreaseSize": shortcut("-", false, true),
  "ui.resetSize": shortcut("0", false, true),
  "file.new": shortcut("n"),
  "file.open": shortcut("o"),
  "file.openFolder": shortcut("o", true),
  "file.save": shortcut("s"),
  "file.saveAs": shortcut("s", true),
  "file.export": shortcut("e", true),
  "edit.undo": shortcut("z"),
  "edit.redo": shortcut("z", true),
  "edit.cut": shortcut("x"),
  "edit.copy": shortcut("c"),
  "edit.paste": shortcut("v"),
  "edit.selectAll": shortcut("a"),
  "glyph.addComponent": shortcut("c", true),
  "view.toggleGrid": canvasKey("g"),
  "view.toggleSnapToGrid": canvasKey("g", true),
  ...glyphColorShortcuts(),
} satisfies Partial<Record<CommandId, CommandShortcut>>;

const shortcutsById: Partial<Record<CommandId, CommandShortcut>> = commandShortcuts;

/** Returns the shortcut assigned to `id`, or null when the command has none. */
export function commandShortcut(id: CommandId): CommandShortcut | null {
  return shortcutsById[id] ?? null;
}

/** Converts a shared command shortcut to Electron's native accelerator syntax. */
export function toElectronAccelerator(shortcut: CommandShortcut): string {
  const parts: string[] = [];
  if (shortcut.primaryModifier) parts.push("CmdOrCtrl");
  if (shortcut.controlKey) parts.push("Ctrl");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");

  const key = shortcut.key === "+" ? "Plus" : shortcut.key.toUpperCase();
  parts.push(key);

  return parts.join("+");
}

function shortcut(key: string, shiftKey = false, altKey = false): CommandShortcut {
  return { key, primaryModifier: true, controlKey: false, shiftKey, altKey };
}

/** Control and a digit for each colour command: ⌃1–⌃7 and ⌃0. */
function glyphColorShortcuts(): Record<GlyphColorCommandId, CommandShortcut> {
  const shortcuts = glyphColorCommands.map(
    ({ id, digit }): [GlyphColorCommandId, CommandShortcut] => [
      id,
      { key: digit, primaryModifier: false, controlKey: true, shiftKey: false, altKey: false },
    ],
  );
  return Object.fromEntries(shortcuts) as Record<GlyphColorCommandId, CommandShortcut>;
}

/** A single key, with Shift at most, that acts on the canvas. */
function canvasKey(key: string, shiftKey = false): CommandShortcut {
  return { key, primaryModifier: false, controlKey: false, shiftKey, altKey: false };
}

/**
 * Identifies a command implemented by the active font renderer.
 *
 * Renderer command IDs are sent from main to the focused font window. Main
 * owns native menu routing; renderer UI owns the resulting surface or edit.
 */
export type RendererCommandId =
  | EditorCommandId
  | GlyphColorCommandId
  | "app.showSettings"
  | "file.export"
  | "glyph.addComponent"
  | "tab.close";

/** Identifies a renderer command that acts on the current editor or text focus. */
export type EditorCommandId =
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.deleteSelection"
  | "edit.duplicate"
  | "edit.selectAll"
  | "edit.deselect"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.toggleGrid"
  | "view.toggleSnapToGrid"
  | "glyph.addAnchor"
  | "glyph.decomposeComponents"
  | "glyph.reverseSelectedContour"
  | "glyph.makeFirstPoint";
