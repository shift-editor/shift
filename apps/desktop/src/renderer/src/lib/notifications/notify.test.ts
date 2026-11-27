import { describe, expect, it } from "vitest";
import { appNotificationCell, notify } from "./notify";

describe("notify", () => {
  it("publishes the message as the latest notification", () => {
    notify("Select a contour first.");

    expect(appNotificationCell.peek()).toEqual({ message: "Select a contour first." });
  });

  it("publishes a new notification each time, even for the same message", () => {
    notify("Select a contour first.");
    const first = appNotificationCell.peek();

    notify("Select a contour first.");

    expect(appNotificationCell.peek()).not.toBe(first);
  });
});
