export type Result<T, E> = { success: true; data: T } | { success: false; error: E };

export type SVG = React.FC<React.SVGProps<SVGSVGElement>>;
