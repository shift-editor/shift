import GridSvg from "@assets/toolbar/grid.svg";
import InfoSvg from "@assets/toolbar/info.svg";
import type { SVG } from "@/types/common";

type NavItemBase = {
  id: string;
  description: string;
  icon?: SVG;
};

export type NavRoute = NavItemBase &
  ({ kind: "route"; path: string } | { kind: "dialog"; dialogId: "settings" });

export const routes: NavRoute[] = [
  {
    id: "home",
    kind: "route",
    path: "/home",
    icon: GridSvg,
    description: "Font overview",
  },
  {
    id: "info",
    kind: "dialog",
    dialogId: "settings",
    icon: InfoSvg,
    description: "Settings",
  },
];
