import type {
  AuthoredLayer,
  FontOverview,
  FontRevision,
  GlyphGetInput,
  GlyphListInput,
  GlyphPage,
  GlyphResolveInput,
  GlyphSummary,
  LayerGetInput,
  LayerRenderInput,
  LayerResolveInput,
  LayerSvg,
  LocationResolveInput,
  ResolvedGlyphs,
  ResolvedLayer,
  ResolvedLocation,
  ShiftCapabilities,
  ShiftObservation,
  ShiftRead,
  ShiftReadInput,
  ShiftReadState,
  ShiftTarget,
} from "./capabilities";

/** Thrown when the font changed after a read scope bound its revision. */
export class FontChangedError extends Error {
  override readonly name = "FontChangedError";
  readonly expectedRevision: FontRevision;
  readonly actualRevision: FontRevision;

  constructor(expectedRevision: FontRevision, actualRevision: FontRevision) {
    super(
      `The font changed during shift.read (expected revision ${expectedRevision}, now ${actualRevision}); start a new read`,
    );
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/**
 * {@link ShiftRead} over raw capabilities.
 *
 * @remarks
 * Opening a scope reads the font once and binds its revision; every later
 * call carries that revision as `ifFontRevision` and unwraps the observation.
 * A failed call is classified by re-reading the current revision, never by
 * parsing error text, so validation errors leave the scope `active`.
 */
export class ShiftReadScope implements ShiftRead {
  readonly font: { get(): Promise<FontOverview> };
  readonly locations: {
    resolve(input: ShiftReadInput<LocationResolveInput>): Promise<ResolvedLocation>;
  };
  readonly glyphs: {
    list(input?: ShiftReadInput<GlyphListInput>): Promise<GlyphPage>;
    get(input: ShiftReadInput<GlyphGetInput>): Promise<GlyphSummary>;
    resolve(input: ShiftReadInput<GlyphResolveInput>): Promise<ResolvedGlyphs>;
  };
  readonly layers: {
    get(input: ShiftReadInput<LayerGetInput>): Promise<AuthoredLayer>;
    resolve(input: ShiftReadInput<LayerResolveInput>): Promise<ResolvedLayer>;
    render(input: ShiftReadInput<LayerRenderInput>): Promise<LayerSvg>;
  };

  readonly #capabilities: ShiftCapabilities;
  readonly #windowId: number;
  readonly #fontRevision: FontRevision;
  readonly #overview: FontOverview;
  #state: ShiftReadState = "active";
  #staleError: FontChangedError | null = null;

  private constructor(
    capabilities: ShiftCapabilities,
    windowId: number,
    { fontRevision, value }: ShiftObservation<FontOverview>,
  ) {
    this.#capabilities = capabilities;
    this.#windowId = windowId;
    this.#fontRevision = fontRevision;
    this.#overview = value;

    const layers = capabilities.layers;
    const glyphs = capabilities.glyphs;
    this.font = Object.freeze({
      get: async () => {
        this.#assertActive();
        return JSON.parse(JSON.stringify(this.#overview)) as FontOverview;
      },
    });
    this.locations = Object.freeze({
      resolve: (input: ShiftReadInput<LocationResolveInput>) =>
        this.#guard(input, (bound) => capabilities.locations.resolve(bound)),
    });
    this.glyphs = Object.freeze({
      list: (input: ShiftReadInput<GlyphListInput> = {}) =>
        this.#guard(input, (bound) => glyphs.list(bound)),
      get: (input: ShiftReadInput<GlyphGetInput>) =>
        this.#guard(input, (bound) => glyphs.get(bound as GlyphGetInput)),
      resolve: (input: ShiftReadInput<GlyphResolveInput>) =>
        this.#guard(input, (bound) => glyphs.resolve(bound)),
    });
    this.layers = Object.freeze({
      get: (input: ShiftReadInput<LayerGetInput>) =>
        this.#guard(input, (bound) => layers.get(bound)),
      resolve: (input: ShiftReadInput<LayerResolveInput>) =>
        this.#guard(input, (bound) => layers.resolve(bound)),
      render: (input: ShiftReadInput<LayerRenderInput>) =>
        this.#guard(input, (bound) => layers.render(bound)),
    });
  }

  /**
   * Runs `callback` against one revision of a window's font.
   *
   * @param capabilities - Raw capabilities the scope forwards guarded calls to.
   * @param target - The window whose font the scope reads.
   * @param callback - Reads through the scope; it is never retried.
   * @returns The callback's result.
   * @throws {FontChangedError} when the font changes before a guarded call completes.
   */
  static async run<Result>(
    capabilities: ShiftCapabilities,
    target: { windowId: number },
    callback: (read: ShiftRead) => Result | Promise<Result>,
  ): Promise<Result> {
    const read = await ShiftReadScope.open(capabilities, target);
    try {
      return await callback(read);
    } finally {
      read.close();
    }
  }

  /**
   * Opens a scope for hosts that cannot pass a callback, such as a sandbox
   * bridging into another realm. The caller must {@link close} it.
   */
  static async open(capabilities: ShiftCapabilities, { windowId }: { windowId: number }) {
    return new ShiftReadScope(capabilities, windowId, await capabilities.font.get({ windowId }));
  }

  get state(): ShiftReadState {
    return this.#state;
  }

  /** The revision every guarded call in this scope requires. */
  get fontRevision(): FontRevision {
    return this.#fontRevision;
  }

  /** Ends the scope; later calls fail. A stale scope stays stale. */
  close(): void {
    if (this.#state === "active") this.#state = "closed";
  }

  async #guard<Input extends object, Value>(
    input: Input,
    call: (bound: Input & ShiftTarget) => Promise<ShiftObservation<Value>>,
  ): Promise<Value> {
    this.#assertActive();
    if (typeof input !== "object" || input === null) {
      throw new Error("shift.read methods take an input object");
    }
    if ("windowId" in input || "ifFontRevision" in input) {
      throw new Error("shift.read binds windowId and ifFontRevision; omit them");
    }

    let observation: ShiftObservation<Value>;
    try {
      observation = await call({
        ...input,
        windowId: this.#windowId,
        ifFontRevision: this.#fontRevision,
      });
    } catch (error) {
      await this.#detectChange();
      throw error;
    }

    if (observation.fontRevision !== this.#fontRevision) {
      throw this.#markStale(observation.fontRevision);
    }
    return observation.value;
  }

  /** Distinguishes a revision mismatch from any other failure without parsing errors. */
  async #detectChange(): Promise<void> {
    if (this.#staleError) throw this.#staleError;

    let current: FontRevision;
    try {
      ({ fontRevision: current } = await this.#capabilities.font.get({ windowId: this.#windowId }));
    } catch {
      return;
    }
    if (current !== this.#fontRevision) throw this.#markStale(current);
  }

  #markStale(actual: FontRevision): FontChangedError {
    this.#staleError ??= new FontChangedError(this.#fontRevision, actual);
    this.#state = "stale";
    return this.#staleError;
  }

  #assertActive(): void {
    if (this.#staleError) throw this.#staleError;
    if (this.#state === "closed") {
      throw new Error("This shift.read scope has ended; read inside its callback");
    }
  }
}
