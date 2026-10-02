import { describe, expect, it } from "vitest";
import { viewResumeCaptureDecision } from "./viewResumeCapture";

describe("viewResumeCaptureDecision", () => {
  it("captures on first change", () => {
    expect(viewResumeCaptureDecision(null, 1_000, false)).toEqual({
      kind: "capture",
      reason: "state-changed",
    });
  });

  it("skips within the debounce window", () => {
    expect(viewResumeCaptureDecision(1_000, 1_200, false)).toEqual({
      kind: "skip",
      reason: "within-debounce",
    });
  });

  it("captures after the debounce window", () => {
    expect(viewResumeCaptureDecision(1_000, 1_600, false)).toEqual({
      kind: "capture",
      reason: "state-changed",
    });
  });

  it("flush forces capture inside the debounce window", () => {
    expect(viewResumeCaptureDecision(1_000, 1_100, true)).toEqual({
      kind: "capture",
      reason: "flushed",
    });
  });
});
