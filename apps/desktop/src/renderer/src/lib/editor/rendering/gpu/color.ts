export type GpuColor = [number, number, number, number];

export const TRANSPARENT: GpuColor = [0, 0, 0, 0];

export function parseCssColor(input?: string): GpuColor {
  if (!input) return TRANSPARENT;
  const color = input.trim().toLowerCase();

  if (color === "transparent") return TRANSPARENT;
  if (color === "white") return [1, 1, 1, 1];
  if (color === "black") return [0, 0, 0, 1];

  if (color.startsWith("#")) return parseHex(color);
  if (color.startsWith("rgba(") || color.startsWith("rgb(")) return parseRgb(color);

  return TRANSPARENT;
}

function parseHex(hex: string): GpuColor {
  const v = hex.slice(1);

  if (v.length === 3 || v.length === 4) {
    const [r, g, b, a = "f"] = v.split("");
    return [
      parseInt(`${r}${r}`, 16) / 255,
      parseInt(`${g}${g}`, 16) / 255,
      parseInt(`${b}${b}`, 16) / 255,
      parseInt(`${a}${a}`, 16) / 255,
    ];
  }

  if (v.length === 6 || v.length === 8) {
    const alpha = v.length === 8 ? v.slice(6, 8) : "ff";
    return [
      parseInt(v.slice(0, 2), 16) / 255,
      parseInt(v.slice(2, 4), 16) / 255,
      parseInt(v.slice(4, 6), 16) / 255,
      parseInt(alpha, 16) / 255,
    ];
  }

  return TRANSPARENT;
}

function parseRgb(input: string): GpuColor {
  const values = input.slice(input.indexOf("(") + 1, input.lastIndexOf(")")).split(",").map((s) => s.trim());
  const [r = "0", g = "0", b = "0", a = "1"] = values;
  return [
    clamp(parseFloat(r) / 255),
    clamp(parseFloat(g) / 255),
    clamp(parseFloat(b) / 255),
    clamp(parseFloat(a)),
  ];
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
