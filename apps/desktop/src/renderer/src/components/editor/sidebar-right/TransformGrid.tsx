import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";

export type AnchorPosition = "tl" | "tm" | "tr" | "lm" | "m" | "rm" | "bl" | "bm" | "br";

export interface TransformGridProps {
  width?: number;
  height?: number;
  activeAnchor: AnchorPosition;
  onChange?: (anchor: AnchorPosition) => void;
}

const anchorPositions: {
  id: AnchorPosition;
  label: string;
  cx: number;
  cy: number;
}[] = [
  { id: "tl", label: "Anchor top left", cx: 4, cy: 4 },
  { id: "tm", label: "Anchor top", cx: 31, cy: 4 },
  { id: "tr", label: "Anchor top right", cx: 58, cy: 4 },
  { id: "lm", label: "Anchor left", cx: 4, cy: 27 },
  { id: "m", label: "Anchor center", cx: 32, cy: 27 },
  { id: "rm", label: "Anchor right", cx: 58, cy: 27 },
  { id: "bl", label: "Anchor bottom left", cx: 4, cy: 48 },
  { id: "bm", label: "Anchor bottom", cx: 31, cy: 48 },
  { id: "br", label: "Anchor bottom right", cx: 58, cy: 48 },
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
      {anchorPositions.map(({ id, label, cx, cy }) => (
        <Tooltip key={id}>
          <TooltipTrigger>
            <circle
              role="button"
              aria-label={label}
              cx={cx}
              cy={cy}
              r="4"
              className={cn(
                "transition-colors",
                activeAnchor === id ? "fill-accent" : "fill-[#c2c2c2]",
                onChange && activeAnchor !== id && "hover:fill-accent/70",
              )}
              style={{ cursor: onChange ? "pointer" : "default" }}
              onClick={() => {
                if (onChange) onChange(id);
              }}
            />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </svg>
  );
};
