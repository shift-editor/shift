export type AnchorPosition = "tl" | "tm" | "tr" | "lm" | "m" | "rm" | "bl" | "bm" | "br";

export interface TransformGridProps {
  width?: number;
  height?: number;
  activeAnchor: AnchorPosition;
  onChange?: (anchor: AnchorPosition) => void;
}

const INACTIVE_COLOR = "#C2C2C2";
const ACTIVE_COLOR = "#0C92F4";

const anchorPositions: { id: AnchorPosition; cx: number; cy: number }[] = [
  { id: "tl", cx: 4, cy: 4 },
  { id: "tm", cx: 31, cy: 4 },
  { id: "tr", cx: 58, cy: 4 },
  { id: "lm", cx: 4, cy: 27 },
  { id: "m", cx: 32, cy: 27 },
  { id: "rm", cx: 58, cy: 27 },
  { id: "bl", cx: 4, cy: 48 },
  { id: "bm", cx: 31, cy: 48 },
  { id: "br", cx: 58, cy: 48 },
];

export const TransformGrid = ({
  width = 62,
  height = 52,
  activeAnchor,
  onChange,
}: TransformGridProps) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 62 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="4" width="54" height="44" stroke="#C2C2C2" strokeWidth="2" />
      {anchorPositions.map(({ id, cx, cy }) => (
        <circle
          key={id}
          cx={cx}
          cy={cy}
          r="4"
          fill={activeAnchor === id ? ACTIVE_COLOR : INACTIVE_COLOR}
          style={{ cursor: onChange ? "pointer" : "default" }}
          onClick={() => onChange?.(id)}
        />
      ))}
    </svg>
  );
};
