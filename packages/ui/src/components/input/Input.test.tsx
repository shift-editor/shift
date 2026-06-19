import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "./Input";

afterEach(cleanup);

describe("Input text editing shortcuts", () => {
  it("selects all text on command-a", () => {
    render(<Input aria-label="Axis name" defaultValue="Weight" />);
    const input = screen.getByLabelText("Axis name") as HTMLInputElement;

    input.focus();
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: "a", metaKey: true });

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Weight".length);
  });

  it("selects all text on control-a", () => {
    render(<Input aria-label="Axis name" defaultValue="Weight" />);
    const input = screen.getByLabelText("Axis name") as HTMLInputElement;

    input.focus();
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: "a", ctrlKey: true });

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Weight".length);
  });

  it("lets callers override select-all handling", () => {
    render(
      <Input
        aria-label="Axis name"
        defaultValue="Weight"
        onKeyDown={(event) => event.preventDefault()}
      />,
    );
    const input = screen.getByLabelText("Axis name") as HTMLInputElement;

    input.focus();
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: "a", metaKey: true });

    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);
  });
});
