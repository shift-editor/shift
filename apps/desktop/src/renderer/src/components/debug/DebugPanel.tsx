import { useRef, useEffect } from "react";
import { useDebugSafe } from "@/context/DebugContext";
import { useSignalText } from "@/hooks/useSignalText";
import { getEditor } from "@/store/store";
import { Separator } from "@shift/ui";
import { effect } from "@/lib/reactive";

function formatCoords(x: number, y: number): string {
  return `(${Math.round(x)}, ${Math.round(y)})`;
}

export function DebugPanel() {
  const debug = useDebugSafe();
  const editor = getEditor();
  const isOpen = debug?.debugPanelOpen ?? false;

  useEffect(() => {
    if (isOpen) {
      editor.startFpsMonitor();
    }
    return () => {
      editor.stopFpsMonitor();
    };
  }, [isOpen, editor]);

  const toolStateRef = useSignalText(() => {
    const name = editor.getActiveTool();
    const state = editor.getActiveToolState();
    return `${name}.${state.type}`;
  });

  const fpsRef = useSignalText(() => {
    return `${editor.fps.value}`;
  });

  const upmRef = useRef<HTMLTableCellElement>(null);
  const screenRef = useRef<HTMLTableCellElement>(null);
  const worldRef = useRef<HTMLTableCellElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const fx = effect(() => {
      const screen = editor.screenMousePosition.value;
      const upm = editor.projectScreenToUpm(screen.x, screen.y);
      if (upmRef.current) upmRef.current.textContent = formatCoords(upm.x, upm.y);
      if (screenRef.current) screenRef.current.textContent = formatCoords(screen.x, screen.y);
      if (worldRef.current) worldRef.current.textContent = formatCoords(upm.x, upm.y);
    });
    return () => fx.dispose();
  }, [isOpen, editor]);

  if (!isOpen) {
    return null;
  }

  const cellClass = "px-2 py-1 border border-line-subtle";

  return (
    <div className="absolute bottom-4 left-4 z-[100] max-w-100 min-h-50 border border-e bg-surface p-3 shadow-md">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-primary">Debug Panel</span>
        </div>
        <Separator className="bg-gray-300" />
        <div className="flex items-center">
          <div className="flex flex-col">
            <h2 className="text-ui font-medium">Tool State</h2>
            <span ref={toolStateRef} className="text-ui text-muted" />
          </div>
        </div>
        <Separator className="bg-gray-300" />
        <div className="flex flex-col">
          <h2 className="text-ui font-medium">FPS</h2>
          <span ref={fpsRef} className="text-ui text-muted font-mono tabular-nums" />
        </div>
        <Separator className="bg-gray-300" />
        <div className="flex flex-col">
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
      </section>
    </div>
  );
}
