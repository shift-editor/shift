import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { JSHandle, Page, TestInfo } from "@playwright/test";
import * as AnimationFrames from "@paulirish/trace_engine/models/trace/handlers/AnimationFramesHandler.js";
import { defaults } from "@paulirish/trace_engine/models/trace/types/Configuration.js";
import type { Event as TraceEvent } from "@paulirish/trace_engine/models/trace/types/TraceEvents.js";
import { findGeometryPresentation } from "../../src/renderer/src/testing/findGeometryPresentation";
import type { SubmittedGeometry } from "../../src/renderer/src/types/rendering";

/**
 * Measures trusted input to Chromium presentation of verified submitted geometry.
 *
 * @remarks
 * Runs sequentially in a visible E2E window; the DevTools handler uses shared
 * tables. An untimed synchronous draw must finish with non-matching submitted
 * geometry before input. The timed probe reads the borrowed uploaded-buffer view,
 * never pixels or model coordinates as a substitute. Browser frame identities
 * join submissions to presentation feedback, a platform-dependent estimate.
 *
 * @param page - Visible editor page; no other tracing session may be active.
 * @param testInfo - Receives the raw trace, final screenshot, and timing evidence.
 * @param exercise - Dispatches one input and verifies its authored geometry outcome.
 * @param matchesFrame - Caller-owned synchronous browser predicate. Its borrowed
 *   argument is valid only during invocation; null denotes a cleared marker surface.
 * @param inputType - Event that starts the edit; pointer release commits a Pen click.
 * @returns Input-to-presented-geometry latency in milliseconds, including probe and
 *   tracing overhead but excluding baseline preparation.
 * @throws {Error} When the baseline is missing or already matches, relevant input,
 *   submission or presentation evidence is invalid, or exercise/transport fails.
 */
export async function measureGeometryPresentation(
  page: Page,
  testInfo: TestInfo,
  exercise: () => Promise<void>,
  matchesFrame: JSHandle<(geometry: SubmittedGeometry | null) => boolean>,
  inputType: "pointerup" | "keydown" = "pointerup",
): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  const events: TraceEvent[] = [];
  try {
    const probe = await page.evaluateHandle(
      ({ inputType, matchesFrame }) => {
        const controller = new AbortController();
        const errors: string[] = [];
        performance.clearMarks("inputToGeometryFrameMs");
        performance.clearMarks("shift:geometry-submitted");
        document.addEventListener(
          inputType,
          (event) => {
            if (!event.isTrusted) return;

            performance.mark("inputToGeometryFrameMs", { startTime: event.timeStamp });
          },
          { capture: true, signal: controller.signal },
        );
        window.addEventListener(
          "shift:geometry-submitted",
          (event) => {
            try {
              performance.mark("shift:geometry-submitted", { detail: matchesFrame(event.detail) });
            } catch (error) {
              errors.push(String(error));
            }
          },
          { signal: controller.signal },
        );
        return { controller, errors };
      },
      { inputType, matchesFrame },
    );

    try {
      await probe.evaluate(({ errors }) => {
        window.dispatchEvent(new Event("shift:request-scene-render"));
        if (errors.length) throw new Error(`Geometry verification failed: ${errors.join("; ")}`);

        const baseline = performance.getEntriesByName("shift:geometry-submitted", "mark").at(-1);
        if (!(baseline instanceof PerformanceMark) || typeof baseline.detail !== "boolean") {
          throw new Error("No submitted geometry baseline was observed");
        }
        if (baseline.detail) throw new Error("Expected geometry already matches before input");
      });

      await cdp.send("Tracing.start", {
        categories: "-*,devtools.timeline,blink.user_timing",
        transferMode: "ReturnAsStream",
      });
      try {
        await exercise();
        // Drain rendering/feedback; neither rAF nor the screenshot is the timing endpoint.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
        );
        await testInfo.attach("geometry-after-input", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      } finally {
        const complete = new Promise<string | undefined>((resolve) =>
          cdp.once("Tracing.tracingComplete", ({ stream }) => resolve(stream)),
        );
        await cdp.send("Tracing.end");
        const stream = await complete;
        if (!stream) throw new Error("Chromium did not return a trace stream");

        let contents = "";
        try {
          while (true) {
            const chunk = await cdp.send("IO.read", { handle: stream });
            contents += chunk.base64Encoded
              ? Buffer.from(chunk.data, "base64").toString("utf8")
              : chunk.data;
            if (chunk.eof) break;
          }
        } finally {
          await cdp.send("IO.close", { handle: stream });
        }
        const captured: TraceEvent[] = JSON.parse(contents).traceEvents;
        events.push(...captured);
        const path = testInfo.outputPath(`geometry-presentation-${randomUUID()}.json`);
        writeFileSync(path, contents);
        await testInfo.attach("geometry-presentation-trace", {
          path,
          contentType: "application/json",
        });
      }

      const errors = await probe.evaluate(({ errors }) => errors);
      if (errors.length) throw new Error(`Geometry verification failed: ${errors.join("; ")}`);

      AnimationFrames.reset();
      try {
        AnimationFrames.handleUserConfig({ ...defaults(), enableAnimationsFrameHandler: true });
        for (const event of events) AnimationFrames.handleEvent(event);
        await AnimationFrames.finalize();
        const inputToGeometryFrameMs = findGeometryPresentation(events, AnimationFrames.data());
        await testInfo.attach("geometry-presentation-timing", {
          body: JSON.stringify({ inputToGeometryFrameMs }),
          contentType: "application/json",
        });
        return inputToGeometryFrameMs;
      } finally {
        AnimationFrames.reset();
      }
    } finally {
      try {
        await probe.evaluate(({ controller }) => {
          controller.abort();
          performance.clearMarks("inputToGeometryFrameMs");
          performance.clearMarks("shift:geometry-submitted");
        });
      } finally {
        await probe.dispose();
      }
    }
  } finally {
    await cdp.detach();
  }
}
