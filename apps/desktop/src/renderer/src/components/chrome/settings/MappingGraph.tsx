import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Axis, AxisMappingPoint } from "@shift/types";

interface MappingGraphProps {
  axis: Axis;
  points: readonly AxisMappingPoint[];
  onPointChange: (index: number, input: number, output: number) => void;
  onPointCommit: () => Promise<void>;
}

export const MappingGraph = ({ axis, points, onPointChange, onPointCommit }: MappingGraphProps) => {
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
    )
    .sort((left, right) => left.input - right.input);

  const values = coordinates.flatMap((point) => [point.input, point.output]);
  const minimum = Math.min(axis.minimum ?? axis.default, ...values);
  const maximum = Math.max(axis.maximum ?? axis.default, ...values);
  const domainSpan = maximum - minimum;
  const span = domainSpan === 0 ? 1 : domainSpan;
  const size = 220;
  const left = 36;
  const right = size - 16;
  const top = 16;
  const bottom = size - 26;

  const x = (value: number) => left + ((value - minimum) / span) * (right - left);
  const y = (value: number) => bottom - ((value - minimum) / span) * (bottom - top);
  const path = coordinates.map((point) => `${x(point.input)},${y(point.output)}`).join(" ");
  const ticks = graphTicks(minimum, maximum);

  const updatePointFromPointer = (pointIndex: number, event: ReactPointerEvent<SVGGElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;

    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;

    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    const graphX = ((event.clientX - bounds.left) / bounds.width) * size;
    const graphY = ((event.clientY - bounds.top) / bounds.height) * size;
    const input = graphValue(graphX, left, right, minimum, domainSpan);
    const output = graphValue(bottom - graphY + top, top, bottom, minimum, domainSpan);

    didDragRef.current = true;
    onPointChange(pointIndex, input, output);
  };

  const finishDrag = async (event: ReactPointerEvent<SVGGElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingPointIndex(null);

    const shouldCommit = didDragRef.current;
    didDragRef.current = false;
    if (shouldCommit) await onPointCommit();
  };

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm text-primary">Mapping Graph</figcaption>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${axis.name} external to source mapping`}
        className="aspect-square w-full border border-line-subtle"
      >
        {ticks.map((value) => (
          <g key={`input-${value}`}>
            <line
              x1={x(value)}
              y1={top}
              x2={x(value)}
              y2={bottom}
              className="stroke-line-subtle"
              strokeDasharray="2 3"
            />
            <text
              x={x(value)}
              y={size - 8}
              textAnchor={tickAnchor(value, minimum, maximum)}
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
              y1={y(value)}
              x2={right}
              y2={y(value)}
              className="stroke-line-subtle"
              strokeDasharray="2 3"
            />
            <text
              x={left - 6}
              y={y(value)}
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
            data-testid={`mapping-point-${point.index + 1}`}
            aria-hidden="true"
            className="cursor-grab touch-none"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;

              event.preventDefault();
              didDragRef.current = false;
              setDraggingPointIndex(point.index);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => updatePointFromPointer(point.index, event)}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onLostPointerCapture={() => setDraggingPointIndex(null)}
          >
            <circle cx={x(point.input)} cy={y(point.output)} r={10} fill="transparent" />
            <circle
              cx={x(point.input)}
              cy={y(point.output)}
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

function graphTicks(minimum: number, maximum: number): number[] {
  if (minimum === maximum) return [minimum];

  const maximumTickCount = 5;
  const step = niceStep((maximum - minimum) / (maximumTickCount - 1));
  const ticks = [minimum];
  let value = Math.ceil(minimum / step) * step;

  while (value < maximum) {
    if (value > minimum) ticks.push(Number(value.toPrecision(12)));
    value += step;
  }

  ticks.push(maximum);
  return [...new Set(ticks)];
}

function niceStep(minimumStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(minimumStep));
  const normalized = minimumStep / magnitude;
  const multiplier = [1, 2, 2.5, 5, 10].find((candidate) => candidate >= normalized) ?? 10;
  return multiplier * magnitude;
}

function graphValue(
  position: number,
  start: number,
  end: number,
  minimum: number,
  domainSpan: number,
): number {
  if (domainSpan === 0) return minimum;

  const progress = Math.min(1, Math.max(0, (position - start) / (end - start)));
  return Number((minimum + progress * domainSpan).toPrecision(12));
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function tickAnchor(value: number, minimum: number, maximum: number): "start" | "middle" | "end" {
  if (value === minimum) return "start";
  if (value === maximum) return "end";
  return "middle";
}
