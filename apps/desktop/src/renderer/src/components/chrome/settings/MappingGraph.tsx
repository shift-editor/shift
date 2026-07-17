import type { Axis, AxisMappingPoint } from "@shift/types";

interface MappingGraphProps {
  axis: Axis;
  points: readonly AxisMappingPoint[];
}

export const MappingGraph = ({ axis, points }: MappingGraphProps) => {
  const coordinates = points
    .map((point) => ({
      input: point.input.values[axis.id],
      output: point.output.values[axis.id],
    }))
    .filter(
      (point): point is { input: number; output: number } =>
        point.input !== undefined && point.output !== undefined,
    )
    .sort((left, right) => left.input - right.input);

  const values = coordinates.flatMap((point) => [point.input, point.output]);
  const minimum = Math.min(axis.minimum ?? axis.default, ...values);
  const maximum = Math.max(axis.maximum ?? axis.default, ...values);
  const span = maximum === minimum ? 1 : maximum - minimum;
  const size = 220;
  const left = 36;
  const right = size - 16;
  const top = 16;
  const bottom = size - 26;

  const x = (value: number) => left + ((value - minimum) / span) * (right - left);
  const y = (value: number) => bottom - ((value - minimum) / span) * (bottom - top);

  const path = coordinates.map((point) => `${x(point.input)},${y(point.output)}`).join(" ");
  const inputLabels = [
    ...new Set([minimum, ...coordinates.map((point) => point.input), maximum]),
  ].sort((leftValue, rightValue) => leftValue - rightValue);
  const outputLabels = [
    ...new Set([minimum, ...coordinates.map((point) => point.output), maximum]),
  ].sort((leftValue, rightValue) => leftValue - rightValue);

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm text-primary">Mapping Graph</figcaption>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${axis.name} external to source mapping`}
        className="aspect-square w-full border border-line-subtle"
      >
        {inputLabels.map((value) => (
          <g key={`input-${value}`}>
            <line
              x1={x(value)}
              y1={top}
              x2={x(value)}
              y2={bottom}
              className=""
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
        {outputLabels.map((value) => (
          <g key={`output-${value}`}>
            <line
              x1={left}
              y1={y(value)}
              x2={right}
              y2={y(value)}
              className="stroke-gray"
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
          <circle
            key={`${point.input}:${point.output}`}
            cx={x(point.input)}
            cy={y(point.output)}
            r={3}
            className="fill-white stroke-accent"
            strokeWidth={2}
          />
        ))}
      </svg>
    </figure>
  );
};

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function tickAnchor(value: number, minimum: number, maximum: number): "start" | "middle" | "end" {
  if (value === minimum) return "start";
  if (value === maximum) return "end";
  return "middle";
}
