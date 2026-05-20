import { describe, expect, it } from "vitest";
import { PersistedRootSchema, TextRunModuleSchema } from "./persistence";

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
        "user-preferences": { moduleVersion: 1, payload: {} },
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
                      items: [
                        {
                          id: "a1",
                          kind: "glyph",
                          glyphName: "A",
                          codepoint: 65,
                        },
                        {
                          id: "b1",
                          kind: "glyph",
                          glyphName: "B",
                          codepoint: 66,
                        },
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
            items: [{ id: "a1", kind: "glyph", glyphName: "A", codepoint: 65 }],
            cursor: "1",
            anchor: 0,
            originX: 0,
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });
});
