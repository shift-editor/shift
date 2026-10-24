import { useLayoutEffect, useState, type RefObject } from "react";
import type { ToolbarMetrics } from "../types/toolbar";
import { frameOf } from "./toolbarGeometry";

function sameMetrics(first: ToolbarMetrics | null, second: ToolbarMetrics): boolean {
  if (!first) return false;

  return (
    first.frame.width === second.frame.width &&
    first.frame.height === second.frame.height &&
    first.barLength === second.barLength
  );
}

/**
 * The size of the overlay the bar docks against and of the bar itself, kept
 * current as either resizes. Null until the first measurement.
 *
 * @remarks
 * The bar's length follows its tools, so the bar is observed as well as the overlay.
 */
export function useToolbarMetrics(
  layerRef: RefObject<HTMLDivElement | null>,
): ToolbarMetrics | null {
  const [metrics, setMetrics] = useState<ToolbarMetrics | null>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const bar = layer?.querySelector<HTMLElement>("[data-floating-toolbar]");
    if (!layer || !bar) return;

    const measure = () => {
      const next = {
        frame: frameOf(layer.getBoundingClientRect()),
        barLength: Math.max(bar.offsetWidth, bar.offsetHeight),
      };
      setMetrics((previous) => (sameMetrics(previous, next) ? previous : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    observer.observe(bar);

    return () => observer.disconnect();
  }, [layerRef]);

  return metrics;
}
