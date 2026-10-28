import type { FontRevision, ShiftObservation } from "@shift/runtime";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { AgentCallMap, AgentEventMap } from "@shared/agent/protocol";
import { domPortTransport, serveChannel, type ChannelServer } from "@shared/workspace/channel";
import type { FontSession } from "@/types/fontSession";
import type { AgentReaders } from "./AgentReaders";
import { ShiftFontReader } from "./ShiftFontReader";
import { ShiftEditorReader } from "./ShiftEditorReader";
import { ShiftKerningReader } from "./ShiftKerningReader";

/** Serves bounded editor observations for one live renderer window. */
export class AgentBridge {
  readonly #host: ShiftHost;
  readonly #session: FontSession;
  readonly #reader: ShiftFontReader;
  readonly #kerning: ShiftKerningReader;
  readonly #editor: ShiftEditorReader;
  readonly #readers: AgentReaders;
  readonly #revisionNamespace = crypto.randomUUID();
  #requests: ChannelServer<AgentEventMap> | null = null;
  #disposed = false;

  constructor(host: ShiftHost, session: FontSession) {
    this.#host = host;
    this.#session = session;
    this.#reader = new ShiftFontReader(session.font, session.mode);
    this.#kerning = new ShiftKerningReader(session.font);
    this.#editor = new ShiftEditorReader(
      session.editor,
      session.workspace?.applyStatusCell ?? null,
    );
    this.#readers = { font: this.#reader, kerning: this.#kerning, editor: this.#editor };
  }

  /** Connects the renderer lane requested by Electron main. */
  async connect(): Promise<void> {
    const port = nextAgentPort();

    try {
      await this.#host.agent.connect();
      const received = await port.received;
      if (this.#disposed) {
        received.close();
        return;
      }

      this.#requests?.dispose();
      this.#requests = serveChannel<AgentCallMap, AgentEventMap>(domPortTransport(received), {
        "capture.editorBounds": () => this.#editorCaptureBounds(),
        "font.revision": ({ ifFontRevision }) => this.#readRevision(ifFontRevision),
        "editor.inspect": ({ ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#editor.inspect(window.location.hash.slice(1))),
        "font.get": ({ ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getFont()),
        "locations.resolve": ({ location, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.resolveLocation(location)),
        "glyphs.list": ({ ifFontRevision, ...input }) =>
          this.#observe(ifFontRevision, () => this.#reader.listGlyphs(input)),
        "glyphs.get": ({ selector, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getGlyph(selector)),
        "glyphs.resolve": ({ glyphIds, location, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.resolveGlyphs(glyphIds, location)),
        "kerning.groups": ({ position, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#kerning.groups(position)),
        "kerning.pairs": ({ ifFontRevision, ...input }) =>
          this.#observe(ifFontRevision, () => this.#kerning.pairs(input)),
        "kerning.resolve": ({ pairs, source, location, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#kerning.resolve(pairs, { source, location })),
        "kerning.at": ({ ifFontRevision, ...input }) =>
          this.#observe(ifFontRevision, () => this.#kerning.at(input)),
        "layers.get": ({ ifFontRevision, ...selector }) =>
          this.#observe(ifFontRevision, () => this.#reader.getLayer(selector)),
        "layers.resolve": ({ ifFontRevision, ...selector }) =>
          this.#observe(ifFontRevision, () => this.#reader.resolveLayer(selector)),
        "layers.render": ({ overlays, appearance, ifFontRevision, ...selector }) =>
          this.#observe(ifFontRevision, () =>
            this.#reader.renderLayer(selector, { overlays, appearance }),
          ),
        "agent.read": async ({ reader, method, args }) => {
          const { value } = await this.#observe(undefined, () => this.#read(reader, method, args));
          return value;
        },
      });
    } catch (error) {
      port.cancel();
      throw error;
    }
  }

  /** Disconnects the request lane and prevents a pending connection from publishing. */
  dispose(): void {
    this.#disposed = true;
    this.#requests?.dispose();
    this.#requests = null;
  }

  /** @throws {Error} for a reader or method the window does not serve. */
  #read(reader: string, method: string, args: unknown[]): unknown {
    const target: object | undefined = Object.hasOwn(this.#readers, reader)
      ? this.#readers[reader as keyof AgentReaders]
      : undefined;
    const read: unknown =
      target && method !== "constructor"
        ? Reflect.get(Object.getPrototypeOf(target), method)
        : null;
    if (typeof read !== "function") throw new Error(`No agent read ${reader}.${method}`);
    return Reflect.apply(read, target, args);
  }

  async #readRevision(ifFontRevision: FontRevision | undefined): Promise<FontRevision> {
    const observation = await this.#observe(ifFontRevision, () => null);
    return observation.fontRevision;
  }

  async #observe<Value>(
    ifFontRevision: FontRevision | undefined,
    read: () => Value | Promise<Value>,
  ): Promise<ShiftObservation<Value>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.#session.workspace?.editCoordinator.settled();
      const before = this.#fontRevision();
      this.#assertRevision(ifFontRevision, before);

      const value = await read();
      await this.#session.workspace?.editCoordinator.settled();
      const after = this.#fontRevision();
      if (before === after) return { fontRevision: before, value };
      if (ifFontRevision) this.#assertRevision(ifFontRevision, after);
    }

    throw new Error("The font changed while Shift was reading it; retry the observation");
  }

  #fontRevision(): FontRevision {
    const sequence = this.#session.workspace?.editCoordinator.authoredRevisionCell.peek() ?? 0;
    return `${this.#revisionNamespace}:${sequence}`;
  }

  #assertRevision(expected: FontRevision | undefined, current: FontRevision): void {
    if (!expected || expected === current) return;
    throw new Error(`Font revision mismatch: expected ${expected}, current ${current}`);
  }

  #editorCaptureBounds() {
    const element = document.querySelector<HTMLElement>("[data-shift-capture-target='editor']");
    if (!element) throw new Error("This Shift window has no visible editor");

    const { x, y, width, height } = element.getBoundingClientRect();
    if (width <= 0 || height <= 0) throw new Error("The Shift editor is not visible");
    return { x, y, width, height };
  }
}

function nextAgentPort(): { received: Promise<MessagePort>; cancel: () => void } {
  let cancel = () => {};
  const received = new Promise<MessagePort>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if ((event.data as { type?: string } | null)?.type !== "agent.port") return;

      const port = event.ports[0];
      if (!port) return;

      window.removeEventListener("message", listener);
      resolve(port);
    };

    cancel = () => window.removeEventListener("message", listener);
    window.addEventListener("message", listener);
  });

  return { received, cancel };
}
