import { useEffect, useMemo } from "react";

import { computed, useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";

const WORKING_FONT_FAMILY = "var(--shift-working-font-family, sans-serif)";

/**
 * Spike-only DOM projection of scene text-run nodes.
 *
 * It deliberately shares the editor camera and scene instead of introducing a
 * second proofing surface. Tests install a compiled FontFace through the CSS
 * custom property above; production font lifecycle and persistence are out of
 * scope for this branch.
 */
export function CompiledProofLayer() {
  const editor = useEditor();
  const scene = useSignalState(editor.scene.cell);
  const axes = useSignalState(editor.font.axesCell);
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
  useEffect(() => () => cameraCell.dispose(), [cameraCell]);
  const scale = camera.upmScale * camera.zoom;

  return (
    <div
      data-compiled-proof-layer
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
              whiteSpace: "pre",
              fontFamily: WORKING_FONT_FAMILY,
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
