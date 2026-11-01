import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECENT_DOCUMENTS_LIMIT, RecentDocuments } from "./RecentDocuments";

describe("RecentDocuments", () => {
  let root: string;
  let storePath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "shift-recents-"));
    storePath = path.join(root, "recent-documents.json");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function font(name: string): string {
    const filePath = path.join(root, name);
    fs.writeFileSync(filePath, "");
    return filePath;
  }

  const paths = (recents: RecentDocuments) => recents.list().map((document) => document.path);

  it("lists files newest first and moves a reopened file to the front", () => {
    const recents = new RecentDocuments(storePath);
    const a = font("A.otf");
    const b = font("B.otf");

    recents.record({ path: a, documentId: null }, 1);
    recents.record({ path: b, documentId: null }, 2);
    recents.record({ path: a, documentId: null }, 3);

    expect(paths(recents)).toEqual([a, b]);
  });

  it("replaces a moved .shift document's old entry by DocumentId", () => {
    const recents = new RecentDocuments(storePath);
    const original = font("Fraunces.shift");
    const moved = font("Fraunces Copy.shift");

    recents.record({ path: original, documentId: "doc-1" }, 1);
    recents.record({ path: moved, documentId: "doc-1" }, 2);

    expect(paths(recents)).toEqual([moved]);
  });

  it(`keeps at most ${RECENT_DOCUMENTS_LIMIT} files, dropping the oldest`, () => {
    const recents = new RecentDocuments(storePath);
    for (let index = 0; index <= RECENT_DOCUMENTS_LIMIT; index++) {
      recents.record({ path: font(`F${index}.otf`), documentId: null }, index);
    }

    expect(paths(recents)).toHaveLength(RECENT_DOCUMENTS_LIMIT);
    expect(paths(recents)).not.toContain(path.join(root, "F0.otf"));
  });

  it("survives a relaunch", () => {
    const a = font("A.glyphs");
    new RecentDocuments(storePath).record({ path: a, documentId: null }, 5);

    expect(new RecentDocuments(storePath).list()).toEqual([
      {
        path: a,
        documentId: null,
        openedAt: 5,
        location: root,
        missing: false,
        specimen: null,
        preview: { status: "pending" },
      },
    ]);
  });

  it("starts empty when the stored list is unreadable", () => {
    fs.writeFileSync(storePath, "{not json");

    expect(new RecentDocuments(storePath).list()).toEqual([]);
  });

  it("marks files that no longer exist as missing", () => {
    const recents = new RecentDocuments(storePath);
    const gone = font("Gone.ttf");
    recents.record({ path: gone, documentId: null }, 1);

    fs.rmSync(gone);

    expect(recents.list()[0].missing).toBe(true);
  });

  it("restores a removed file to its original position", () => {
    const recents = new RecentDocuments(storePath);
    const [a, b, c] = ["A.otf", "B.otf", "C.otf"].map(font);
    recents.record({ path: a, documentId: null }, 1);
    recents.record({ path: b, documentId: null }, 2);
    recents.record({ path: c, documentId: null }, 3);

    const removed = recents.remove(b);
    expect(paths(recents)).toEqual([c, a]);

    recents.restore(removed!);
    expect(paths(recents)).toEqual([c, b, a]);
  });

  const specimen = {
    text: "Ag",
    outline: "M0 0L10 0L10 -10Z",
    viewBox: [0, -10, 10, 10],
    rightToLeft: false,
    unitsPerEm: 1000,
  };

  it("caches a specimen until a font file changes outside Shift", () => {
    const recents = new RecentDocuments(storePath);
    const otf = font("London.otf");
    recents.record({ path: otf, documentId: null }, 1);
    expect(recents.needsSpecimen({ path: otf, documentId: null })).toBe(true);

    recents.setSpecimen({ path: otf, documentId: null }, specimen);
    expect(new RecentDocuments(storePath).list()[0].specimen).toEqual(specimen);
    expect(recents.needsSpecimen({ path: otf, documentId: null })).toBe(false);

    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(otf, later, later);
    expect(recents.list()[0].specimen).toBeNull();
    expect(recents.needsSpecimen({ path: otf, documentId: null })).toBe(true);
  });

  it("says whether a recent file's preview is pending, drawn or drew nothing", () => {
    const recents = new RecentDocuments(storePath);
    const otf = font("London.otf");
    const ttf = font("Blank.ttf");
    recents.record({ path: otf, documentId: null }, 1);
    recents.record({ path: ttf, documentId: null }, 2);
    const previews = () => Object.fromEntries(recents.list().map((d) => [d.path, d.preview]));
    expect(previews()[otf]).toEqual({ status: "pending" });

    recents.setSpecimen({ path: otf, documentId: null }, specimen);
    recents.setSpecimen({ path: ttf, documentId: null }, null);
    expect(previews()[otf]).toEqual({ status: "ready" });
    expect(previews()[ttf]).toEqual({ status: "empty" });
  });

  it("keeps why a preview failed until the file changes", () => {
    const recents = new RecentDocuments(storePath);
    const otf = font("Broken.otf");
    const visit = { path: otf, documentId: null };
    recents.record(visit, 1);

    recents.setSpecimenFailure(visit, "store schema version 9 is newer than supported version 4");
    const [document] = new RecentDocuments(storePath).list();
    expect(document.specimen).toBeNull();
    expect(document.preview).toEqual({
      status: "failed",
      error: "store schema version 9 is newer than supported version 4",
    });
    expect(recents.needsSpecimen(visit)).toBe(false);

    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(otf, later, later);
    expect(recents.list()[0].preview).toEqual({ status: "pending" });
    expect(recents.needsSpecimen(visit)).toBe(true);
  });

  it("shows a specimen built under older rules until the file is opened again", () => {
    const otf = font("London.otf");
    const modifiedAt = fs.statSync(otf).mtimeMs;
    const stale = {
      path: otf,
      documentId: null,
      openedAt: 1,
      thumbnail: { specimen, modifiedAt, revision: 1 },
    };
    fs.writeFileSync(storePath, JSON.stringify([stale]));

    const recents = new RecentDocuments(storePath);
    expect(recents.list()[0].specimen).toEqual(specimen);
    expect(recents.needsSpecimen({ path: otf, documentId: null })).toBe(true);
  });

  it("keeps a .shift document's specimen when it is reopened from a new path", () => {
    const recents = new RecentDocuments(storePath);
    const original = font("Fraunces.shift");
    const moved = font("Moved.shift");
    recents.record({ path: original, documentId: "doc-1" }, 1);
    recents.setSpecimen({ path: original, documentId: "doc-1" }, specimen);

    recents.record({ path: moved, documentId: "doc-1" }, 2);

    expect(recents.list()).toEqual([
      {
        path: moved,
        documentId: "doc-1",
        openedAt: 2,
        location: root,
        missing: false,
        specimen,
        preview: { status: "ready" },
      },
    ]);
  });

  it("shows a file's folder with the home directory shortened to ~", () => {
    const home = path.dirname(root);
    const recents = new RecentDocuments(storePath, home);
    recents.record({ path: font("A.otf"), documentId: null }, 1);

    expect(recents.list()[0].location).toBe(`~/${path.basename(root)}`);
  });

  it("clears every file", () => {
    const recents = new RecentDocuments(storePath);
    recents.record({ path: font("A.otf"), documentId: null }, 1);

    recents.clear();

    expect(new RecentDocuments(storePath).list()).toEqual([]);
  });

  it("reports files still open when Shift last stopped, once", () => {
    const recents = new RecentDocuments(storePath);
    const open = { path: font("Open.shift"), documentId: "doc-1" };
    const closed = { path: font("Closed.shift"), documentId: "doc-2" };
    recents.record(closed, 1);
    recents.record(open, 2);
    recents.setOpen(closed, true);
    recents.setOpen(open, true);

    recents.setOpen(closed, false);

    expect(new RecentDocuments(storePath).takeOpen()).toEqual([open]);
    expect(new RecentDocuments(storePath).takeOpen()).toEqual([]);
  });

  it("reports nothing open after a normal quit", () => {
    const recents = new RecentDocuments(storePath);
    const document = { path: font("Fraunces.shift"), documentId: "doc-1" };
    recents.record(document, 1);
    recents.setOpen(document, true);

    recents.clearOpen();

    expect(new RecentDocuments(storePath).takeOpen()).toEqual([]);
  });
});
