/** Attribute value; `null`, `undefined`, and `false` omit the attribute. */
export type SvgAttributeValue = string | number | null | undefined | false;

export type SvgAttributes = Readonly<Record<string, SvgAttributeValue>>;

/** Child content; `null`, `undefined`, and `false` render nothing. */
export type SvgChild = Svg | null | undefined | false;

const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/**
 * Immutable, serialized SVG markup built from escaped elements and text.
 *
 * @remarks
 * Owns escaping, deterministic number formatting, and serialization only. It
 * knows nothing about fonts or geometry, so callers pass already-resolved
 * values. Numbers round to four decimals and never print `-0`.
 */
export class Svg {
  readonly #markup: string;

  private constructor(markup: string) {
    this.#markup = markup;
  }

  /**
   * Creates one element; it self-closes when no child renders.
   *
   * @throws {Error} when the element or an attribute name is not a valid XML name.
   */
  static element(
    name: string,
    attributes: SvgAttributes = {},
    children: readonly SvgChild[] = [],
  ): Svg {
    assertName(name);
    const content = children
      .filter((child): child is Svg => child instanceof Svg)
      .map(String)
      .join("");
    const open = `<${name}${serializeAttributes(attributes)}`;
    return new Svg(content ? `${open}>${content}</${name}>` : `${open}/>`);
  }

  /** Creates a `<g>` element. */
  static group(attributes: SvgAttributes, children: readonly SvgChild[]): Svg {
    return Svg.element("g", attributes, children);
  }

  /** Creates an escaped text node. */
  static text(value: string): Svg {
    return new Svg(Svg.escape(value));
  }

  /** Creates a root `<svg>` element in the SVG namespace. */
  static document(
    viewBox: readonly [number, number, number, number],
    attributes: SvgAttributes,
    children: readonly SvgChild[],
  ): Svg {
    return Svg.element(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: viewBox.map(Svg.number).join(" "),
        ...attributes,
      },
      children,
    );
  }

  /** Formats a number deterministically: four decimals at most, no `-0`. */
  static number(value: number): string {
    if (!Number.isFinite(value)) throw new Error(`SVG numbers must be finite, got ${value}`);

    const rounded = Math.round(value * 10_000) / 10_000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }

  /** Escapes text for use in XML attribute values and character data. */
  static escape(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  toString(): string {
    return this.#markup;
  }
}

function serializeAttributes(attributes: SvgAttributes): string {
  let serialized = "";
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;

    assertName(name);
    const text = typeof value === "number" ? Svg.number(value) : Svg.escape(value);
    serialized += ` ${name}="${text}"`;
  }
  return serialized;
}

function assertName(name: string): void {
  if (!NAME.test(name)) throw new Error(`Invalid SVG name: ${name}`);
}
