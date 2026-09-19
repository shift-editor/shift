import { useEffect, useRef, useState } from "react";
import { drag, type D3DragEvent } from "d3-drag";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import type { Axis, AxisMappingPoint } from "@shift/types";

interface MappingGraphProps {
  axis: Axis;
  points: readonly AxisMappingPoint[];
  onPointChange: (index: number, input: number, output: number) => void;
  onPointCommit: () => Promise<void>;
}

export const MappingGraph = ({ axis, points, onPointChange, onPointCommit }: MappingGraphProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  const didDragRef = useRef(false);
  const coordinates = points
    .map((point, index) => ({
      index,
      input: point.input.values[axis.id],
      output: point.output.values[axis.id],
    }))
    .filter(
      (point): point is { index: number; input: number; output: number } =>
        point.input !== undefined && point.output !== undefined,
    );

  const values = coordinates.flatMap((point) => [point.input, point.output]);
  const minimum = Math.min(axis.minimum ?? axis.default, ...values);
  const maximum = Math.max(axis.maximum ?? axis.default, ...values);
  const size = 220;
  const left = 36;
  const right = size - 16;
  const top = 16;
  const bottom = size - 26;
  const xScale = scaleLinear().domain([minimum, maximum]).range([left, right]).clamp(true);
  const yScale = scaleLinear().domain([minimum, maximum]).range([bottom, top]).clamp(true);
  const path = [...coordinates]
    .sort((leftPoint, rightPoint) => leftPoint.input - rightPoint.input)
    .map((point) => `${xScale(point.input)},${yScale(point.output)}`)
    .join(" ");
  const ticks = xScale.ticks(5);
  const dragContextRef = useRef({ xScale, yScale, onPointChange, onPointCommit });
  dragContextRef.current = { xScale, yScale, onPointChange, onPointCommit };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handles = select(svg).selectAll<SVGGElement, unknown>("[data-mapping-point-index]");
    const pointDrag = drag<SVGGElement, unknown>()
      .on("start", function () {
        didDragRef.current = false;
        setDraggingPointIndex(pointIndexFromHandle(this));
      })
      .on("drag", function (event: D3DragEvent<SVGGElement, unknown, unknown>) {
        const {
          xScale: currentXScale,
          yScale: currentYScale,
          onPointChange: changePoint,
        } = dragContextRef.current;
        didDragRef.current = true;
        changePoint(
          pointIndexFromHandle(this),
          normalizeCoordinate(currentXScale.invert(event.x)),
          normalizeCoordinate(currentYScale.invert(event.y)),
        );
      })
      .on("end", () => {
        setDraggingPointIndex(null);
        if (!didDragRef.current) return;

        didDragRef.current = false;
        void dragContextRef.current.onPointCommit().catch((cause: unknown) => {
          console.error("Failed to commit axis mapping drag", cause);
        });
      });

    handles.call(pointDrag);

    return () => {
      handles.on(".drag", null);
    };
  }, [coordinates.length]);

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm text-primary">Mapping Graph</figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${axis.name} external to source mapping`}
        className={`aspect-square w-full border border-line-subtle ${draggingPointIndex === null ? "" : "cursor-grabbing"}`}
      >
        {ticks.map((value) => (
          <g key={`input-${value}`}>
            <line
              x1={xScale(value)}
              y1={top}
              x2={xScale(value)}
              y2={bottom}
              className="stroke-line-subtle"
              strokeDasharray="2 3"
            />
            <text
              x={xScale(value)}
              y={size - 8}
              textAnchor={tickAnchor(value, ticks)}
              className="fill-secondary text-[9px]"
            >
              {formatCoordinate(value)}
            </text>
          </g>
        ))}
        {ticks.map((value) => (
          <g key={`output-${value}`}>
            <line
              x1={left}
              y1={yScale(value)}
              x2={right}
              y2={yScale(value)}
              className="stroke-line-subtle"
              strokeDasharray="2 3"
            />
            <text
              x={left - 6}
              y={yScale(value)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-secondary text-[9px]"
            >
              {formatCoordinate(value)}
            </text>
          </g>
        ))}
        <line
          x1={left}
          y1={bottom}
          x2={right}
          y2={top}
          className="stroke-line-subtle"
          strokeDasharray="4 4"
        />
        <line x1={left} y1={top} x2={left} y2={bottom} className="stroke-secondary" />
        <line x1={left} y1={bottom} x2={right} y2={bottom} className="stroke-secondary" />
        {path && <polyline points={path} fill="none" className="stroke-accent" strokeWidth={2} />}
        {coordinates.map((point) => (
          <g
            key={point.index}
            data-mapping-point-index={point.index}
            data-testid={`mapping-point-${point.index + 1}`}
            aria-hidden="true"
            className={
              draggingPointIndex === point.index
                ? "cursor-grabbing touch-none"
                : "cursor-grab touch-none"
            }
          >
            <circle cx={xScale(point.input)} cy={yScale(point.output)} r={10} fill="transparent" />
            <circle
              cx={xScale(point.input)}
              cy={yScale(point.output)}
              r={draggingPointIndex === point.index ? 4 : 3}
              className="pointer-events-none fill-white stroke-accent"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
    </figure>
  );
};

function pointIndexFromHandle(handle: SVGGElement): number {
  return Number(handle.dataset.mappingPointIndex);
}

function normalizeCoordinate(value: number): number {
  return Number(value.toPrecision(12));
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function tickAnchor(value: number, ticks: readonly number[]): "start" | "middle" | "end" {
  if (value === ticks[0]) return "start";
  if (value === ticks.at(-1)) return "end";
  return "middle";
}
