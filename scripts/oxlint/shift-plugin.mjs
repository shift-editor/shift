/**
 * Custom oxlint plugin for Shift Editor.
 *
 * Enforces architecture rules that can't be expressed with built-in oxlint
 * rules or no-restricted-syntax selectors.
 *
 * Registered via jsPlugins in apps/desktop/.oxlintrc.json.
 */

/** Files where raw .pointType checks are expected (validation implementation). */
const POINT_TYPE_ALLOWED = ["packages/validation/", "packages/font/", "packages/rules/"];

/** Files where direct .contours access is expected (structural traversal). */
const CONTOURS_ALLOWED = [
  "bridge/draft.ts",
  "bridge/NativeBridge.ts",
  "bridge/glyph.ts",
  "lib/model/",
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

/** Files where GlyphSnapshot usage is expected (bridge/generated layers). */
const SNAPSHOT_ALLOWED = [
  "bridge/",
  "shared/bridge/",
  "packages/types/",
  "testing/",
  "draft.ts",
  "commands/", // undo/redo deals with raw snapshots
  "behaviors/", // tool behaviors capture snapshots for undo via drafts
  "types/engine.ts", // engine response types
  "lib/model/", // reactive model uses snapshots for sync
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
     * Ban raw .pointType checks in app code.
     *
     * Use Validate.isOnCurve(point) / Validate.isOffCurve(point) from
     * @shift/validation instead of point.pointType === "onCurve".
     */
    "no-raw-point-type-check": {
      meta: {
        type: "suggestion",
        messages: {
          useValidate:
            "Use Validate.isOnCurve(point) / Validate.isOffCurve(point) from @shift/validation instead of raw .pointType checks.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (isAllowedFile(filename, POINT_TYPE_ALLOWED)) return {};
        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        return {
          /**
           * Match: point.pointType === "onCurve" / "offCurve"
           * Also catches !== comparisons.
           * Only flags comparisons against string literals, not point-to-point
           * equality checks like beforePoint.pointType !== afterPoint.pointType.
           */
          BinaryExpression(node) {
            if (node.operator !== "===" && node.operator !== "!==") return;

            const { left, right } = node;

            // One side must be a .pointType member access
            const hasPropLeft =
              left.type === "MemberExpression" &&
              left.property &&
              left.property.name === "pointType";
            const hasPropRight =
              right.type === "MemberExpression" &&
              right.property &&
              right.property.name === "pointType";

            if (!hasPropLeft && !hasPropRight) return;

            // The other side must be a string literal ("onCurve" / "offCurve")
            const other = hasPropLeft ? right : left;
            if (other.type !== "Literal" || typeof other.value !== "string") return;

            context.report({ node: hasPropLeft ? left : right, messageId: "useValidate" });
          },
        };
      },
    },

    /**
     * Ban nested ternary expressions containing .map() chains.
     *
     * Break these into named variables or use early returns for clarity.
     */
    "no-nested-ternary-map": {
      meta: {
        type: "suggestion",
        messages: {
          noTernaryMap:
            "Do not nest .map() inside a ternary expression. Extract into a named variable or use an if/else block.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        /** Find the first returned ObjectExpression in a block body. */
        function findReturnedObject(block) {
          for (const stmt of block.body) {
            if (stmt.type === "ReturnStatement" && stmt.argument) {
              if (stmt.argument.type === "ObjectExpression") return stmt.argument;
              // Parenthesized: return ({ ... })
              if (
                stmt.argument.type === "SequenceExpression" &&
                stmt.argument.expressions.length === 1
              ) {
                return stmt.argument.expressions[0];
              }
            }
          }
          return null;
        }

        /** Walk up from a node checking if any ancestor is a ConditionalExpression. */
        function isInsideTernary(node) {
          let current = node.parent;
          // Walk up at most 8 levels to avoid false positives from deeply unrelated ternaries
          let depth = 0;
          while (current && depth < 8) {
            if (current.type === "ConditionalExpression") return true;
            // Stop at statement boundaries — the ternary must be in the same expression
            if (current.type.endsWith("Statement") || current.type.endsWith("Declaration")) {
              return false;
            }
            current = current.parent;
            depth++;
          }
          return false;
        }

        return {
          /**
           * Match .map() calls inside a ternary where the callback returns
           * a spread-object containing another .map() — the data-transform
           * pattern (e.g. contours.map(c => ({ ...c, points: c.points.map(...) }))).
           *
           * Ignores React JSX rendering patterns (map returning JSX elements).
           */
          'CallExpression > MemberExpression[property.name="map"]'(node) {
            const callExpr = node.parent;
            if (!callExpr || callExpr.type !== "CallExpression") return;
            if (!isInsideTernary(callExpr)) return;

            // Check if the .map() callback body is an object with spread + nested .map()
            const callback = callExpr.arguments && callExpr.arguments[0];
            if (!callback) return;
            if (
              callback.type !== "ArrowFunctionExpression" &&
              callback.type !== "FunctionExpression"
            ) {
              return;
            }

            const body = callback.body;
            if (!body) return;

            // Arrow with expression body: x => ({ ...x, points: x.points.map(...) })
            // The expression is wrapped in parens, so body is the ObjectExpression
            // For block body, look for return statements
            const expr =
              body.type === "ObjectExpression"
                ? body
                : body.type === "BlockStatement"
                  ? findReturnedObject(body)
                  : null;

            if (!expr || expr.type !== "ObjectExpression") return;

            // Must have a spread element (structural clone pattern)
            const hasSpread = expr.properties.some((p) => p.type === "SpreadElement");
            if (!hasSpread) return;

            // Must have a property whose value contains a .map() call
            function hasMapCall(astNode) {
              if (!astNode || typeof astNode !== "object") return false;
              if (
                astNode.type === "CallExpression" &&
                astNode.callee &&
                astNode.callee.type === "MemberExpression" &&
                astNode.callee.property &&
                astNode.callee.property.name === "map"
              ) {
                return true;
              }
              for (const key of Object.keys(astNode)) {
                if (key === "parent") continue;
                const child = astNode[key];
                if (Array.isArray(child)) {
                  if (child.some((c) => hasMapCall(c))) return true;
                } else if (child && typeof child === "object" && child.type) {
                  if (hasMapCall(child)) return true;
                }
              }
              return false;
            }

            const propsWithMap = expr.properties.filter(
              (p) => p.type === "Property" && hasMapCall(p.value),
            );

            if (propsWithMap.length > 0) {
              context.report({ node: callExpr, messageId: "noTernaryMap" });
            }
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

    /**
     * Flag repeated optional chaining on the same variable in React components.
     *
     * When the same base appears in 3+ optional chains (e.g. glyph?.foo,
     * glyph?.bar, glyph?.baz), use an early return instead:
     *   if (!glyph) return null;
     *
     * Only applies to .tsx files (React components).
     */
    "no-repeated-optional-chain": {
      meta: {
        type: "suggestion",
        messages: {
          useEarlyReturn:
            "'{{name}}' is optional-chained {{count}} times. Use an early return (`if (!{{name}}) return null;`) instead.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (!filename.endsWith(".tsx")) return {};
        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        const THRESHOLD = 3;

        function checkFunction(node) {
          const body = node.body;
          if (!body) return;

          const counts = new Map();

          function walk(n) {
            if (!n || typeof n !== "object") return;
            if (n.type === "ChainExpression" && n.expression?.type === "MemberExpression") {
              const obj = n.expression.object;
              if (obj?.type === "Identifier") {
                counts.set(obj.name, (counts.get(obj.name) || 0) + 1);
              }
            }
            for (const key of Object.keys(n)) {
              if (key === "parent") continue;
              const child = n[key];
              if (Array.isArray(child)) {
                for (const item of child) {
                  if (item && typeof item.type === "string") walk(item);
                }
              } else if (child && typeof child.type === "string") {
                walk(child);
              }
            }
          }

          walk(body);

          for (const [name, count] of counts) {
            if (count >= THRESHOLD) {
              context.report({
                node,
                messageId: "useEarlyReturn",
                data: { name, count: String(count) },
              });
            }
          }
        }

        return {
          FunctionDeclaration: checkFunction,
          FunctionExpression: checkFunction,
          ArrowFunctionExpression: checkFunction,
        };
      },
    },
    /**
     * Ban section divider comments like `// ── Section ──` or `// === Helpers ===`.
     *
     * Use JSDoc on the next declaration instead. Section comments add visual
     * noise and go stale — the code structure should speak for itself.
     */
    "no-section-divider-comments": {
      meta: {
        type: "suggestion",
        messages: {
          noSectionDivider:
            "Do not use section divider comments (// ── ... ──). Add JSDoc to the functions/classes that make up the section instead. See /doc-coauthoring skill for writing guidance.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        const sourceCode = context.getSourceCode();
        if (!sourceCode) return {};

        return {
          Program() {
            const comments = sourceCode.getAllComments ? sourceCode.getAllComments() : [];
            for (const comment of comments) {
              if (comment.type !== "Line") continue;
              const text = comment.value.trim();
              // Match patterns like: ── Section ──, === Section ===, --- Section ---
              if (/^[─═\-=~]{2,}/.test(text) || /[─═\-=~]{2,}$/.test(text)) {
                context.report({ node: comment, messageId: "noSectionDivider" });
              }
            }
          },
        };
      },
    },
  },
};
