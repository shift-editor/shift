import GridSvg from '@/assets/toolbar/grid.svg';
import InfoSvg from '@/assets/toolbar/info.svg';
import { Svg } from '@/types/common';
import { Editor } from '@/views/Editor';
import { FontInfo } from '@/views/FontInfo';
import { Home } from '@/views/Home';

interface Route {
  id: string;
  path: string;
  component: React.ComponentType;
  description: string;
  icon?: Svg;
}

export const routes: Route[] = [
  {
    id: 'home',
    path: '/',
    icon: GridSvg,
    component: Home,
    description: 'Display all glyphs',
  },
  {
    id: 'info',
    path: '/info',
    icon: InfoSvg,
    component: FontInfo,
    description: 'Display and edit font information, such as family name, weight, style, etc.',
  },
  {
    id: 'editor',
    path: '/editor/:glyphId',
    component: Editor,
    description: 'Display and edit a glyph',
  },
];
