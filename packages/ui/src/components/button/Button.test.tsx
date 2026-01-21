import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("renders children correctly", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });

  it("handles click events", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    fireEvent.click(screen.getByText("Click me"));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it("applies default variant styles", () => {
    render(<Button>Default</Button>);
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-surface");
  });

  it("applies ghost variant styles", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const button = screen.getByRole("button");
    expect(button.className).toContain("hover:bg-surface-hover");
    expect(button.className).not.toContain("border");
  });

  it("applies toolbar variant styles", () => {
    render(<Button variant="toolbar">Toolbar</Button>);
    const button = screen.getByRole("button");
    expect(button.className).toContain("hover:bg-toolbar-hover");
  });

  it("applies active state styles", () => {
    render(
      <Button variant="toolbar" isActive>
        Active
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("data-[active=true]:bg-toolbar-hover");
    expect(button).toHaveAttribute("data-active", "true");
  });

  it("applies size styles correctly", () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button").className).toContain("h-7");

    rerender(<Button size="icon">Icon</Button>);
    expect(screen.getByRole("button").className).toContain("h-8");
    expect(screen.getByRole("button").className).toContain("w-8");
  });

  it("is disabled when disabled prop is set", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("merges custom className with default styles", () => {
    render(<Button className="custom-class">Custom</Button>);
    const button = screen.getByRole("button");
    expect(button.className).toContain("custom-class");
    expect(button.className).toContain("rounded");
  });

  it("renders icon when provided", () => {
    render(<Button icon={<svg data-testid="test-icon" />}>With Icon</Button>);
    expect(screen.getByTestId("test-icon")).toBeInTheDocument();
    expect(screen.getByText("With Icon")).toBeInTheDocument();
  });

  it("renders icon-only button correctly", () => {
    render(
      <Button
        size="icon"
        icon={<svg data-testid="test-icon" />}
        aria-label="Icon button"
      />,
    );
    expect(screen.getByTestId("test-icon")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Icon button",
    );
  });
});
