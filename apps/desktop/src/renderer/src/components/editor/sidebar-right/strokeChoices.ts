import type { StrokeCap, StrokeJoin } from "@shift/types";
import CapButtIcon from "@/assets/sidebar-right/cap-butt.svg";
import CapRoundIcon from "@/assets/sidebar-right/cap-round.svg";
import CapSquareIcon from "@/assets/sidebar-right/cap-square.svg";
import JoinBevelIcon from "@/assets/sidebar-right/join-bevel.svg";
import JoinMiterIcon from "@/assets/sidebar-right/join-miter.svg";
import JoinRoundIcon from "@/assets/sidebar-right/join-round.svg";

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

/** The joins a stroke or an offset can use, each with the label and icon of its button. */
export const JOINS: readonly { join: StrokeJoin; label: string; Icon: IconComponent }[] = [
  { join: "bevel", label: "Bevel join", Icon: JoinBevelIcon },
  { join: "miter", label: "Miter join", Icon: JoinMiterIcon },
  { join: "round", label: "Round join", Icon: JoinRoundIcon },
];

/** The caps a stroke's open ends can have, each with the label and icon of its button. */
export const CAPS: readonly { cap: StrokeCap; label: string; Icon: IconComponent }[] = [
  { cap: "butt", label: "Butt cap", Icon: CapButtIcon },
  { cap: "square", label: "Square cap", Icon: CapSquareIcon },
  { cap: "round", label: "Round cap", Icon: CapRoundIcon },
];
