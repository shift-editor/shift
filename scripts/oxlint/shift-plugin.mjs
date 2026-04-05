/**
 * Custom oxlint plugin for Shift Editor.
 *
 * Enforces architecture rules that can't be expressed with built-in oxlint
 * rules or no-restricted-syntax selectors.
 *
 * Registered via jsPlugins in apps/desktop/.oxlintrc.json.
 */

/** Files where direct .contours access is expected (structural traversal). */
const CONTOURS_ALLOWED = [
  "engine/draft.ts",
  "engine/mock.ts",
  "engine/FontEngine.ts",
  "packages/font/",
  "rendering/",          // render passes iterate contours to draw them
  "SelectionBounds.ts",  // segment-aware bounds needs contour structure
  "compositeHitTest.ts", // component contour bounds check
  "Editor.ts",           // coordinator-level structural traversal
  "clipboard/",          // ClipboardContent is not a Glyph, different type
  "SelectContourOnDoubleClickBehavior.ts", // finds contour by segment match
];

function isAllowedFile(filename, allowList) {
  // oxlint may pass relative or absolute paths
  const normalized = filename.replace(/\\/g, "/");
  return allowList.some((pattern) => normalized.includes(pattern));
}

export default {
  meta: { name: "shift" },
  rules: {
    /**
     * Ban direct .contours iteration in app code.
     *
     * Use Glyphs.findPoints / Glyphs.points from @shift/font instead
     * of raw `for (const contour of glyph.contours)` loops.
     */
    "no-raw-contour-access": {
      meta: {
        type: "suggestion",
        messages: {
          noRawContours:
            "Do not iterate .contours directly. Use Glyphs.findPoints / Glyphs.points from @shift/font.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (isAllowedFile(filename, CONTOURS_ALLOWED)) return {};
        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        return {
          // Catch: for (const x of y.contours)
          'ForOfStatement > MemberExpression[property.name="contours"]'(node) {
            context.report({ node, messageId: "noRawContours" });
          },
          // Catch: y.contours.map / .filter / .find / .flatMap / .some / .every / .reduce / .forEach
          'CallExpression > MemberExpression > MemberExpression[property.name="contours"]'(node) {
            context.report({ node, messageId: "noRawContours" });
          },
        };
      },
    },

    /**
     * Ban inline coordinate math — use Vec2 from @shift/geo.
     *
     * Catches patterns like: { x: a.x - b.x, y: a.y - b.y }
     * These should use Vec2.sub(a, b) instead.
     */
    "no-inline-coordinate-math": {
      meta: {
        type: "suggestion",
        messages: {
          useVec2:
            "Use Vec2.sub / Vec2.add / Vec2.scale from @shift/geo instead of inline coordinate math.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        return {
          /**
           * Match object expressions with both x and y properties where
           * both values are binary expressions (+, -, *) on member access.
           *
           * Catches: { x: a.x - b.x, y: a.y - b.y }
           * Ignores: { x: 100, y: 200 } (literal values)
           * Ignores: { x: a.x, y: a.y } (no arithmetic)
           */
          ObjectExpression(node) {
            const props = node.properties.filter((p) => p.type === "Property");

            const xProp = props.find(
              (p) => p.key && p.key.type === "Identifier" && p.key.name === "x",
            );
            const yProp = props.find(
              (p) => p.key && p.key.type === "Identifier" && p.key.name === "y",
            );

            if (!xProp || !yProp) return;
            if (props.length > 2) return; // Skip objects with more than x,y (not a point)

            const xVal = xProp.value;
            const yVal = yProp.value;

            // Both must be binary expressions (arithmetic on coordinates)
            if (xVal.type !== "BinaryExpression" || yVal.type !== "BinaryExpression") return;

            // Both must involve member access (a.x, b.x, etc.)
            const hasMemberX =
              (xVal.left && xVal.left.type === "MemberExpression") ||
              (xVal.right && xVal.right.type === "MemberExpression");
            const hasMemberY =
              (yVal.left && yVal.left.type === "MemberExpression") ||
              (yVal.right && yVal.right.type === "MemberExpression");

            if (!hasMemberX || !hasMemberY) return;

            // Only flag +, -, * (not / or %)
            const mathOps = ["+", "-", "*"];
            if (!mathOps.includes(xVal.operator) || !mathOps.includes(yVal.operator)) return;

            context.report({ node, messageId: "useVec2" });
          },
        };
      },
    },
  },
};
