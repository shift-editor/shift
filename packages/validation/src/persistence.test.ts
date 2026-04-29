import { describe, expect, it } from "vitest";
import { PersistedRootSchema, TextRunModuleSchema, UserPreferencesSchema } from "./persistence";

describe("persistence schemas", () => {
  it("accepts a valid persisted root payload", () => {
    const payload = {
      version: 1,
      registry: {
        nextDocId: 2,
        pathToDocId: { "/tmp/a.ufo": "doc-1" },
        docIdToPath: { "doc-1": "/tmp/a.ufo" },
        lruDocIds: ["doc-1"],
      },
      appModules: {
        "user-preferences": {
          moduleVersion: 1,
          payload: {
            snap: {
              enabled: true,
              angle: true,
              metrics: true,
              pointToPoint: true,
              angleIncrementDeg: 45,
              pointRadiusPx: 8,
            },
          },
        },
      },
      documents: {
        "doc-1": {
          docId: "doc-1",
          updatedAt: 123,
          modules: {
            "text-run": {
              moduleVersion: 1,
              payload: {
                runsByGlyph: {
                  "65": {
                    buffer: {
                      cells: [
                        { kind: "glyph", glyphName: "A", codepoint: 65 },
                        { kind: "glyph", glyphName: "B", codepoint: 66 },
                      ],
                      cursor: 2,
                      anchor: 2,
                      originX: 100,
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = PersistedRootSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("rejects invalid text-run payload", () => {
    const result = TextRunModuleSchema.safeParse({
      runsByGlyph: {
        "65": {
          buffer: {
            cells: [{ kind: "glyph", glyphName: "A", codepoint: 65 }],
            cursor: "1",
            anchor: 0,
            originX: 0,
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid user preferences payload", () => {
    const result = UserPreferencesSchema.safeParse({
      snap: {
        enabled: true,
        angle: true,
        metrics: true,
        pointToPoint: true,
        angleIncrementDeg: "45",
        pointRadiusPx: 8,
      },
    });

    expect(result.success).toBe(false);
  });
});
