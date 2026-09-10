import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as AnimationFrames from "@paulirish/trace_engine/models/trace/handlers/AnimationFramesHandler.js";
import { defaults } from "@paulirish/trace_engine/models/trace/types/Configuration.js";
import {
  isAnimationFramePresentation,
  isPerformanceMark,
  type Event as TraceEvent,
} from "@paulirish/trace_engine/models/trace/types/TraceEvents.js";
import { findGeometryPresentation } from "./findGeometryPresentation";

let events: TraceEvent[];

beforeEach(() => {
  events = JSON.parse(
    readFileSync(new URL("./fixtures/geometry-presentation.json", import.meta.url), "utf8"),
  ).traceEvents;
  AnimationFrames.reset();
  AnimationFrames.handleUserConfig({ ...defaults(), enableAnimationsFrameHandler: true });
});

afterEach(() => AnimationFrames.reset());

async function presentation(): Promise<number> {
  for (const event of events) AnimationFrames.handleEvent(event);
  await AnimationFrames.finalize();
  return findGeometryPresentation(events, AnimationFrames.data());
}

describe("geometry presentation requires relevant Chromium evidence", () => {
  it("ignores a later submission even when its frame started before presentation", async () => {
    events = JSON.parse(
      readFileSync(
        new URL("./fixtures/geometry-submission-after-presentation.json", import.meta.url),
        "utf8",
      ),
    ).traceEvents;
    expect(await presentation()).toBe(54.842);
  });

  it("uses the final submission rather than an earlier match in the same frame", async () => {
    events = JSON.parse(
      readFileSync(
        new URL("./fixtures/geometry-submission-after-presentation.json", import.meta.url),
        "utf8",
      ),
    ).traceEvents;
    const feedback = events
      .filter(isAnimationFramePresentation)
      .find((event) => event.args?.id === "677de5228f2e2f84")!;
    events = events.filter((event) => event.ts <= feedback.ts);
    for (const draw of events
      .filter(isPerformanceMark)
      .filter((event) => event.name === "shift:geometry-submitted")) {
      draw.args.data!.detail = draw.args.data!.detail === "true" ? "false" : "true";
    }
    await expect(presentation()).rejects.toThrow(
      "No presented frame contains the expected geometry",
    );
  });

  it("finds the first presentation despite a later redraw without feedback", async () => {
    expect(await presentation()).toBe(45.98);
  });

  it("rejects missing earlier feedback rather than choosing a later presentation", async () => {
    events = events.filter(
      (event) => !isAnimationFramePresentation(event) || event.args?.id !== "07323c85a96ddd1c",
    );
    await expect(presentation()).rejects.toThrow("Verified frame has no presentation feedback");
  });

  it("rejects incomplete earlier browser frames", async () => {
    const end = events.find((event) => event.name === "AnimationFrame" && event.ph === "e")!;
    events = events.filter((event) => event !== end);
    await expect(presentation()).rejects.toThrow(
      "Verified geometry is not inside a recorded browser frame",
    );
  });

  it("requires exactly one input", async () => {
    events = events.filter((event) => event.name !== "inputToGeometryFrameMs");
    await expect(presentation()).rejects.toThrow("Expected exactly one recorded input");
  });

  it("rejects ambiguous input", async () => {
    events.push(events.find((event) => event.name === "inputToGeometryFrameMs")!);
    await expect(presentation()).rejects.toThrow("Expected exactly one recorded input");
  });

  it("rejects geometry marks without boolean verification", async () => {
    const draw = events
      .filter(isPerformanceMark)
      .find((event) => event.name === "shift:geometry-submitted")!;
    delete draw.args.data?.detail;
    await expect(presentation()).rejects.toThrow("Geometry verification is not a recorded boolean");
  });

  it("does not substitute a presented frame for non-matching geometry", async () => {
    const feedback = events
      .filter(isAnimationFramePresentation)
      .find((event) => event.args?.id === "07323c85a96ddd1c")!;
    events = events.filter((event) => event.ts <= feedback.ts);
    const draw = events
      .filter(isPerformanceMark)
      .find((event) => event.name === "shift:geometry-submitted")!;
    draw.args.data!.detail = "false";
    await expect(presentation()).rejects.toThrow(
      "No presented frame contains the expected geometry",
    );
  });

  it("excludes zero-identity no-swap feedback", async () => {
    const feedback = events
      .filter(isAnimationFramePresentation)
      .find((event) => event.args?.id === "07323c85a96ddd1c")!;
    events = events.filter((event) => event.ts <= feedback.ts);
    const noSwap = events
      .filter(isAnimationFramePresentation)
      .find((event) => event.args?.id === "07323c85a96ddceb")!;
    Object.assign(feedback.args!, noSwap.args, { id: feedback.args!.id });
    await expect(presentation()).rejects.toThrow(
      "No presented frame contains the expected geometry",
    );
  });

  it("rejects malformed presented-frame identities", async () => {
    const feedback = events
      .filter(isAnimationFramePresentation)
      .find((event) => event.args?.id === "07323c85a96ddd1c")!;
    Object.assign(feedback.args!, { begin_frame_id: { source_id: 1.5, sequence_number: 92 } });
    await expect(presentation()).rejects.toThrow("Presented frame identity is invalid");
  });
});
