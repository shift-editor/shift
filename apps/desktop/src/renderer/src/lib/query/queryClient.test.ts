import { describe, expect, it } from "vitest";
import { createRendererQueryClient } from "./queryClient";

describe("renderer queries use the local workspace lifecycle", () => {
  it("does not depend on browser connectivity, focus, or automatic retries", () => {
    const defaults = createRendererQueryClient().getDefaultOptions().queries;

    expect(defaults).toMatchObject({
      networkMode: "always",
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
    });
  });
});
