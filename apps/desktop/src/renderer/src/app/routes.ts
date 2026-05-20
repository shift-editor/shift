import GridSvg from "@assets/toolbar/grid.svg";
import InfoSvg from "@assets/toolbar/info.svg";
import type { SVG } from "@/types/common";

type NavItemBase = {
  id: string;
  description: string;
  icon?: SVG;
};

export type NavRoute = NavItemBase &
  ({ kind: "route"; path: string } | { kind: "dialog"; dialogId: "font-info" });

export const routes: NavRoute[] = [
  {
    id: "home",
    kind: "route",
    path: "/home",
    icon: GridSvg,
    description: "Display all glyphs",
  },
  {
    id: "info",
    kind: "dialog",
    dialogId: "font-info",
    icon: InfoSvg,
    description: "Display and edit font information, such as family name, weight, style, etc.",
  },
];
