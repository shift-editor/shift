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
  "engine/FontEngine.ts",
  "packages/font/",
  "rendering/", // render passes iterate contours to draw them
  "SelectionBounds.ts", // segment-aware bounds needs contour structure
  "compositeHitTest.ts", // component contour bounds check
  "Editor.ts", // coordinator-level structural traversal
  "clipboard/", // ClipboardContent is not a Glyph, different type
  "SelectContourOnDoubleClickBehavior.ts", // finds contour by segment match
];

function checkParam(context, node) {
  // Handle destructured or rest patterns — only check simple identifiers
  if (node.type !== "Identifier") return;

  const name = node.name;
  // Only flag known domain ID parameter names, not arbitrary *Id params like toolId
  const DOMAIN_ID_SUFFIXES = ["pointId", "contourId", "anchorId", "segmentId"];
  const lowerName = name.toLowerCase();
  if (!DOMAIN_ID_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) return;

  const typeAnnotation = node.typeAnnotation;
  if (!typeAnnotation) return;

  // TSTypeAnnotation wraps the actual type node
  const typeNode = typeAnnotation.typeAnnotation || typeAnnotation;
  if (typeNode.type === "TSStringKeyword") {
    context.report({
      node,
      messageId: "useBrandedId",
      data: { name },
    });
  }
}

/** Files where GlyphSnapshot usage is expected (bridge/engine/generated layers). */
const SNAPSHOT_ALLOWED = [
  "engine/",
  "shared/bridge/",
  "packages/types/",
  "testing/",
  "draft.ts",
  "commands/", // undo/redo deals with raw snapshots
  "types/engine.ts", // engine response types
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
     * Ban parameters named *Id that are typed as plain `string`.
     *
     * Domain IDs (PointId, ContourId, AnchorId, SegmentId) are branded types.
     * Using raw `string` defeats type safety and allows accidental mixing.
     */
    "no-unbranded-ids": {
      meta: {
        type: "suggestion",
        messages: {
          useBrandedId:
            "Parameter '{{name}}' is typed as string. Use the branded type (PointId, ContourId, AnchorId, SegmentId) from @shift/types.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        return {
          /**
           * Match function parameters whose name ends with "Id" (case-sensitive)
           * but whose type annotation is plain "string".
           *
           * Catches: (contourId: string), (pointId: string)
           * Ignores: (contourId: ContourId), (name: string)
           */
          "FunctionDeclaration > .params"(node) {
            checkParam(context, node);
          },
          "FunctionExpression > .params"(node) {
            checkParam(context, node);
          },
          "ArrowFunctionExpression > .params"(node) {
            checkParam(context, node);
          },
          "TSMethodSignature > .params"(node) {
            checkParam(context, node);
          },
          "MethodDefinition .params"(node) {
            checkParam(context, node);
          },
        };
      },
    },

    /**
     * Ban GlyphSnapshot in domain/tool/UI code.
     *
     * App code should use the immutable `Glyph` domain type from @shift/types.
     * GlyphSnapshot is the mutable engine representation and should only
     * appear in engine/, bridge/, types/, testing/, and draft code.
     */
    "no-snapshot-in-domain": {
      meta: {
        type: "suggestion",
        messages: {
          useGlyph:
            "Use the immutable Glyph domain type from @shift/types instead of GlyphSnapshot in app code.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (isAllowedFile(filename, SNAPSHOT_ALLOWED)) return {};
        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        return {
          /**
           * Match type annotations that reference GlyphSnapshot.
           * Catches: (snapshot: GlyphSnapshot), Map<GlyphSnapshot, ...>, etc.
           * Does NOT catch import statements — only usage in type positions.
           */
          'TSTypeReference > Identifier[name="GlyphSnapshot"]'(node) {
            context.report({ node, messageId: "useGlyph" });
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
