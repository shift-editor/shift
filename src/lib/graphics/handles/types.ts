export enum HandleType {
  Corner,
  Control,
  Direction,
}

export interface HandleStyle {
  size: number;
  fillColor: number[];
  strokeColor: number[];
  strokeWidth: number;
  selected?: boolean;
  hovered?: boolean;
}

// default style
const DEFAULT_HANDLE_STYLE = {
  corner: {},
};
