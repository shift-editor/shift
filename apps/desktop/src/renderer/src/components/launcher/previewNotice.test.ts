import { describe, expect, it } from "vitest";
import { previewNotice } from "./previewNotice";

describe("previewNotice", () => {
  it("says nothing while a preview is being built or once it is", () => {
    expect(previewNotice({ status: "pending" })).toBeNull();
    expect(previewNotice({ status: "ready" })).toBeNull();
  });

  it("says a font that draws nothing has no preview", () => {
    expect(previewNotice({ status: "empty" })).toEqual({
      title: "No preview",
      detail: "This font draws no glyphs yet",
    });
  });

  it("says a document from a newer Shift can't be previewed", () => {
    const notice = previewNotice({
      status: "failed",
      error: "store schema version 9 is newer than supported version 4",
    });
    expect(notice?.detail).toBe("Made with a newer version of Shift");
  });

  it("says any other failure couldn't read the font", () => {
    const notice = previewNotice({ status: "failed", error: "No such file or directory" });
    expect(notice).toEqual({ title: "No preview", detail: "Shift couldn't read this font" });
  });
});
