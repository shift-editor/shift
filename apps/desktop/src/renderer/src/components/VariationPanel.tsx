import { useCallback, useEffect, useRef, useState } from "react";
import type { Axis, GlyphVariationData, Source } from "@shift/types";
import { SidebarSection } from "./sidebar-right/SidebarSection";
import { getEditor } from "@/store/store";
import { useSignalState } from "@/lib/reactive";
import { interpolate, normalize } from "@/lib/interpolation/interpolate";
import { Input } from "@shift/ui";

export const VariationPanel = () => {
  const editor = getEditor();
  const font = editor.font;
  const fontLoaded = useSignalState(font.$loaded);

  const [axes, setAxes] = useState<Axis[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [location, setLocation] = useState<Record<string, number>>({});
  const variationDataRef = useRef<GlyphVariationData | null>(null);
  const [isInterpolating, setIsInterpolating] = useState(false);
  const [editingGlyph, setEditingGlyph] = useState<string | null>(null);

  useEffect(() => {
    if (!fontLoaded || !font.isVariable()) {
      setAxes([]);
      setSources([]);
      return;
    }

    const fontAxes = font.getAxes();
    setAxes(fontAxes);
    setSources(font.getSources());

    const defaults: Record<string, number> = {};
    for (const axis of fontAxes) {
      defaults[axis.tag] = axis.default;
    }
    setLocation(defaults);
  }, [fontLoaded, font]);

  useEffect(() => {
    setEditingGlyph(editor.getActiveGlyphName());
  });

  // Fetch variation data ONCE per glyph (cached in ref). Slider scrub reads from
  // the cache and never goes back to Rust. TODO Phase D: invalidate on glyph
  // commit (needs a commit-version signal on Glyph).
  useEffect(() => {
    if (axes.length === 0 || !editingGlyph) {
      variationDataRef.current = null;
      return;
    }
    variationDataRef.current = font.getGlyphVariationData(editingGlyph);
    setIsInterpolating(false);
  }, [axes, editingGlyph, font]);

  // Pure JS math, zero NAPI calls.
  const applyAt = useCallback(
    (newLocation: Record<string, number>) => {
      const data = variationDataRef.current;
      if (!data) return;

      const values = interpolate(data, normalize(newLocation, axes));
      const glyph = editor.glyph.peek();
      if (glyph) glyph.applyValues(values);
      font.setVariationLocation({ values: newLocation });
    },
    [axes, editor, font],
  );

  const handleAxisChange = useCallback(
    (tag: string, value: number) => {
      const newLocation = { ...location, [tag]: value };
      setLocation(newLocation);
      setIsInterpolating(true);
      applyAt(newLocation);
    },
    [location, applyAt],
  );

  const handleMasterClick = useCallback(
    (source: Source) => {
      const newLocation: Record<string, number> = {};
      for (const axis of axes) {
        newLocation[axis.tag] = source.location.values[axis.tag] ?? axis.default;
      }
      setLocation(newLocation);
      setIsInterpolating(true);
      applyAt(newLocation);
    },
    [axes, applyAt],
  );

  const handleResetToSession = useCallback(() => {
    if (!isInterpolating) return;

    setIsInterpolating(false);
    font.setVariationLocation(null);
    const glyph = editor.glyph.peek();
    if (glyph) {
      glyph.restoreSnapshot(glyph.toSnapshot());
    }

    const defaults: Record<string, number> = {};
    for (const axis of axes) {
      defaults[axis.tag] = axis.default;
    }
    setLocation(defaults);
  }, [isInterpolating, editor, font, axes]);

  if (axes.length === 0) return null;

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
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                className="px-2 py-0.5 text-[11px] rounded bg-[#f0f0f0] hover:bg-[#e0e0e0] text-[#333] transition-colors"
                onClick={() => handleMasterClick(s)}
              >
                {s.name}
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
      <Input
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
