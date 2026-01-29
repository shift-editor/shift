import { describe, it, expect } from "vitest";
import { defineStateDiagram, type StateDiagram } from "./StateDiagram";
import { stateDiagramToMermaid } from "./stateDiagramToMermaid";

describe("StateDiagram", () => {
  describe("defineStateDiagram", () => {
    it("creates a valid state diagram", () => {
      const diagram = defineStateDiagram({
        states: ["idle", "ready", "active"],
        initial: "idle",
        transitions: [
          { from: "idle", to: "ready", event: "activate" },
          { from: "ready", to: "active", event: "start" },
        ],
      });

      expect(diagram.states).toEqual(["idle", "ready", "active"]);
      expect(diagram.initial).toBe("idle");
      expect(diagram.transitions).toHaveLength(2);
    });

    it("enforces type safety for state names", () => {
      type TestState = { type: "a" | "b" | "c" };

      const diagram = defineStateDiagram<TestState["type"]>({
        states: ["a", "b", "c"],
        initial: "a",
        transitions: [
          { from: "a", to: "b", event: "next" },
          { from: "b", to: "c", event: "next" },
        ],
      });

      expect(diagram.states).toContain("a");
      expect(diagram.states).toContain("b");
      expect(diagram.states).toContain("c");
    });
  });

  describe("stateDiagramToMermaid", () => {
    const simpleDiagram: StateDiagram = {
      states: ["idle", "ready", "active"],
      initial: "idle",
      transitions: [
        { from: "idle", to: "ready", event: "activate" },
        { from: "ready", to: "active", event: "start" },
        { from: "active", to: "idle", event: "stop" },
      ],
    };

    it("generates basic mermaid syntax", () => {
      const mermaid = stateDiagramToMermaid(simpleDiagram);

      expect(mermaid).toContain("stateDiagram-v2");
      expect(mermaid).toContain("[*] --> idle");
      expect(mermaid).toContain("idle --> ready: activate");
      expect(mermaid).toContain("ready --> active: start");
      expect(mermaid).toContain("active --> idle: stop");
    });

    it("adds highlighting for current state", () => {
      const mermaid = stateDiagramToMermaid(simpleDiagram, "ready");

      expect(mermaid).toContain("classDef active fill:#f96,stroke:#333,stroke-width:2px");
      expect(mermaid).toContain("class ready active");
    });

    it("does not add highlighting for invalid state", () => {
      const mermaid = stateDiagramToMermaid(simpleDiagram, "nonexistent");

      expect(mermaid).not.toContain("classDef active");
      expect(mermaid).not.toContain("class");
    });

    it("does not add highlighting when no state provided", () => {
      const mermaid = stateDiagramToMermaid(simpleDiagram);

      expect(mermaid).not.toContain("classDef active");
    });

    it("handles empty transitions", () => {
      const diagram: StateDiagram = {
        states: ["idle"],
        initial: "idle",
        transitions: [],
      };

      const mermaid = stateDiagramToMermaid(diagram);

      expect(mermaid).toContain("stateDiagram-v2");
      expect(mermaid).toContain("[*] --> idle");
    });
  });
});
