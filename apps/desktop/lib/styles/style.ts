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
  strokeStyle: '#0039a6',
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
  first: {
    idle: {
      size: 3,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: '#b933ad',
      dashPattern: [],
    },
    hovered: {
      size: 3.5,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: '#b933ad',
      dashPattern: [],
    },
    selected: {
      size: 5,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: '#b933ad',
      dashPattern: [],
    },
  },
  corner: {
    idle: {
      size: 6,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: 'transparent',
      dashPattern: [],
    },
    hovered: {
      size: 8,
      lineWidth: 1,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: 'transparent',
      dashPattern: [],
    },
    selected: {
      size: 12,
      lineWidth: 1,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: '#b933ad',
      dashPattern: [],
    },
  },
  control: {
    idle: {
      size: 3,
      lineWidth: 2,
      antiAlias: false,
      strokeStyle: '#ff6319',
      fillStyle: '#ff6319',
      dashPattern: [],
    },
    hovered: {
      size: 3.5,
      lineWidth: 2,
      strokeStyle: '#ff6319',
      fillStyle: '#ff6319',
      antiAlias: true,
      dashPattern: [],
    },
    selected: {
      size: 5,
      lineWidth: 1,
      strokeStyle: '#ff6319',
      fillStyle: '#ff6319',
      antiAlias: true,
      dashPattern: [],
    },
  },
  smooth: {
    idle: {
      size: 3,
      lineWidth: 2,
      antiAlias: false,
      strokeStyle: 'green',
      fillStyle: 'green',
      dashPattern: [],
    },
    hovered: {
      size: 3.5,
      lineWidth: 2,
      antiAlias: false,
      strokeStyle: 'green',
      fillStyle: 'green',
      dashPattern: [],
    },
    selected: {
      size: 5,
      lineWidth: 2,
      antiAlias: false,
      strokeStyle: 'green',
      fillStyle: 'green',
      dashPattern: [],
    },
  },
  direction: {
    idle: {
      size: 7,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#0039a6',
      fillStyle: 'black',
      dashPattern: [],
    },
    hovered: {
      size: 8,
      lineWidth: 1,
      strokeStyle: '#0039a6',
      fillStyle: '#0039a6',
      dashPattern: [],
    },
    selected: {
      size: 9,
      lineWidth: 1,
      strokeStyle: '#0039a6',
      fillStyle: '#0039a6',
      dashPattern: [],
    },
  },
  last: {
    idle: {
      size: 6,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: '#b933ad',
      dashPattern: [],
    },
    hovered: {
      size: 8,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: '#b933ad',
      dashPattern: [],
    },
    selected: {
      size: 8,
      lineWidth: 0.75,
      antiAlias: false,
      strokeStyle: '#b933ad',
      fillStyle: '#b933ad',
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
