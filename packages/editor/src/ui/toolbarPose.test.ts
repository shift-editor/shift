import { describe, expect, it } from "vitest";
import {
  allowedDocksInFrame,
  fitDockToFrame,
  isShortToolbarFrame,
  oppositeDock,
  poseAngle,
  poseForDock,
} from "./toolbarPose";

const LENGTH = 320;

describe("the bar swings a quarter turn about its handle", () => {
  it("lies flat on the top and bottom edges", () => {
    expect(poseForDock("top")).toBe("flat");
    expect(poseForDock("bottom")).toBe("flat");
  });

  it("stands on both side edges, so crossing between them does not turn it", () => {
    expect(poseForDock("left")).toBe("stand");
    expect(poseForDock("right")).toBe("stand");
  });
});

describe("each slot has one across the canvas", () => {
  it("pairs top with bottom and left with right, keeping the pose", () => {
    expect(oppositeDock("top")).toBe("bottom");
    expect(oppositeDock("bottom")).toBe("top");
    expect(oppositeDock("left")).toBe("right");
    expect(oppositeDock("right")).toBe("left");
  });
});

describe("a short frame only fits the bar lying flat", () => {
  it("is short when the standing bar and its insets would not fit", () => {
    expect(isShortToolbarFrame({ width: 1000, height: LENGTH + 23 }, LENGTH)).toBe(true);
    expect(isShortToolbarFrame({ width: 1000, height: LENGTH + 24 }, LENGTH)).toBe(false);
  });

  it("offers only the top and bottom slots", () => {
    expect(allowedDocksInFrame({ width: 1000, height: LENGTH + 23 }, LENGTH)).toEqual([
      "bottom",
      "top",
    ]);
    expect(allowedDocksInFrame({ width: 1000, height: LENGTH + 24 }, LENGTH)).toHaveLength(4);
  });
});

describe("a remembered side dock gives way in a frame too short for it", () => {
  const short = { width: 1000, height: LENGTH + 23 };
  const tall = { width: 1000, height: LENGTH + 24 };

  it("shows a side dock on the bottom edge when the frame is short", () => {
    expect(fitDockToFrame("left", short, LENGTH)).toBe("bottom");
    expect(fitDockToFrame("right", short, LENGTH)).toBe("bottom");
  });

  it("leaves the top and bottom docks alone, and every dock in a tall frame", () => {
    expect(fitDockToFrame("top", short, LENGTH)).toBe("top");
    expect(fitDockToFrame("bottom", short, LENGTH)).toBe("bottom");
    expect(fitDockToFrame("left", tall, LENGTH)).toBe("left");
  });
});

describe("a standing bar is a flat bar turned about its handle", () => {
  it("leaves a flat bar unturned", () => {
    expect(poseAngle("flat")).toBe(0);
  });

  it("turns a standing bar a quarter clockwise, so the handle swings from 9 to 12 o'clock", () => {
    expect(poseAngle("stand")).toBe(90);
  });
});
