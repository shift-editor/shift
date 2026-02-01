import GridSvg from "@assets/toolbar/grid.svg";
import InfoSvg from "@assets/toolbar/info.svg";
import type { Svg } from "@/types/common";

export interface NavRoute {
  id: string;
  path: string;
  description: string;
  icon?: Svg;
}

export const routes: NavRoute[] = [
  {
    id: "home",
    path: "/home",
    icon: GridSvg,
    description: "Display all glyphs",
  },
  {
    id: "info",
    path: "/info",
    icon: InfoSvg,
    description: "Display and edit font information, such as family name, weight, style, etc.",
  },
];
