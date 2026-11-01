import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel, type MessagePort as NodeMessagePort } from "node:worker_threads";
import {
  Channel,
  isRequestEnvelope,
  nodePortTransport,
  type ResponseEnvelope,
  type Transport,
  type TransportMessage,
} from "@shared/workspace/channel";
import { toTransportError } from "@shared/errors";
import type { WorkspaceShell, WorkspaceSync } from "@shared/workspace/lanes";
import type { ShellEventMap, ShellPortCallMap } from "@shared/workspace/protocol";
import { client as laneClient } from "@shared/workspace/remote";
import { WorkspaceHost } from "../../../utility/workspace/WorkspaceHost";
import {
  Font,
  FontStore,
  type Glyph,
  type GlyphLayer,
  type GlyphRenderModel,
} from "@shift/editor/model";
import { signal } from "@shift/editor/signals";
import { emptyExternalAxisLocation } from "@shift/editor/variation";
import type { Point2D } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { ContourId, GlyphName, GlyphRecord, PointId, SourceId, Unicode } from "@shift/types";
import { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { FailingWindowEngine } from "./FailingWindowEngine";
import { layerReaderHost } from "../../../preload/layerReaders";

export type WorkspaceStack = {
  client: FontSessionClient;
  store: FontStore;
  editCoordinator: WorkspaceEditCoordinator;
  font: Font;
  createWorkspace(): Promise<void>;
  openWorkspace(sourcePath: string): Promise<void>;
  /** Closes the workspace; `discard` drops unsaved edits instead of refusing to close. */
  closeWorkspace(discard?: boolean): Promise<void>;
  /**
   * Makes the workspace fail the next edit it is sent, as a write the store
   * refuses would, without applying it.
   */
  failNextPersist(): void;
  /** The window's engine, which can be made to fail its next text layout or glyph preload. */
  engine: FailingWindowEngine;
  dispose(): void;
};

/**
 * The full production editing stack, in-process: real WorkspaceHost (real
 * NAPI, real SQLite in a temp dir) served over real node MessagePorts, with
 * the real client/editCoordinator/FontStore/Font wiring. No Electron, no mocks — the same
 * pattern as WorkspaceHost.test.ts, extended to the renderer side.
 */
export function createWorkspaceStack(): WorkspaceStack {
  const documentsRoot = mkdtempSync(join(tmpdir(), "shift-editor-stack-"));

  const shellLane = new MessageChannel();
  new WorkspaceHost({
    documentsRoot,
    atlasCacheRoot: join(documentsRoot, "atlas-cache"),
    shell: nodePortTransport(shellLane.port2),
    portTransport: (port) => nodePortTransport(port as NodeMessagePort),
  }).start();
  const shellChannel = new Channel<ShellPortCallMap, ShellEventMap>(
    nodePortTransport(shellLane.port1),
  );
  const shell = laneClient<WorkspaceShell, ShellPortCallMap, ShellEventMap>(shellChannel);

  const refusals = { pending: 0 };
  const client = new FontSessionClient(null, {
    transport: async () => {
      const lane = new MessageChannel();
      await shellChannel.call("connect", undefined, [lane.port1]);
      return refusingPersists(nodePortTransport(lane.port2), refusals);
    },
  });
  // The window's engine reads the same store through the preload's reader, as in production.
  const engine = new FailingWindowEngine(layerReaderHost(), client);
  const store = new FontStore({ engine });
  const editCoordinator = new WorkspaceEditCoordinator(client, store, engine);
  const font = new Font({ store, glyphInfo: getGlyphInfo(), editCoordinator });

  return {
    client,
    engine,
    store,
    editCoordinator,
    font,
    async createWorkspace(): Promise<void> {
      await shell.create();
      await client.connect();

      const snapshot = client.workspaceCell.peek();
      if (!snapshot) {
        throw new Error("workspace stack connected without a snapshot");
      }

      await editCoordinator.open(snapshot);
    },
    async openWorkspace(sourcePath: string): Promise<void> {
      await shell.open(sourcePath);
      await client.connect();

      const snapshot = client.workspaceCell.peek();
      if (!snapshot) {
        throw new Error("workspace stack connected without a snapshot");
      }

      await editCoordinator.open(snapshot);
    },
    async closeWorkspace(discard = false): Promise<void> {
      await shell.close(discard);
    },
    failNextPersist(): void {
      refusals.pending += 1;
    },
    dispose(): void {
      engine.dispose();
      client.dispose();
      shellChannel.dispose();
      rmSync(documentsRoot, { recursive: true, force: true });
    },
  };
}

/** A glyph created in a workspace font and loaded, with its layer at the default source. */
export interface LoadedGlyph {
  readonly record: GlyphRecord;
  readonly glyph: Glyph;
  /** The glyph's layer at the font's default source. */
  readonly layer: GlyphLayer;
}

/** A new workspace font over the real stack, with its glyph `A` (U+0041) loaded. */
export interface WorkspaceGlyph extends LoadedGlyph {
  /** The stack the font runs on; the test disposes it. */
  readonly stack: WorkspaceStack;
  /** The glyph's render model at the default source, as the canvas draws it. */
  readonly renderModel: GlyphRenderModel;
}

/**
 * Creates a workspace font on a new {@link createWorkspaceStack} and loads its glyph `A` (U+0041).
 *
 * @returns the stack and the loaded glyph; the caller disposes the stack.
 */
export async function startWorkspaceGlyph(): Promise<WorkspaceGlyph> {
  const stack = createWorkspaceStack();
  await stack.createWorkspace();
  const loaded = await addWorkspaceGlyph(stack, 65 as Unicode);
  const renderModel = loaded.glyph.renderModelAt(
    signal(emptyExternalAxisLocation()),
    signal<SourceId | null>(stack.font.defaultSource.id),
  );
  return { stack, renderModel, ...loaded };
}

/**
 * Creates a glyph in the stack's open font, waits for the workspace to confirm it, and loads it.
 *
 * @param glyph - the new glyph's name, or a code point to name it from Unicode and map it to.
 * @throws {Error} when the font has no record or default-source layer for the new glyph.
 */
export async function addWorkspaceGlyph(
  stack: WorkspaceStack,
  glyph: string | Unicode,
): Promise<LoadedGlyph> {
  const created =
    typeof glyph === "number"
      ? stack.font.createGlyphForUnicode(glyph)
      : stack.font.createGlyph(glyph as GlyphName);
  await stack.editCoordinator.settled();
  const loaded = await stack.font.loadGlyph(created.id);
  const layer = loaded.layerForSource(stack.font.defaultSource.id);
  const record = stack.font.recordForId(created.id);
  if (!layer || !record) throw new Error("Expected the new glyph's record and default layer");
  return { record, glyph: loaded, layer };
}

/** What {@link drawPoints} drew. */
export interface DrawnPoints {
  readonly contourId: ContourId;
  /** The new points' ids, in drawing order. */
  readonly pointIds: readonly PointId[];
}

/**
 * Draws a new contour of on-curve points on `layer` as one finished layer edit, one undo step.
 *
 * @remarks
 * The edit is sent to the workspace but not awaited; await the stack's
 * `editCoordinator.settled()` before reading the committed layer.
 *
 * @param points - the points' positions, in drawing order.
 * @param options - `closed` closes the contour; it is open by default.
 */
export function drawPoints(
  layer: GlyphLayer,
  points: readonly Point2D[],
  { closed = false }: { readonly closed?: boolean } = {},
): DrawnPoints {
  const edit = layer.beginEdit();
  const contourId = edit.addContour(closed);
  const pointIds = edit.addPoints(
    contourId,
    points.map((position) => Point.onCurve(position)),
  );
  edit.finish("Draw points");
  return { contourId, pointIds };
}

/**
 * `transport`, answering `refusals.pending` coming `persist`
 * requests with an error instead of sending them: a workspace failing an edit
 * for a reason the window's engine cannot see, such as a refused write.
 */
function refusingPersists(transport: Transport, refusals: { pending: number }): Transport {
  const listeners: ((message: TransportMessage) => void)[] = [];
  const persist: keyof WorkspaceSync = "persist";
  return {
    ...transport,
    onMessage(listener) {
      listeners.push(listener);
      transport.onMessage(listener);
    },
    post(message, transfer) {
      if (refusals.pending > 0 && isRequestEnvelope(message) && message.type === persist) {
        refusals.pending -= 1;
        const response: ResponseEnvelope = {
          kind: "response",
          id: message.id,
          ok: false,
          error: toTransportError(new Error("the store refused the write")),
        };
        queueMicrotask(() => {
          for (const listener of listeners) listener({ data: response, ports: [] });
        });
        return;
      }
      transport.post(message, transfer);
    },
  };
}
