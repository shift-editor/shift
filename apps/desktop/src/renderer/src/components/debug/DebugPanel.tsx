import { useRef } from "react";
import { useDebugSafe } from "@/context/DebugContext";
import { useSignalEffect } from "@/hooks/useSignalEffect";
import { useSignalText } from "@/hooks/useSignalText";
import { getEditor } from "@/store/store";
import { Separator } from "@shift/ui";

function formatCoords(x: number, y: number): string {
  return `(${Math.round(x)}, ${Math.round(y)})`;
}

export function DebugPanel() {
  const debug = useDebugSafe();
  const editor = getEditor();

  const toolStateRef = useSignalText(() => {
    const name = editor.activeTool.value;
    const state = editor.activeToolState.value;
    return `${name}.${state.type}`;
  });

  const upmRef = useRef<HTMLTableCellElement>(null);
  const screenRef = useRef<HTMLTableCellElement>(null);
  const worldRef = useRef<HTMLTableCellElement>(null);

  useSignalEffect(() => {
    const screen = editor.screenMousePosition.value;
    const upm = editor.projectScreenToUpm(screen.x, screen.y);
    if (upmRef.current) upmRef.current.textContent = formatCoords(upm.x, upm.y);
    if (screenRef.current) screenRef.current.textContent = formatCoords(screen.x, screen.y);
    if (worldRef.current) worldRef.current.textContent = formatCoords(upm.x, upm.y);
  });

  if (!debug?.debugPanelOpen) {
    return null;
  }

  const cellClass = "px-2 py-1 border border-line-subtle";

  return (
    <div className="absolute bottom-4 left-4 z-[100] max-w-100 min-h-50 border border-e bg-surface p-3 shadow-md">
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-primary">Debug Panel</span>
        </div>
        <Separator className="bg-gray-300" />
        <main className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-ui font-medium">Tool State</h2>
            <span ref={toolStateRef} className="text-ui text-muted" />
          </div>
          <Separator className="bg-gray-300" />
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Coordinates</h2>
            <h2 className="text-ui font-medium text-muted">Mouse</h2>
            <table className="w-full text-ui border-collapse table-fixed">
              <thead>
                <tr className="bg-line-subtle">
                  <th className={`text-left font-medium w-16 ${cellClass}`}>Space</th>
                  <th className={`text-left font-medium ${cellClass}`}>Coordinates</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                <tr>
                  <td className={cellClass}>UPM</td>
                  <td ref={upmRef} className={`${cellClass} font-mono tabular-nums`} />
                </tr>
                <tr>
                  <td className={cellClass}>Screen</td>
                  <td ref={screenRef} className={`${cellClass} font-mono tabular-nums`} />
                </tr>
                <tr>
                  <td className={cellClass}>World</td>
                  <td ref={worldRef} className={`${cellClass} font-mono tabular-nums`} />
                </tr>
              </tbody>
            </table>
          </div>
        </main>
      </section>
    </div>
  );
}
