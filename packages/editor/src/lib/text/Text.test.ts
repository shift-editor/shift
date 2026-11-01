import { describe, expect, it } from "vitest";
import { mintRunId } from "@shift/types";
import { ShiftStore } from "../store/ShiftStore";
import { startEmptyMemorySession } from "../../testing/emptyMemorySession";
import type { ShiftEditorRecord } from "../../types/records";
import type { StoredTextRunRecord } from "../../types/text";
import { Text } from "./Text";

/** A run as saved before runs had settings: its items alone. */
function runWithoutSettings(): StoredTextRunRecord {
  return { id: mintRunId(), type: "textrun", scope: "document", items: [] };
}

describe("a run saved before runs had settings", () => {
  it("reads every missing setting as its default, and takes a new one", () => {
    const { editor } = startEmptyMemorySession();
    const saved = runWithoutSettings();
    const text = new Text(new ShiftStore<ShiftEditorRecord>([saved]), editor);
    expect(text.run(saved.id)).toMatchObject({ shaping: true });

    text.setShaping(saved.id, false);

    expect(text.run(saved.id)).toMatchObject({ shaping: false });
  });

  it("lays out", async () => {
    const { editor } = startEmptyMemorySession();
    const saved = runWithoutSettings();
    const text = new Text(new ShiftStore<ShiftEditorRecord>([saved]), editor);

    await expect.poll(() => text.layout(saved.id)?.lines.length).toBe(0);
  });
});
