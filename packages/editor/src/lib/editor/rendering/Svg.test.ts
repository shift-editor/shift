import { describe, expect, it } from "vitest";
import { Svg } from "./Svg";

describe("Svg", () => {
  it("escapes attribute values and text", () => {
    const markup = String(
      Svg.element("text", { "data-label": `a"b'<c>&` }, [Svg.text(`</text><script>&`)]),
    );

    expect(markup).toBe(
      '<text data-label="a&quot;b&apos;&lt;c&gt;&amp;">&lt;/text&gt;&lt;script&gt;&amp;</text>',
    );
  });

  it("formats numbers deterministically", () => {
    expect([0.123456, -0.00001, 1e-12, 1200, -3.5].map(Svg.number)).toEqual([
      "0.1235",
      "0",
      "0",
      "1200",
      "-3.5",
    ]);
    expect(() => Svg.number(Number.NaN)).toThrow("SVG numbers must be finite");
  });

  it("serializes attributes in order and omits absent ones", () => {
    const markup = String(
      Svg.element("rect", { x: 1.00004, y: -0, hidden: false, title: null, fill: "none" }),
    );

    expect(markup).toBe('<rect x="1" y="0" fill="none"/>');
  });

  it("nests groups and drops absent children", () => {
    const markup = String(
      Svg.document([0, -10, 20.5, 30], { "data-shift-role": "layer" }, [
        Svg.group({ "data-shift-role": "empty" }, [null, false]),
        Svg.group({}, [Svg.element("path", { d: "M 0 0 Z" }), undefined]),
      ]),
    );

    expect(markup).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -10 20.5 30" data-shift-role="layer"><g data-shift-role="empty"/><g><path d="M 0 0 Z"/></g></svg>',
    );
  });

  it("rejects names that would break markup", () => {
    expect(() => Svg.element("g onload=x")).toThrow("Invalid SVG name");
    expect(() => Svg.element("g", { "x onload": "1" })).toThrow("Invalid SVG name");
  });
});
