import { useEffect, useMemo, useRef, useState } from "react";

import { computed, signal, useSignalState } from "@/lib/signals";
import type { WorkspaceCommitState } from "@/lib/workspace/WorkspaceEditCoordinator";
import { useEditor, useFontSession } from "@/workspace/WorkspaceContext";

const IDLE_COMMIT_STATE = signal<WorkspaceCommitState>("idle", {
  name: "compiledProof.noWorkspaceCommitState",
});

let nextWorkingFontGeneration = 0;

type WorkingFont = {
  family: string;
  byteLength: number;
  compileMs: number;
  loadMs: number;
  updateMs: number;
};

type WorkingFontStatus = "idle" | "building" | "ready" | "failed";

/**
 * Spike-only DOM projection of scene text-run nodes.
 *
 * It deliberately shares the editor camera and scene instead of introducing a
 * second proofing surface. A complete committed workspace is compiled after
 * text frames appear and after authored edits settle; persistence and a
 * production byte-streaming protocol remain out of scope for this branch.
 */
export function CompiledProofLayer() {
  const session = useFontSession();
  const workspace = session.workspace;
  const editor = useEditor();
  const scene = useSignalState(editor.scene.cell);
  const axes = useSignalState(editor.font.axesCell);
  const commitState = useSignalState(workspace?.commitStateCell ?? IDLE_COMMIT_STATE);
  const cameraCell = useMemo(
    () =>
      computed(
        () => {
          editor.camera.trackViewportTransform();
          return editor.getCameraTransform();
        },
        { name: "compiledProof.camera" },
      ),
    [editor],
  );
  const camera = useSignalState(cameraCell, { schedule: "frame" });
  const [workingFont, setWorkingFont] = useState<WorkingFont | null>(null);
  const [status, setStatus] = useState<WorkingFontStatus>("idle");
  const requestRef = useRef(0);
  const installedFaceRef = useRef<FontFace | null>(null);
  const hasTextFrames = scene.nodes.some((node) => node.kind === "textRun");
  const scale = camera.upmScale * camera.zoom;
  const fontProperties = workingFont
    ? {
        family: workingFont.family,
        byteLength: workingFont.byteLength,
        compileMs: workingFont.compileMs,
        loadMs: workingFont.loadMs,
        updateMs: workingFont.updateMs,
        visibility: "visible" as const,
      }
    : {
        family: undefined,
        byteLength: undefined,
        compileMs: undefined,
        loadMs: undefined,
        updateMs: undefined,
        visibility: "hidden" as const,
      };

  useEffect(() => () => cameraCell.dispose(), [cameraCell]);

  useEffect(() => {
    if (!workspace || !hasTextFrames || commitState !== "idle") return undefined;

    const request = ++requestRef.current;
    const requestStarted = performance.now();
    let cancelled = false;
    setStatus("building");

    void workspace
      .compilePreview()
      .then(async ({ bytes, compileMs }) => {
        const generation = ++nextWorkingFontGeneration;
        const family = `ShiftWorking${generation}`;
        const loadStarted = performance.now();
        const fontBuffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(fontBuffer).set(bytes);
        const face = new FontFace(family, fontBuffer);
        await face.load();
        const loadMs = performance.now() - loadStarted;

        if (cancelled || request !== requestRef.current) return;

        document.fonts.add(face);
        const previous = installedFaceRef.current;
        installedFaceRef.current = face;
        setWorkingFont({
          family,
          byteLength: bytes.byteLength,
          compileMs,
          loadMs,
          updateMs: performance.now() - requestStarted,
        });
        setStatus("ready");

        if (previous) {
          requestAnimationFrame(() => document.fonts.delete(previous));
        }
      })
      .catch(() => {
        if (!cancelled && request === requestRef.current) setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [commitState, hasTextFrames, workspace]);

  useEffect(
    () => () => {
      const installed = installedFaceRef.current;
      if (installed) document.fonts.delete(installed);
    },
    [],
  );

  return (
    <div
      data-compiled-proof-layer
      data-working-font-status={status}
      data-working-font-family={fontProperties.family}
      data-working-font-bytes={fontProperties.byteLength}
      data-working-font-compile-ms={fontProperties.compileMs}
      data-working-font-load-ms={fontProperties.loadMs}
      data-working-font-update-ms={fontProperties.updateMs}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {scene.nodes.map((node) => {
        if (node.kind !== "textRun") return null;

        const run = editor.text.run(node.runId);
        if (!run) return null;

        const screen = editor.projectSceneToScreen(node.position);
        const fontSize = node.size * scale;
        const variationSettings = axes
          .map((axis) => {
            const value = node.externalLocation.values[axis.id] ?? axis.default;
            return `"${axis.tag}" ${value}`;
          })
          .join(", ");

        return (
          <div
            key={node.id}
            data-proof-node-id={node.id}
            data-proof-run-id={node.runId}
            style={{
              position: "absolute",
              left: screen.x,
              top: screen.y,
              transform: "translateY(-1em)",
              transformOrigin: "left baseline",
              visibility: fontProperties.visibility,
              whiteSpace: "pre",
              fontFamily: fontProperties.family,
              fontSize,
              lineHeight: 1,
              fontVariationSettings: variationSettings || "normal",
              fontSynthesis: "none",
              color: "var(--color-foreground, currentColor)",
              background: "color-mix(in srgb, var(--color-background, white) 92%, transparent)",
            }}
          >
            {run.text}
          </div>
        );
      })}
    </div>
  );
}
