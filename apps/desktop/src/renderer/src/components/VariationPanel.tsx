import { useCallback, useEffect, useRef, useState } from "react";
import type { Axis } from "@shift/types";
import { SidebarSection } from "./sidebar-right/SidebarSection";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";
import { interpolateGlyph, type MasterSnapshot } from "@/lib/interpolation/interpolate";

/** Variation axis slider panel — shown when a variable font is loaded. */
export const VariationPanel = () => {
  const editor = getEditor();
  const engine = editor.fontEngine;
  const fontLoaded = useSignalState(engine.$fontLoaded);

  const [axes, setAxes] = useState<Axis[]>([]);
  const [location, setLocation] = useState<Record<string, number>>({});
  const mastersRef = useRef<MasterSnapshot[] | null>(null);
  const [isInterpolating, setIsInterpolating] = useState(false);
  const [editingGlyph, setEditingGlyph] = useState<string | null>(null);

  // Load axes when font is loaded
  useEffect(() => {
    if (!fontLoaded || !engine.isVariable()) {
      setAxes([]);
      return;
    }

    const fontAxes = engine.getAxes();
    setAxes(fontAxes);

    const defaults: Record<string, number> = {};
    for (const axis of fontAxes) {
      defaults[axis.tag] = axis.default;
    }
    setLocation(defaults);
  }, [fontLoaded, engine]);

  // Track the current glyph and reload masters when it changes
  useEffect(() => {
    setEditingGlyph(engine.getEditingGlyphName());
  });

  useEffect(() => {
    if (axes.length === 0 || !editingGlyph) {
      mastersRef.current = null;
      return;
    }

    mastersRef.current = engine.getGlyphMasterSnapshots(editingGlyph);
    setIsInterpolating(false);
  }, [axes, editingGlyph, engine]);

  const handleAxisChange = useCallback(
    (tag: string, value: number) => {
      const newLocation = { ...location, [tag]: value };
      setLocation(newLocation);

      const ms = mastersRef.current;
      console.log("[V] axis", tag, value, "masters:", ms?.length, "axes:", axes.length);
      if (!ms || ms.length < 2) return;

      const result = interpolateGlyph(ms, axes, newLocation);
      console.log("[V] result:", result ? `ok adv=${result.xAdvance}` : "null");
      if (!result) return;

      setIsInterpolating(true);
      engine.emitGlyph(result);
    },
    [location, axes, engine],
  );

  const handleMasterClick = useCallback(
    (sourceName: string) => {
      const masters = mastersRef.current;
      if (!masters) return;

      const master = masters.find((m) => m.sourceName === sourceName);
      if (!master) return;

      const newLocation: Record<string, number> = {};
      for (const axis of axes) {
        newLocation[axis.tag] = master.location.values[axis.tag] ?? axis.default;
      }
      setLocation(newLocation);

      setIsInterpolating(true);
      engine.emitGlyph(master.snapshot);
    },
    [axes, engine],
  );

  const handleResetToSession = useCallback(() => {
    if (!isInterpolating) return;

    setIsInterpolating(false);
    const sessionGlyph = engine.getSessionGlyph();
    if (sessionGlyph) {
      engine.emitGlyph(sessionGlyph);
    }

    const defaults: Record<string, number> = {};
    for (const axis of axes) {
      defaults[axis.tag] = axis.default;
    }
    setLocation(defaults);
  }, [isInterpolating, engine, axes]);

  if (axes.length === 0) return null;

  const masters = mastersRef.current ?? [];

  return (
    <SidebarSection title="Variation">
      <div className="flex flex-col gap-3">
        {axes.map((axis) => (
          <AxisSlider
            key={axis.tag}
            axis={axis}
            value={location[axis.tag] ?? axis.default}
            onChange={(value) => handleAxisChange(axis.tag, value)}
          />
        ))}
        {masters.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {masters.map((m) => (
              <button
                key={m.sourceId}
                type="button"
                className="px-2 py-0.5 text-[11px] rounded bg-[#f0f0f0] hover:bg-[#e0e0e0] text-[#333] transition-colors"
                onClick={() => handleMasterClick(m.sourceName)}
              >
                {m.sourceName}
              </button>
            ))}
          </div>
        )}
        {isInterpolating && (
          <button
            type="button"
            className="px-2 py-1 text-[11px] rounded bg-[#e8f0fe] hover:bg-[#d0e0fc] text-[#1a73e8] transition-colors"
            onClick={handleResetToSession}
          >
            Back to editing
          </button>
        )}
      </div>
    </SidebarSection>
  );
};

interface AxisSliderProps {
  axis: Axis;
  value: number;
  onChange: (value: number) => void;
}

const AxisSlider = ({ axis, value, onChange }: AxisSliderProps) => {
  const displayValue = Math.round(value);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#666]">{axis.name}</span>
        <span className="text-[11px] font-mono text-[#999]">{displayValue}</span>
      </div>
      <input
        type="range"
        min={axis.minimum}
        max={axis.maximum}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-[#e0e0e0] rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#333]
          [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-sm"
      />
    </div>
  );
};
