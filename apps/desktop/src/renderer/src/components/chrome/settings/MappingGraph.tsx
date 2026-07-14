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
  const padding = 24;
  const size = 220;
  const plotSize = size - padding * 2;
  const x = (value: number) => padding + ((value - minimum) / span) * plotSize;
  const y = (value: number) => size - padding - ((value - minimum) / span) * plotSize;
  const path = coordinates.map((point) => `${x(point.input)},${y(point.output)}`).join(" ");

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs text-primary">Mapping Graph</figcaption>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${axis.name} external to source mapping`}
        className="aspect-square w-full border border-line-subtle bg-white"
      >
        <line
          x1={padding}
          y1={size - padding}
          x2={size - padding}
          y2={padding}
          className="stroke-line-subtle"
          strokeDasharray="4 4"
        />
        <line
          x1={padding}
          y1={padding}
          x2={padding}
          y2={size - padding}
          className="stroke-secondary"
        />
        <line
          x1={padding}
          y1={size - padding}
          x2={size - padding}
          y2={size - padding}
          className="stroke-secondary"
        />
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
        <text x={padding} y={size - 7} className="fill-secondary text-[9px]">
          {formatCoordinate(minimum)}
        </text>
        <text
          x={size - padding}
          y={size - 7}
          textAnchor="end"
          className="fill-secondary text-[9px]"
        >
          {formatCoordinate(maximum)}
        </text>
      </svg>
    </figure>
  );
};

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}
