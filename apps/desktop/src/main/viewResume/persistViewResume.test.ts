import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asGlyphId } from "@shift/types";
import { emptySessionViewResume } from "../../shared/viewResume";
import { ViewResumePersistence, workspaceLoadHashFromResume } from "./persistViewResume";

describe("ViewResumePersistence", () => {
  it("round-trips a session payload", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shift-view-resume-"));
    const filePath = path.join(root, "view-resume.json");
    const store = new ViewResumePersistence(filePath);
    const resume = emptySessionViewResume();
    resume.catalog.query = "test";
    resume.route = { glyphName: "A", unicode: 65, glyphId: asGlyphId("glyph-a") };

    store.set("session-1", resume);
    expect(store.get("session-1")).toEqual(resume);
  });

  it("transfers resume between session ids", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shift-view-resume-"));
    const filePath = path.join(root, "view-resume.json");
    const store = new ViewResumePersistence(filePath);
    const resume = emptySessionViewResume();
    resume.route = { glyphName: "A", unicode: 65, glyphId: null };

    store.set("preview", resume);
    store.transfer("preview", "workspace");

    expect(store.get("preview")).toBeNull();
    expect(store.get("workspace")).toEqual(resume);
  });

  it("composes an editor hash when glyph id is known", () => {
    const resume = emptySessionViewResume();
    resume.route = { glyphName: "A", unicode: 65, glyphId: asGlyphId("glyph-id") };
    expect(workspaceLoadHashFromResume(resume)).toBe("/editor/glyph-id");
  });
});
