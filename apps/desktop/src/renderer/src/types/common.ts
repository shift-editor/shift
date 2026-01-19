export type Result<T, E> =
  | { success: true; data: T }
  | { success: false; error: E };

export type Svg = React.FC<React.SVGProps<SVGSVGElement>>;
