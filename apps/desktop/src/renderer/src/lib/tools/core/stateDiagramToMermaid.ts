import type { StateDiagram } from "./StateDiagram";

export function stateDiagramToMermaid(spec: StateDiagram, highlightState?: string): string {
  const lines = ["stateDiagram-v2"];
  lines.push(`  [*] --> ${spec.initial}`);

  for (const t of spec.transitions) {
    lines.push(`  ${t.from} --> ${t.to}: ${t.event}`);
  }

  if (highlightState && spec.states.includes(highlightState)) {
    lines.push(`  classDef active fill:#f96,stroke:#333,stroke-width:2px`);
    lines.push(`  class ${highlightState} active`);
  }

  return lines.join("\n");
}
