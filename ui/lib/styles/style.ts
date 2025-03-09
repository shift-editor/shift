import { HandleType } from '@/types/handle';

export interface DrawStyle {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias?: boolean;
  dashPattern: number[];
}

export const GUIDE_STYLES: DrawStyle = {
  lineWidth: 0.5,
  strokeStyle: 'rgb(76, 96, 230)',
  fillStyle: 'black',
  antiAlias: false,
  dashPattern: [],
};

export const DEFAULT_STYLES: DrawStyle = {
  lineWidth: 0.75,
  strokeStyle: 'black',
  fillStyle: 'white',
  antiAlias: false,
  dashPattern: [],
};

export interface HandleDimensions {
  size: number;
}

type HandleStyle = DrawStyle & HandleDimensions;

export interface HandleStyles {
  idle: HandleStyle;
  hovered: HandleStyle;
  selected: HandleStyle;
}

export const HANDLE_STYLES: Record<HandleType, HandleStyles> = {
  corner: {
    idle: {
      size: 6,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: 'rgb(76, 96, 230)',
      fillStyle: 'transparent',
      dashPattern: [],
    },
    hovered: {
      size: 8,
      lineWidth: 1,
      antiAlias: false,
      strokeStyle: 'rgb(76, 96, 230)',
      fillStyle: 'transparent',
      dashPattern: [],
    },
    selected: {
      size: 12,
      lineWidth: 1,
      antiAlias: false,
      strokeStyle: 'rgb(76, 96, 230)',
      fillStyle: 'rgb(76, 96, 230)',
      dashPattern: [],
    },
  },
  smooth: {
    idle: {
      size: 2.5,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: 'black',
      fillStyle: 'white',
      dashPattern: [],
    },
    hovered: {
      size: 2.5,
      lineWidth: 2,
      antiAlias: false,
      strokeStyle: 'green',
      fillStyle: 'white',
      dashPattern: [],
    },
    selected: {
      size: 2.5,
      lineWidth: 2,
      antiAlias: false,
      strokeStyle: 'green',
      fillStyle: 'white',
      dashPattern: [],
    },
  },
  control: {
    idle: {
      size: 3,
      lineWidth: 2,
      antiAlias: false,
      strokeStyle: 'black',
      fillStyle: 'red',
      dashPattern: [],
    },
    hovered: {
      size: 3.5,
      lineWidth: 2,
      strokeStyle: 'red',
      fillStyle: 'red',
      antiAlias: true,
      dashPattern: [],
    },
    selected: {
      size: 5,
      lineWidth: 1,
      strokeStyle: 'red',
      fillStyle: 'red',
      antiAlias: true,
      dashPattern: [],
    },
  },
  direction: {
    idle: {
      size: 8,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#E066A6',
      fillStyle: 'white',
      dashPattern: [],
    },
    hovered: {
      size: 9,
      lineWidth: 1,
      strokeStyle: '#E066A6',
      fillStyle: '#E066A6',
      dashPattern: [],
    },
    selected: {
      size: 10,
      lineWidth: 1,
      strokeStyle: '#E066A6',
      fillStyle: '#E066A6',
      dashPattern: [],
    },
  },
};

export const SELECTION_RECTANGLE_STYLES: DrawStyle = {
  lineWidth: 1,
  strokeStyle: '#0c8ce9',
  fillStyle: 'rgba(59, 130, 246, 0.04)',
  antiAlias: false,
  dashPattern: [],
};

export const BOUNDING_RECTANGLE_STYLES: DrawStyle = {
  lineWidth: 0.5,
  strokeStyle: '#353535',
  fillStyle: 'transparent',
  antiAlias: false,
  dashPattern: [5, 5],
};
