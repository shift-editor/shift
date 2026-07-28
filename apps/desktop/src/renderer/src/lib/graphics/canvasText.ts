/** Fits one canvas label by replacing its tail with an ellipsis. */
export function fitCanvasText(
  context: CanvasRenderingContext2D,
  label: string,
  maximumWidth: number,
): string {
  if (maximumWidth <= 0) return "";
  if (context.measureText(label).width <= maximumWidth) return label;

  const ellipsis = "…";
  let start = 0;
  let end = label.length;
  while (start < end) {
    const middle = Math.ceil((start + end) / 2);
    const candidate = `${label.slice(0, middle)}${ellipsis}`;
    if (context.measureText(candidate).width <= maximumWidth) {
      start = middle;
    } else {
      end = middle - 1;
    }
  }

  return start > 0 ? `${label.slice(0, start)}${ellipsis}` : ellipsis;
}
