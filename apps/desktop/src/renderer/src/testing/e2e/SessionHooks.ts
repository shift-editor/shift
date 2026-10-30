import type { ShiftHost } from "@shared/host/ShiftHost";
import type { CommandId } from "@shared/commands";
import type { AppConfigState } from "@shared/config/config";
import type { GlyphId, GlyphName } from "@shift/types";
import type { FontSession } from "@/types/fontSession";

/** One layer read through the preload's layer store, as the window reads the open document. */
export interface PreloadLayerRead {
  readonly kind: string;
  readonly layerId: string;
  readonly bytes: string;
  readonly closure: readonly string[];
  readonly glyphId: GlyphId;
}

/**
 * The window's font session and host, for E2E specs: commands as the menu runs them, the
 * document's Save As, the preload's layer store, the config, and what a preview keeps in memory.
 *
 * @remarks
 * Served through the E2E hook for test launches only. Agents never see these.
 */
export class SessionHooks {
  readonly #session: FontSession;
  readonly #host: ShiftHost;

  constructor(session: FontSession, host: ShiftHost) {
    this.#session = session;
    this.#host = host;
  }

  /** Runs `command` in this window as its menu item does. */
  runCommand(command: CommandId): Promise<void> {
    return this.#host.commands.run(command);
  }

  /** Whether the authored workspace has published its loaded font; false without a workspace. */
  workspaceLoaded(): boolean {
    return this.#session.workspace?.font.loaded === true;
  }

  /**
   * Saves the document to `savePath` and adopts it as the save target, as Save As does once its
   * dialog returns a path; for specs that run without scripted dialogs.
   */
  async saveDocumentAs(savePath: string): Promise<void> {
    const workspace = this.#session.workspace;
    if (!workspace) throw new Error("Save As needs an authored workspace");
    await workspace.editCoordinator.save(savePath);
  }

  /** Creates the glyph named `name` in one transaction, so one undo removes it. */
  createGlyphInOneStep(name: string): void {
    const workspace = this.#session.workspace;
    if (!workspace) throw new Error("Creating a glyph needs an authored workspace");
    workspace.font.editCoordinator.transaction(`Create ${name}`, () => {
      workspace.editor.createGlyph(name as GlyphName);
    });
  }

  /**
   * Opens the glyph named `name` in this window's font session (authored or preview), and
   * returns its id.
   */
  async openGlyphNamed(name: string): Promise<GlyphId> {
    const font = this.#session.font;
    const entry = font.entryForName(name as GlyphName);
    if (!entry) throw new Error(`Expected a glyph named ${name}`);
    await font.loadGlyph(entry.id);
    window.location.hash = `#/editor/${encodeURIComponent(entry.id)}`;
    return entry.id;
  }

  /**
   * Reads the first glyph that has a layer through the preload's layer store API: the store's
   * kind, that layer's id, its decoded bytes, the glyph's component closure, and its id.
   */
  async firstLayerThroughPreload(): Promise<PreloadLayerRead> {
    const workspace = this.#session.workspace;
    const location = await workspace?.storeLocation();
    if (!workspace || !location) throw new Error("an authored document has a layer store");
    const record = workspace.font.glyphRecords().find((glyph) => glyph.layers.length > 0);
    if (!record) throw new Error("the fixture has a glyph with a layer");
    const layerId = record.layers[0]!.id;

    const layers = this.#host.layers;
    const reader = layers.open(location);
    try {
      return {
        kind: location.kind,
        layerId,
        bytes: new TextDecoder().decode(layers.load(reader, [layerId])),
        closure: layers.componentClosure(reader, [record.id]),
        glyphId: record.id,
      };
    } finally {
      layers.close(reader);
    }
  }

  /** The app config's state: its directory, whether config.toml exists, and the themes found. */
  configState(): Promise<AppConfigState> {
    return this.#host.config.state();
  }

  /** Selects the theme `themeId` in config.toml, as Settings › Appearance does. */
  async setTheme(themeId: string): Promise<void> {
    await this.#host.config.setTheme(themeId);
  }

  /** The name of the catalog's first axis, or null when the font has no axes. */
  firstCatalogAxisName(): string | null {
    return this.#session.catalog.axesCell.peek()[0]?.name ?? null;
  }

  /** Whether the window publishes an authored workspace, and how many glyph models it has loaded. */
  previewLoadState(): { authoredWorkspace: boolean; loadedGlyphCount: number } {
    const session = this.#session;
    return {
      authoredWorkspace: window.shift !== undefined,
      loadedGlyphCount: session.font
        .glyphEntries()
        .filter((entry) => session.editor.glyphForId(entry.id) !== null).length,
    };
  }

  /** Whether the font lists `glyphId`, has an authored record for it, and how many layers its model has. */
  previewGlyphState(glyphId: GlyphId): {
    hasEntry: boolean;
    hasAuthoredRecord: boolean;
    layerCount: number;
  } {
    const session = this.#session;
    return {
      hasEntry: session.font.entryForId(glyphId) !== null,
      hasAuthoredRecord: session.font.recordForId(glyphId) !== null,
      layerCount: session.editor.glyphForId(glyphId)?.layers.length ?? -1,
    };
  }

  /**
   * Makes every later glyph acquisition in the font session reject, so a step that would load
   * or rebuild a glyph model fails instead of quietly reading the source again.
   */
  rejectGlyphAcquisition(): void {
    const font = this.#session.font;
    font.loadGlyph = async () => {
      throw new Error("variation scrub attempted glyph acquisition");
    };
    font.loadGlyphs = async () => {
      throw new Error("variation scrub attempted glyph acquisition");
    };
  }
  /** Loads the glyph `glyphId` and opens it in the editor route, as a catalog double-click does. */
  async openGlyph(glyphId: GlyphId): Promise<void> {
    await this.#session.font.loadGlyph(glyphId);
    window.location.hash = `#/editor/${encodeURIComponent(glyphId)}`;
  }

  /** Waits until the sources being edited have their layers matched to the active one. */
  editingLayersMatched(): Promise<void> {
    return this.#session.editor.editingLayersMatched();
  }

  /**
   * Waits until the workspace has confirmed every edit made so far and the canvas text has laid
   * out; a preview session has no workspace, so only its text settles.
   */
  async settle(): Promise<void> {
    const { workspace, editor } = this.#session;
    if (workspace) await workspace.font.editCoordinator.settled();
    await editor.text.settled();
  }
}
