export type AnchorPosition =
  | "tl"
  | "tm"
  | "tr"
  | "lm"
  | "m"
  | "rm"
  | "bl"
  | "bm"
  | "br";

export interface TransformGridProps {
  width?: number;
  height?: number;
  activeAnchor: AnchorPosition;
  onChange?: (anchor: AnchorPosition) => void;
}

const INACTIVE_COLOR = "#C2C2C2";
const ACTIVE_COLOR = "#0C92F4";

const anchorPositions: { id: AnchorPosition; cx: number; cy: number }[] = [
  { id: "tl", cx: 3.5, cy: 3.5 },
  { id: "tm", cx: 20.5, cy: 3.5 },
  { id: "tr", cx: 38.5, cy: 3.5 },
  { id: "lm", cx: 3.5, cy: 21.5 },
  { id: "m", cx: 21.5, cy: 21.5 },
  { id: "rm", cx: 38.5, cy: 21.5 },
  { id: "bl", cx: 3.5, cy: 38.5 },
  { id: "bm", cx: 20.5, cy: 38.5 },
  { id: "br", cx: 38.5, cy: 38.5 },
];

export const TransformGrid = ({
  width = 42,
  height = 42,
  activeAnchor,
  onChange,
}: TransformGridProps) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 42 42"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="3.75"
        y="3.75"
        width="34.5"
        height="34.5"
        stroke="#D6D6D6"
        strokeWidth="1.5"
      />
      {anchorPositions.map(({ id, cx, cy }) => (
        <circle
          key={id}
          cx={cx}
          cy={cy}
          r="2.5"
          fill={activeAnchor === id ? ACTIVE_COLOR : INACTIVE_COLOR}
          style={{ cursor: onChange ? "pointer" : "default" }}
          onClick={() => onChange?.(id)}
        />
      ))}
    </svg>
  );
};
