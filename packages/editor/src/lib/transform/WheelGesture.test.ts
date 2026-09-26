import { describe, expect, it } from "vitest";
import { WheelGesture } from "./WheelGesture";

const zoom = (timeStamp: number) => ({ timeStamp, zoomModifier: true });
const scroll = (timeStamp: number) => ({ timeStamp, zoomModifier: false });

describe("wheel gestures keep released-modifier zoom momentum from panning", () => {
  it("pans without a preceding zoom", () => {
    expect(new WheelGesture(120).classify(scroll(0))).toBe("pan");
  });

  it("ignores unmodified samples that continue a zoom gesture", () => {
    const gesture = new WheelGesture(120);

    expect(gesture.classify(zoom(0))).toBe("zoom");
    expect(gesture.classify(scroll(50))).toBe("ignore");
    expect(gesture.classify(scroll(160))).toBe("ignore");
  });

  it("pans once the gesture has been quiet for the idle period", () => {
    const gesture = new WheelGesture(120);

    gesture.classify(zoom(0));
    gesture.classify(scroll(50));

    expect(gesture.classify(scroll(170))).toBe("pan");
    expect(gesture.classify(scroll(171))).toBe("pan");
  });

  it("restarts the gesture when the modifier returns", () => {
    const gesture = new WheelGesture(120);

    gesture.classify(zoom(0));
    gesture.classify(scroll(500));

    expect(gesture.classify(zoom(510))).toBe("zoom");
    expect(gesture.classify(scroll(520))).toBe("ignore");
  });
});
