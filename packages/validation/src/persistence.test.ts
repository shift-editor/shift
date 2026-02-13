import { describe, expect, it } from "vitest";
import {
  PersistedRootSchema,
  TextRunModulePayloadSchema,
  UserPreferencesSchema,
} from "./persistence";

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
                    codepoints: [65, 66],
                    cursorPosition: 2,
                    originX: 100,
                    editingIndex: null,
                    editingUnicode: null,
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
    const result = TextRunModulePayloadSchema.safeParse({
      runsByGlyph: {
        "65": {
          codepoints: [65],
          cursorPosition: "1",
          originX: 0,
          editingIndex: null,
          editingUnicode: null,
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
