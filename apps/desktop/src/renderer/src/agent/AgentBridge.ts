import type { FontRevision, ShiftObservation } from "@shift/runtime";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { AgentCallMap, AgentE2ECallMap, AgentEventMap } from "@shared/agent/protocol";
import {
  domPortTransport,
  serveChannel,
  type ChannelHandlers,
  type ChannelServer,
} from "@shared/workspace/channel";
import type { FontSession } from "@/types/fontSession";
import type { E2EHooks } from "@/testing/e2e/hooks";
import type { WindowRouter } from "@/lib/tabs/WindowNavigation";
import { AgentControl, type ControlCalls } from "./AgentControl";
import { ShiftEditorControl } from "./ShiftEditorControl";
import type { AppReaders } from "./AppReaders";
import { ShiftFontReader } from "./ShiftFontReader";
import { ShiftEditorReader } from "./ShiftEditorReader";
import { ShiftKerningReader } from "./ShiftKerningReader";
import { AgentRevisions } from "./AgentRevisions";
import { ShiftTextRuns } from "./ShiftTextRuns";
import { AgentText } from "./AgentText";
import { AgentDocument } from "./AgentDocument";
import { ShiftPages } from "./ShiftPages";
import { ShiftHistory } from "./ShiftHistory";

/** Serves bounded editor observations for one live renderer window. */
export class AgentBridge {
  readonly #host: ShiftHost;
  readonly #session: FontSession;
  readonly #reader: ShiftFontReader;
  readonly #kerning: ShiftKerningReader;
  readonly #editor: ShiftEditorReader;
  readonly #readers: AppReaders;
  readonly #text: AgentText;
  readonly #document: AgentDocument;
  readonly #revisions: AgentRevisions;
  #requests: ChannelServer<AgentEventMap> | null = null;
  #e2eHooks: E2EHooks | null = null;
  #disposed = false;

  constructor(host: ShiftHost, session: FontSession) {
    this.#host = host;
    this.#session = session;
    this.#reader = new ShiftFontReader(session.font, session.mode);
    this.#kerning = new ShiftKerningReader(session.font);
    this.#editor = new ShiftEditorReader(
      session.editor,
      session.workspace?.editCoordinator ?? null,
    );
    this.#readers = { font: this.#reader, kerning: this.#kerning, editor: this.#editor };
    this.#revisions = new AgentRevisions(session.workspace?.editCoordinator ?? null);
    this.#text = new AgentText(new ShiftTextRuns(session.editor, this.#editor), this.#revisions);
    this.#document = new AgentDocument(
      new ShiftPages(session.editor, this.#editor),
      new ShiftHistory(session.editor),
      this.#revisions,
    );
  }

  /** Connects the renderer lane requested by Electron main. */
  async connect(): Promise<void> {
    const port = nextAgentPort();

    try {
      const { e2eActions } = await this.#host.agent.connect();
      const received = await port.received;
      if (this.#disposed) {
        received.close();
        return;
      }

      this.#requests?.dispose();
      const handlers: ChannelHandlers<AgentCallMap> = {
        "capture.editorBounds": () => this.#editorCaptureBounds(),
        "font.revision": ({ ifFontRevision }) => this.#readRevision(ifFontRevision),
        "editor.inspect": ({ ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#editor.inspect(window.location.hash.slice(1))),
        ...this.#controlCalls(),
        "font.get": ({ ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getFont()),
        "locations.resolve": ({ location, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.resolveLocation(location)),
        "glyphs.list": ({ ifFontRevision, ...input }) =>
          this.#observe(ifFontRevision, () => this.#reader.listGlyphs(input)),
        "glyphs.get": ({ selector, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getGlyph(selector)),
        "sources.get": ({ selector, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getSource(selector)),
        "instances.get": ({ selector, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getInstance(selector)),
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
        ...this.#text.calls,
        ...this.#document.calls,
        "agent.read": async ({ reader, method, args }) => {
          const { value } = await this.#observe(undefined, () => this.#read(reader, method, args));
          return value;
        },
      };
      // E2E actions exist only when main says this is an E2E launch; their
      // builder is loaded on first use, so other launches never load it.
      const e2e: Partial<ChannelHandlers<AgentE2ECallMap>> = e2eActions
        ? { "e2e.call": ({ hook, method, args }) => this.#callHook(hook, method, args) }
        : {};
      this.#requests = serveChannel<AgentCallMap & AgentE2ECallMap, AgentEventMap>(
        domPortTransport(received),
        // The E2E handlers are absent outside E2E launches; the channel answers
        // an unserved call with an error.
        { ...handlers, ...e2e } as ChannelHandlers<AgentCallMap & AgentE2ECallMap>,
      );
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

  /** The calls that control the window: its commands, tool, page, open glyph, camera and selection. */
  #controlCalls(): ControlCalls {
    const { editor, font, tabs } = this.#session;
    const control = new ShiftEditorControl(editor, font, tabs, HASH_ROUTER);
    return new AgentControl(control, this.#editor, this.#revisions, HASH_ROUTER, (command) =>
      this.#host.commands.run(command),
    ).calls;
  }

  /** @throws {Error} for a hook or method the E2E hooks do not have. */
  async #callHook(hook: string, method: string, args: unknown[]): Promise<unknown> {
    const { createE2EHooks } = await import("@/testing/e2e/hooks");
    const hooks = (this.#e2eHooks ??= createE2EHooks(this.#session, this.#host));
    const target: object | undefined = Object.hasOwn(hooks, hook)
      ? hooks[hook as keyof E2EHooks]
      : undefined;
    const call: unknown =
      target && method !== "constructor"
        ? Reflect.get(Object.getPrototypeOf(target), method)
        : null;
    if (typeof call !== "function") throw new Error(`No E2E hook ${hook}.${method}`);
    const result: unknown = await Reflect.apply(call, target, args);
    // An action answers once the workspace has confirmed its edit, as TestEditor settles after one.
    if (hook === "actions") await hooks.session.settle();
    return result;
  }

  /** @throws {Error} for a reader or method the window does not serve. */
  #read(reader: string, method: string, args: unknown[]): unknown {
    const target: object | undefined = Object.hasOwn(this.#readers, reader)
      ? this.#readers[reader as keyof AppReaders]
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

  #observe<Value>(
    ifFontRevision: FontRevision | undefined,
    read: () => Value | Promise<Value>,
  ): Promise<ShiftObservation<Value>> {
    return this.#revisions.observe(ifFontRevision, read);
  }

  #editorCaptureBounds() {
    const element = document.querySelector<HTMLElement>("[data-shift-capture-target='editor']");
    if (!element) throw new Error("This Shift window has no visible editor");

    const { x, y, width, height } = element.getBoundingClientRect();
    if (width <= 0 || height <= 0) throw new Error("The Shift editor is not visible");
    return { x, y, width, height };
  }
}

/** The window's route as its hash router keeps it, for code outside React. */
const HASH_ROUTER: WindowRouter = {
  pathname: () => window.location.hash.slice(1),
  navigate: (path) => {
    window.location.hash = path;
  },
};

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
