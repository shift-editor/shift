/**
 * Custom oxlint plugin for Shift Editor.
 *
 * Enforces architecture rules that can't be expressed with built-in oxlint
 * rules or no-restricted-syntax selectors.
 *
 * Registered via jsPlugins in the root .oxlintrc.json, which every package extends.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Files where raw .pointType checks are expected (validation implementation). */
const POINT_TYPE_ALLOWED = ["packages/validation/", "packages/glyph-state/", "packages/rules/"];

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

/** Boundaries that acquire, transport, synchronize, or hydrate glyph snapshots. */
const GLYPH_SNAPSHOT_ALLOWED = [
  "bridge/",
  "shared/bridge/",
  "shared/workspace/protocol.ts",
  "utility/workspace/WorkspaceHost.ts",
  "renderer/src/types/glyph.ts",
  "renderer/src/lib/model/",
  "packages/editor/src/types/font.ts",
  "packages/editor/src/types/glyph.ts",
  "packages/editor/src/lib/model/",
  "renderer/src/lib/workspace/",
  "renderer/src/workspace/runtime.ts",
  "testing/",
];

let brandHelperNames = null;

/** Branded id types that `@shift/types` mints with an `as<Brand>` helper. */
function brandsWithHelpers() {
  if (brandHelperNames) return brandHelperNames;

  const idsPath = fileURLToPath(new URL("../../packages/types/src/ids.ts", import.meta.url));
  const source = readFileSync(idsPath, "utf8");
  brandHelperNames = new Set(
    Array.from(source.matchAll(/export function as([A-Z]\w*Id)\b/g), (match) => match[1]),
  );
  return brandHelperNames;
}

function isAllowedFile(filename, allowList) {
  // oxlint may pass relative or absolute paths
  const normalized = filename.replace(/\\/g, "/");
  return allowList.some((pattern) => normalized.includes(pattern));
}

const REACTIVE_VALUE_ALLOWED = ["lib/signals/"];

const REACTIVE_BOUNDARY_CALLEES = new Set([
  "computed",
  "effect",
  "useSignalEffect",
  "useSignalState",
  "useSignalText",
]);

function methodName(node) {
  if (!node?.key) return null;
  if (node.key.type === "Identifier") return node.key.name;
  if (node.key.type === "PrivateIdentifier") return node.key.name;
  return null;
}

function classExtendsCanvasItem(node) {
  if (!node) return false;

  const superclass = node.superClass;
  if (!superclass) return false;
  if (superclass.type === "Identifier") return superclass.name === "CanvasItem";
  if (superclass.type === "MemberExpression" && superclass.property?.type === "Identifier") {
    return superclass.property.name === "CanvasItem";
  }
  return false;
}

function containingMethod(node) {
  let current = node.parent;

  while (current) {
    if (current.type === "MethodDefinition") return current;
    current = current.parent;
  }

  return null;
}

function methodOwnerClass(method) {
  const body = method?.parent;
  if (body?.type !== "ClassBody") return null;
  return body.parent ?? null;
}

function calleeName(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property?.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}

function isInsideReactiveBoundary(node) {
  let current = node.parent;

  while (current) {
    if (
      current.type === "CallExpression" &&
      REACTIVE_BOUNDARY_CALLEES.has(calleeName(current.callee))
    ) {
      return true;
    }

    if (current.type === "MethodDefinition") {
      const name = methodName(current);
      if (name === "props" && classExtendsCanvasItem(methodOwnerClass(current))) return true;
      if (name === "dependencies" || name?.endsWith("Dependencies")) return true;
      if (name === "getCursor") return true;
      if (name === "trackViewportTransform") return true;
    }

    current = current.parent;
  }

  return false;
}

function isCanvasItemPropsCellValueRead(node) {
  const method = containingMethod(node);
  if (!method || methodName(method) !== "draw") return false;
  if (!classExtendsCanvasItem(methodOwnerClass(method))) return false;

  const object = node.object;
  if (object?.type !== "MemberExpression") return false;
  if (object.property?.type !== "Identifier" || object.property.name !== "propsCell") return false;
  return object.object?.type === "ThisExpression";
}

function isDomValueRead(node) {
  const object = node.object;

  if (!object) return false;
  if (object.type === "Identifier" && object.name === "textarea") return true;
  if (object.type !== "MemberExpression") return false;
  if (object.property?.type !== "Identifier") return false;
  return object.property.name === "target" || object.property.name === "currentTarget";
}

function isIteratorValueRead(node) {
  const object = node.object;

  if (object?.type !== "CallExpression") return false;
  const callee = object.callee;
  if (callee?.type !== "MemberExpression") return false;
  return callee.property?.type === "Identifier" && callee.property.name === "next";
}

const SIGNAL_PRIMITIVES = new Set(["signal", "computed", "effect", "track"]);
const MUTABLE_COLLECTIONS = new Set(["Map", "Set", "WeakMap", "WeakSet", "EntityMap"]);
const COLLECTION_MUTATORS = new Set(["set", "delete", "clear", "add"]);
const SIGNAL_TYPES = new Set(["Signal", "WritableSignal", "ComputedSignal", "ReadonlySignal"]);
const NON_REACTIVE_ANNOTATION = /^\s*non-reactive:\s*\S/;

/** Whether an import source is the Shift signals module (relative, `@/`, or package export). */
function isSignalsModule(source) {
  if (source === "@shift/editor" || source === "@shift/editor/signals") return true;
  return /(^|\/)signals(\/(index|signal))?$/.test(source);
}

function importsSignalPrimitive(program) {
  return program.body.some((statement) => {
    if (statement.type !== "ImportDeclaration") return false;
    if (statement.importKind === "type") return false;
    if (!isSignalsModule(statement.source.value)) return false;

    return statement.specifiers.some(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        specifier.importKind !== "type" &&
        SIGNAL_PRIMITIVES.has(specifier.imported?.name ?? specifier.imported?.value),
    );
  });
}

function typeReferenceName(typeNode) {
  if (typeNode?.type !== "TSTypeReference") return null;
  const name = typeNode.typeName;
  if (name?.type === "Identifier") return name.name;
  return null;
}

function typeArgumentsOf(node) {
  return (node?.typeArguments ?? node?.typeParameters)?.params ?? [];
}

/**
 * Describe a mutable collection type or constructor: its kind and whether the
 * stored values are signals (entries that notify on their own).
 */
function collectionShape(kind, typeArgs) {
  if (!MUTABLE_COLLECTIONS.has(kind)) return null;

  const valueIndex = kind === "Map" || kind === "WeakMap" || kind === "EntityMap" ? 1 : 0;
  const valueType = typeArgs[valueIndex];
  const holdsSignals = SIGNAL_TYPES.has(typeReferenceName(valueType));
  return { kind, holdsSignals };
}

function fieldCollectionShape(field) {
  const annotation = field.typeAnnotation?.typeAnnotation;
  const annotated = typeReferenceName(annotation);
  if (annotated) {
    const shape = collectionShape(annotated, typeArgumentsOf(annotation));
    if (shape) return shape;
  }

  const value = field.value;
  if (value?.type === "NewExpression" && value.callee?.type === "Identifier") {
    return collectionShape(value.callee.name, typeArgumentsOf(value));
  }

  return null;
}

function hasNonReactiveAnnotation(field, sourceCode) {
  const text = sourceCode.text ?? sourceCode.getText();
  const comments = sourceCode.getAllComments ? sourceCode.getAllComments() : [];
  let cursor = field.range[0];

  const leading = comments
    .filter((comment) => comment.range[1] <= cursor)
    .sort((a, b) => b.range[1] - a.range[1]);

  for (const comment of leading) {
    const gap = text.slice(comment.range[1], cursor);
    if (gap.trim() !== "") return false;
    if (comment.type === "Line" && NON_REACTIVE_ANNOTATION.test(comment.value)) return true;
    cursor = comment.range[0];
  }

  return false;
}

function thisFieldKey(member) {
  if (member?.type !== "MemberExpression" || member.computed) return null;
  if (member.object?.type !== "ThisExpression") return null;
  const property = member.property;
  if (property?.type === "PrivateIdentifier") return `#${property.name}`;
  if (property?.type === "Identifier") return property.name;
  return null;
}

function fieldKey(field) {
  if (field.computed) return null;
  const key = field.key;
  if (key?.type === "PrivateIdentifier") return `#${key.name}`;
  if (key?.type === "Identifier") return key.name;
  return null;
}

/** Whether a node runs synchronously in its class constructor (not in a nested callback). */
function isDirectlyInConstructor(node) {
  let current = node.parent;

  while (current) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) {
      const method = current.parent;
      return method?.type === "MethodDefinition" && method.kind === "constructor";
    }
    current = current.parent;
  }

  return false;
}

function enclosingClassBody(node) {
  let current = node.parent;

  while (current) {
    if (current.type === "ClassBody") return current;
    current = current.parent;
  }

  return null;
}

export default {
  meta: { name: "shift" },
  rules: {
    /**
     * Ban in-place mutation of Map/Set class fields in reactive modules.
     *
     * A plain collection cannot notify. When a class mutates one in place and
     * a `computed` or render effect reads it, the reader never reruns (the bug
     * behind PR #453). Derive the index with `computed` over its source signal,
     * or hold an immutable collection in a signal and replace it.
     *
     * Applies to classes in files that import `signal`/`computed`/`effect`/
     * `track` from the signals module. Flags `this.#field.set/delete/clear/add`
     * (and `this.field.*`) outside the constructor body. Fields whose values
     * are signals (`Map<K, WritableSignal<V>>`) are allowed because each entry
     * notifies. A field that is never read reactively may opt out with a
     * leading `// non-reactive: <reason>` comment.
     */
    "no-mutable-collection-field": {
      meta: {
        type: "problem",
        messages: {
          mutableCollection:
            "`{{field}}` is a {{kind}} mutated in place; readers in computed/effect never rerun. Derive it with `computed` over its source signal or hold an immutable collection in a signal. If it is never read reactively, annotate the field with `// non-reactive: <why>`.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        const sourceCode = context.getSourceCode();
        let active = false;
        const classFields = new WeakMap();

        function collectionFields(classBody) {
          const cached = classFields.get(classBody);
          if (cached) return cached;

          const fields = new Map();
          for (const member of classBody.body) {
            if (member.type !== "PropertyDefinition" || member.static) continue;
            const key = fieldKey(member);
            if (!key) continue;
            const shape = fieldCollectionShape(member);
            if (!shape || shape.holdsSignals) continue;
            if (hasNonReactiveAnnotation(member, sourceCode)) continue;
            fields.set(key, shape);
          }

          classFields.set(classBody, fields);
          return fields;
        }

        return {
          Program(node) {
            active = importsSignalPrimitive(node);
          },
          CallExpression(node) {
            if (!active) return;

            const callee = node.callee;
            if (callee?.type !== "MemberExpression" || callee.computed) return;
            if (!COLLECTION_MUTATORS.has(callee.property?.name)) return;

            const field = thisFieldKey(callee.object);
            if (!field) return;

            const classBody = enclosingClassBody(node);
            if (!classBody) return;

            const shape = collectionFields(classBody).get(field);
            if (!shape) return;
            if (isDirectlyInConstructor(node)) return;

            context.report({
              node,
              messageId: "mutableCollection",
              data: { field, kind: shape.kind },
            });
          },
        };
      },
    },

    /**
     * Ban `getFoo()` / `isFoo()` methods that just return `this.#signal.value`
     * (or `.peek()`). Use a value getter + optional `$foo` signal getter
     * instead — matches the Glyph/Contour convention:
     *
     *   // ❌
     *   public getIsHoveringNode(): boolean {
     *     return this.#isHoveringNode.value;
     *   }
     *
     *   // ✅
     *   public get isHoveringNode(): boolean {
     *     return this.#isHoveringNode.value;
     *   }
     *   public get $isHoveringNode(): Signal<boolean> {
     *     return this.#isHoveringNode;
     *   }
     */
    "no-get-signal-value-method": {
      meta: {
        type: "suggestion",
        messages: {
          useGetter:
            "Method `{{name}}` just reads a signal value. Use `get {{suggested}}(): T` + optional `get ${{suggested}}(): Signal<T>` instead.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        function suggestedName(methodName) {
          if (/^get[A-Z]/.test(methodName)) {
            return methodName.charAt(3).toLowerCase() + methodName.slice(4);
          }
          if (/^is[A-Z]/.test(methodName)) {
            // keep "is" prefix for boolean getters: isPreviewMode → previewMode? or isHoveringNode stays?
            // The Editor rename uses: isPreviewMode (was method) → previewMode (is getter)
            // But isHoveringNode stays as isHoveringNode.
            // Heuristic: if what follows "is" is a noun/phrase, drop "is". Can't tell statically.
            // Just return as-is and let humans decide.
            return methodName;
          }
          return methodName;
        }

        function isSignalValueReturn(body) {
          if (!body || body.type !== "BlockStatement") return false;
          if (body.body.length !== 1) return false;
          const stmt = body.body[0];
          if (stmt.type !== "ReturnStatement" || !stmt.argument) return false;
          const ret = stmt.argument;
          if (ret.type !== "MemberExpression") return false;
          if (!ret.property || ret.property.type !== "Identifier") return false;
          if (ret.property.name !== "value" && ret.property.name !== "peek") return false;
          // Return object must itself be a MemberExpression (this.#foo or this.$foo)
          return ret.object && ret.object.type === "MemberExpression";
        }

        return {
          MethodDefinition(node) {
            if (node.kind !== "method") return; // skip get/set accessors
            if (!node.key || node.key.type !== "Identifier") return;

            const name = node.key.name;
            if (!/^(get|is)[A-Z]/.test(name)) return;

            const fn = node.value;
            if (!fn || !fn.body) return;

            if (!isSignalValueReturn(fn.body)) return;

            context.report({
              node: node.key,
              messageId: "useGetter",
              data: { name, suggested: suggestedName(name) },
            });
          },
        };
      },
    },

    /**
     * Ban reactive `.value` reads outside explicit reactive boundaries.
     *
     * `.value` both reads and subscribes. Outside `computed`, `effect`, or a
     * React signal hook this creates hidden dependencies that make rendering
     * hard to reason about. Use `.peek()` for a snapshot read at imperative
     * boundaries, or move the read into a named dependency builder.
     */
    "no-reactive-value-outside-boundary": {
      meta: {
        type: "problem",
        messages: {
          useSnapshotRead:
            "Do not read reactive `.value` outside computed/effect/signal hooks. Use `.peek()` for a snapshot read or move this into an explicit dependency boundary.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (isAllowedFile(filename, REACTIVE_VALUE_ALLOWED)) return {};
        if (filename.includes(".test.") || filename.includes("testing/")) return {};
        if (filename.includes("/docs/")) return {};

        return {
          'MemberExpression[property.name="value"]'(node) {
            if (isDomValueRead(node)) return;
            if (isIteratorValueRead(node)) return;
            if (isCanvasItemPropsCellValueRead(node)) return;
            if (isInsideReactiveBoundary(node)) return;

            context.report({ node, messageId: "useSnapshotRead" });
          },
        };
      },
    },

    /**
     * Ban raw segment parsing in app code.
     *
     * `Segment.parse(points, closed)` and `parseContourSegments({...})` are
     * the low-level parser primitives. App code should use the reactive
     * generators instead:
     *   - contour.segments() for a single contour
     *   - glyph.segments()   for all contours in a glyph
     *
     * The generators wrap `parseContourSegments` and yield `Segment` class
     * instances, which is what callers actually want.
     */
    "no-raw-segment-parse": {
      meta: {
        type: "suggestion",
        messages: {
          useGenerator:
            "Do not call `{{callee}}` directly. Use contour.segments() / glyph.segments() generators on the domain classes.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        const SEGMENT_PARSE_ALLOWED = [
          "lib/model/", // Segment.parse + Contour.segments wrap parseContourSegments here
          "packages/glyph-state/", // parseContourSegments lives here
          "testing/",
        ];

        if (isAllowedFile(filename, SEGMENT_PARSE_ALLOWED)) return {};
        if (filename.includes(".test.")) return {};

        return {
          // Segment.parse(...)
          CallExpression(node) {
            const callee = node.callee;
            if (!callee) return;

            if (
              callee.type === "MemberExpression" &&
              callee.object?.type === "Identifier" &&
              callee.object.name === "Segment" &&
              callee.property?.type === "Identifier" &&
              callee.property.name === "parse"
            ) {
              context.report({
                node: callee,
                messageId: "useGenerator",
                data: { callee: "Segment.parse" },
              });
              return;
            }

            // parseContourSegments(...)
            if (callee.type === "Identifier" && callee.name === "parseContourSegments") {
              const method = containingMethod(node);
              if (
                filename.replace(/\\/g, "/").endsWith("/lib/graphics/ContourPath.ts") &&
                methodName(method) === "fromPoints" &&
                methodOwnerClass(method)?.id?.name === "ContourPath"
              ) {
                return;
              }

              context.report({
                node: callee,
                messageId: "useGenerator",
                data: { callee: "parseContourSegments" },
              });
            }
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
     * Keep the GlyphSnapshot transport DTO inside acquisition, synchronization,
     * and model-hydration boundaries. Renderer domain and UI code consume the
     * reactive Glyph model instead.
     */
    "no-snapshot-in-domain": {
      meta: {
        type: "suggestion",
        messages: {
          useGlyph:
            "GlyphSnapshot is a transport DTO. Use the reactive Glyph model outside snapshot acquisition, synchronization, and hydration boundaries.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (isAllowedFile(filename, GLYPH_SNAPSHOT_ALLOWED)) return {};
        if (filename.includes(".test.")) return {};

        return {
          ImportDeclaration(node) {
            if (node.source?.value !== "@shift/types") return;

            for (const specifier of node.specifiers ?? []) {
              if (specifier.type !== "ImportSpecifier") continue;

              const importedName = specifier.imported?.name ?? specifier.imported?.value;
              if (importedName !== "GlyphSnapshot") continue;

              context.report({ node: specifier, messageId: "useGlyph" });
            }
          },
        };
      },
    },

    /**
     * Ban raw .pointType checks in app code.
     *
     * Use Point.isOnCurve(point) / Point.isOffCurve(point) from
     * @shift/glyph-state instead of point.pointType === "onCurve".
     */
    "no-raw-point-type-check": {
      meta: {
        type: "suggestion",
        messages: {
          useValidate:
            "Use Point.isOnCurve(point) / Point.isOffCurve(point) from @shift/glyph-state instead of raw .pointType checks.",
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

            context.report({
              node: hasPropLeft ? left : right,
              messageId: "useValidate",
            });
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
                context.report({
                  node: comment,
                  messageId: "noSectionDivider",
                });
              }
            }
          },
        };
      },
    },

    /**
     * Ban direct Editor construction in test files.
     *
     * Tests should use TestEditor from @/testing/TestEditor, which creates
     * a real Editor with the real NAPI backend and registers built-in tools.
     * Direct `new Editor({bridge: createBridge()})` bypasses tool registration
     * and drifts from the real setup.
     */
    "no-raw-editor-in-tests": {
      meta: {
        type: "suggestion",
        messages: {
          useTestEditor:
            "Use TestEditor from @/testing/TestEditor instead of constructing Editor directly in tests.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (!filename.includes(".test.")) return {};
        if (filename.includes("testing/")) return {};

        return {
          NewExpression(node) {
            if (node.callee && node.callee.type === "Identifier" && node.callee.name === "Editor") {
              context.report({ node, messageId: "useTestEditor" });
            }
          },
        };
      },
    },

    /**
     * Ban direct imports from @/bridge in app code.
     *
     * The bridge is internal plumbing. App code should use Font and Glyph.
     * Only Editor, Font class, testing, store, and commands may import bridge.
     */
    "no-bridge-import": {
      meta: {
        type: "suggestion",
        messages: {
          noBridge:
            "Do not import from @/bridge directly. Use Font and Glyph instead. The bridge is internal.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        const BRIDGE_ALLOWED = [
          "bridge/", // bridge internals can import each other
          "Editor.ts", // orchestrator wires bridge to Font/Glyph
          "Font.ts", // Font wraps bridge
          "Glyph.ts", // Glyph wraps bridge
          "glyph.ts", // Glyph wraps bridge (case insensitive match)
          "testing/", // test helpers create bridge instances
          "store/", // app store creates bridge
          "commands/", // commands access bridge via context
        ];

        if (isAllowedFile(filename, BRIDGE_ALLOWED)) return {};
        if (filename.includes(".test.")) return {};

        return {
          ImportDeclaration(node) {
            const source = node.source && node.source.value;
            if (typeof source === "string" && source.startsWith("@/bridge")) {
              context.report({ node, messageId: "noBridge" });
            }
          },
        };
      },
    },

    /**
     * Ban `@shift/wasm/reference` outside tests.
     *
     * The reference module is a second WebAssembly build holding shift-font's
     * answers for rules the editor keeps in TypeScript, so tests can compare
     * the two. It is test-only and must never reach the app or the SDK.
     */
    "no-reference-module-outside-tests": {
      meta: {
        type: "problem",
        messages: {
          testOnly:
            "@shift/wasm/reference is a test-only build. Import it only from .test.ts files or testing/ helpers.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();

        if (filename.includes(".test.") || filename.includes("testing/")) return {};

        const report = (node) => {
          const source = node.source && node.source.value;
          if (typeof source === "string" && source.startsWith("@shift/wasm/reference")) {
            context.report({ node, messageId: "testOnly" });
          }
        };
        return {
          ImportDeclaration: report,
          ExportNamedDeclaration: report,
          ExportAllDeclaration: report,
          ImportExpression: report,
        };
      },
    },

    /**
     * Ban vitest mock primitives in test files.
     *
     * `vi.fn`, `vi.spyOn`, `toHaveBeenCalled*`, and `.mock.calls` lead to
     * tests that assert on invocations ("was method X called N times") rather
     * than observable state ("did the user's glyph change"). The codebase
     * has deliberately swept this pattern out — see commits 5f2f503,
     * fa8a829, bd07e9d.
     *
     * Exception: when you're testing a primitive whose contract IS the
     * invocation count (reactive fire counts, pub/sub dispatch), use a
     * plain closure counter (`let n = 0; ...; n++`) — that pattern is
     * legitimate and not flagged by this rule.
     *
     * See the /writing-tests skill for the full rationale and migration
     * patterns.
     */
    "no-vitest-mock-primitives": {
      meta: {
        type: "suggestion",
        messages: {
          noViFn:
            "vi.fn() builds a spy whose only use is counting invocations. Capture the observable effect in a closure (payload array, flag, counter) or drive through TestEditor. See /writing-tests skill.",
          noViSpyOn:
            "vi.spyOn is for asserting on call counts — the banned pattern. Drive the real code through its user-facing surface and assert on observable state. See /writing-tests skill.",
          noToHaveBeenCalled:
            "Asserting on whether a function was called couples the test to implementation. Assert on the observable consequence (state change, return value, emitted payload). See /writing-tests skill.",
          noMockCalls:
            "Inspecting .mock.calls is the banned pattern. Assert on the outcome the code produces, not the invocations it made. See /writing-tests skill.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();
        if (!filename.includes(".test.")) return {};

        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee &&
              callee.type === "MemberExpression" &&
              callee.object &&
              callee.object.type === "Identifier" &&
              callee.object.name === "vi" &&
              callee.property &&
              callee.property.type === "Identifier"
            ) {
              if (callee.property.name === "fn") {
                context.report({ node, messageId: "noViFn" });
              } else if (callee.property.name === "spyOn") {
                context.report({ node, messageId: "noViSpyOn" });
              }
            }

            if (
              callee &&
              callee.type === "MemberExpression" &&
              callee.property &&
              callee.property.type === "Identifier" &&
              typeof callee.property.name === "string" &&
              callee.property.name.startsWith("toHaveBeenCalled")
            ) {
              context.report({ node, messageId: "noToHaveBeenCalled" });
            }
          },
          MemberExpression(node) {
            if (
              node.property &&
              node.property.type === "Identifier" &&
              node.property.name === "calls" &&
              node.object &&
              node.object.type === "MemberExpression" &&
              node.object.property &&
              node.object.property.type === "Identifier" &&
              node.object.property.name === "mock"
            ) {
              context.report({ node, messageId: "noMockCalls" });
            }
          },
        };
      },
    },

    /**
     * Ban `vi.stubGlobal(...)` in test files.
     *
     * Global stubbing (`vi.stubGlobal("window", ...)`, `vi.stubGlobal("requestAnimationFrame", ...)`)
     * papers over unmanaged global dependencies. Leaks across tests if unstub
     * is forgotten, order-sensitive, and hides that the production code has
     * a hard-coded global that should be an injected boundary.
     *
     * - For rAF-backed pipelines, use `toolManager.flushPointerMoves()`
     *   (TestEditor.pointerMove already does this).
     * - For `window.electronAPI` / IPC, inject an adapter through the
     *   constructor (see `SystemClipboard` in `lib/clipboard/`).
     *
     * See `/writing-tests` skill for the full rationale.
     */
    "no-vi-stub-global-in-tests": {
      meta: {
        type: "suggestion",
        messages: {
          noStubGlobal:
            "Do not use vi.stubGlobal in tests. Inject the boundary via a constructor adapter (SystemClipboard pattern) or use the synchronous seam (toolManager.flushPointerMoves). See /writing-tests skill.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename();
        if (!filename.includes(".test.")) return {};

        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee &&
              callee.type === "MemberExpression" &&
              callee.object &&
              callee.object.type === "Identifier" &&
              callee.object.name === "vi" &&
              callee.property &&
              callee.property.type === "Identifier" &&
              callee.property.name === "stubGlobal"
            ) {
              context.report({ node, messageId: "noStubGlobal" });
            }
          },
        };
      },
    },
    /**
     * Ban the hand-written `((i % n) + n) % n` wrap.
     *
     * Cyclic indexing has one helper, `wrapIndex(index, length)` from
     * `@shift/geo`, so the rule reads as what it means at the call site.
     */
    "no-manual-index-wrap": {
      meta: {
        type: "suggestion",
        messages: {
          useWrapIndex:
            "Use wrapIndex(index, length) from @shift/geo instead of writing the cyclic wrap by hand.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename().replace(/\\/g, "/");
        if (filename.endsWith("packages/geo/src/wrapIndex.ts")) return {};
        if (filename.includes(".test.") || filename.includes("/testing/")) return {};

        const source = context.sourceCode ?? context.getSourceCode();
        const text = (node) => source.getText(node).replace(/\s+/g, "");

        return {
          BinaryExpression(node) {
            if (node.operator !== "%") return;

            const sum = node.left;
            if (sum.type !== "BinaryExpression" || sum.operator !== "+") return;

            const remainder = sum.left;
            if (remainder.type !== "BinaryExpression" || remainder.operator !== "%") return;

            const length = text(node.right);
            if (text(remainder.right) !== length || text(sum.right) !== length) return;

            context.report({ node, messageId: "useWrapIndex" });
          },
        };
      },
    },

    /**
     * Ban `as <Brand>` casts for ids that have an `as<Brand>` helper.
     *
     * `@shift/types` exports `asPointId`, `asGlyphId`, … next to each branded
     * id. A bare cast skips the one place a brand is minted, so call the helper.
     * The brand list is read from `packages/types/src/ids.ts`.
     */
    "brand-cast-via-helper": {
      meta: {
        type: "suggestion",
        messages: {
          useBrandHelper:
            "Use as{{brand}}(value) from @shift/types instead of casting to {{brand}}.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename().replace(/\\/g, "/");
        if (filename.endsWith("packages/types/src/ids.ts")) return {};
        if (filename.includes(".test.") || filename.includes("/testing/")) return {};

        return {
          TSAsExpression(node) {
            const type = node.typeAnnotation;
            if (!type || type.type !== "TSTypeReference") return;
            if (!type.typeName || type.typeName.type !== "Identifier") return;

            const brand = type.typeName.name;
            if (!brandsWithHelpers().has(brand)) return;

            context.report({ node, messageId: "useBrandHelper", data: { brand } });
          },
        };
      },
    },

    /**
     * Ban copying an iterator into an array only to query it.
     *
     * `[...map.values()].filter(...)` builds a throwaway array before the
     * query runs. Iterator helpers query the iterator directly:
     * `map.values().filter(...).toArray()`, and `.some`, `.every` and
     * `.find` need no array at all.
     */
    "prefer-iterator-helpers": {
      meta: {
        type: "suggestion",
        messages: {
          useIteratorHelper:
            "Query the iterator directly: `{{source}}.{{method}}(...)` (add `.toArray()` when you need an array) instead of spreading it into an array first.",
        },
        schema: [],
      },
      create(context) {
        const QUERIES = new Set([
          "filter",
          "map",
          "flatMap",
          "some",
          "every",
          "find",
          "reduce",
          "forEach",
        ]);
        const ITERATORS = new Set(["values", "keys", "entries"]);
        const source = context.sourceCode ?? context.getSourceCode();

        return {
          CallExpression(node) {
            const callee = node.callee;
            if (!callee || callee.type !== "MemberExpression" || callee.computed) return;
            if (!callee.property || !QUERIES.has(callee.property.name)) return;

            const array = callee.object;
            if (!array || array.type !== "ArrayExpression" || array.elements.length !== 1) return;

            const spread = array.elements[0];
            if (!spread || spread.type !== "SpreadElement") return;

            const iterator = spread.argument;
            if (iterator.type !== "CallExpression" || iterator.arguments.length !== 0) return;
            if (iterator.callee.type !== "MemberExpression") return;
            if (!ITERATORS.has(iterator.callee.property?.name)) return;

            context.report({
              node: callee,
              messageId: "useIteratorHelper",
              data: { source: source.getText(iterator), method: callee.property.name },
            });
          },
        };
      },
    },

    /**
     * Ban picking one node out of a `nodesOfKind` list by hand.
     *
     * `scene.only(kind)` names "the one node of this kind" (null with none or
     * several) and `scene.first(kind)` names "the first in scene order". Flags
     * `nodesOfKind(kind)[0]`, `const [node] = scene.nodesOfKind(kind)` and
     * `nodesOfKind(kind).length === 1`.
     */
    "prefer-scene-only": {
      meta: {
        type: "suggestion",
        messages: {
          useOnly:
            "Use scene.only(kind) for the one node of a kind, or scene.first(kind) for the first, instead of indexing nodesOfKind(kind).",
        },
        schema: [],
      },
      create(context) {
        if (context.getFilename().replace(/\\/g, "/").endsWith("lib/editor/Scene.ts")) return {};

        const isNodesOfKind = (node) =>
          node &&
          node.type === "CallExpression" &&
          node.callee.type === "MemberExpression" &&
          node.callee.property &&
          node.callee.property.name === "nodesOfKind";

        return {
          MemberExpression(node) {
            if (!node.computed || !isNodesOfKind(node.object)) return;
            if (node.property.type !== "Literal" || node.property.value !== 0) return;

            context.report({ node, messageId: "useOnly" });
          },
          VariableDeclarator(node) {
            if (node.id.type !== "ArrayPattern" || !isNodesOfKind(node.init)) return;

            context.report({ node, messageId: "useOnly" });
          },
          BinaryExpression(node) {
            if (node.operator !== "===" && node.operator !== "!==") return;
            const length = node.left;
            if (length.type !== "MemberExpression" || length.property?.name !== "length") return;
            if (!isNodesOfKind(length.object)) return;
            if (node.right.type !== "Literal" || node.right.value !== 1) return;

            context.report({ node, messageId: "useOnly" });
          },
        };
      },
    },

    /**
     * Ban optional collection fields.
     *
     * `readonly points?: readonly PointId[]` makes every reader write
     * `points ?? []`. Make the field required and let an empty collection mean
     * "none". When absence really differs from empty (an option that falls back
     * to a default, a wire format), keep it and say why in a disable comment.
     */
    "no-optional-collection-field": {
      meta: {
        type: "suggestion",
        messages: {
          requiredCollection:
            "`{{name}}` is an optional collection, so readers must write `?? []`. Make it required and use an empty collection for none, or justify the absence in a disable comment.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename().replace(/\\/g, "/");
        if (filename.includes(".test.") || filename.includes("/testing/")) return {};
        // Generated bindings mirror Rust's Option<Vec<_>> wire fields.
        if (filename.includes("/generated")) return {};

        const isCollection = (type) => {
          if (!type) return false;
          if (type.type === "TSArrayType") return true;
          if (type.type === "TSTypeOperator" && type.operator === "readonly") {
            return isCollection(type.typeAnnotation);
          }
          return (
            type.type === "TSTypeReference" &&
            type.typeName?.type === "Identifier" &&
            ["Array", "ReadonlyArray", "Set", "ReadonlySet", "Map", "ReadonlyMap"].includes(
              type.typeName.name,
            )
          );
        };

        return {
          TSPropertySignature(node) {
            if (!node.optional || !isCollection(node.typeAnnotation?.typeAnnotation)) return;

            const name = node.key?.name ?? source(node.key);
            context.report({ node, messageId: "requiredCollection", data: { name } });
          },
        };

        function source(key) {
          return (context.sourceCode ?? context.getSourceCode()).getText(key);
        }
      },
    },

    /**
     * Ban `this.#map.get(key) ?? null` on a class's own collections.
     *
     * Shift's lookups return `null` for a missing entity, while `Map.get`
     * returns `undefined`, so each lookup method converted by hand. Hold the
     * collection in an `EntityMap` from `@shift/types`: its `get` returns
     * `null`, and its `require` throws a named not-found error.
     */
    "no-map-get-to-null": {
      meta: {
        type: "suggestion",
        messages: {
          useEntityMap:
            "Hold `{{field}}` in an EntityMap from @shift/types, whose get returns null, instead of converting Map.get with `?? null`.",
        },
        schema: [],
      },
      create(context) {
        if (context.getFilename().replace(/\\/g, "/").endsWith("packages/types/src/EntityMap.ts")) {
          return {};
        }

        return {
          LogicalExpression(node) {
            if (node.operator !== "??") return;
            if (node.right.type !== "Literal" || node.right.value !== null) return;

            const call = node.left;
            if (call.type !== "CallExpression" || call.callee.type !== "MemberExpression") return;
            if (call.callee.property?.name !== "get") return;

            const field = call.callee.object;
            if (field.type !== "MemberExpression" || field.object.type !== "ThisExpression") return;
            if (field.property.type !== "PrivateIdentifier") return;

            context.report({
              node,
              messageId: "useEntityMap",
              data: { field: `#${field.property.name}` },
            });
          },
        };
      },
    },
  },
};
