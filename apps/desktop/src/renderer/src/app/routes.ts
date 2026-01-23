import GridSvg from "@assets/toolbar/grid.svg";
import InfoSvg from "@assets/toolbar/info.svg";
import type { Svg } from "@/types/common";
import { Landing } from "@/views/Landing";
import { Home } from "@/views/Home";
import { FontInfo } from "@/views/FontInfo";
import { Editor } from "@/views/Editor";

interface Route {
  id: string;
  path: string;
  component: React.ComponentType;
  description: string;
  icon?: Svg;
}

export const routes: Route[] = [
  {
    id: "landing",
    path: "/",
    component: Landing,
    description: "Landing page with load/new font options",
  },
  {
    id: "home",
    path: "/home",
    icon: GridSvg,
    component: Home,
    description: "Display all glyphs",
  },
  {
    id: "info",
    path: "/info",
    icon: InfoSvg,
    component: FontInfo,
    description:
      "Display and edit font information, such as family name, weight, style, etc.",
  },
  {
    id: "editor",
    path: "/editor/:glyphId",
    component: Editor,
    description: "Display and edit a glyph",
  },
];
