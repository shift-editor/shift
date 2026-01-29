import { renderMermaid, type RenderOptions } from "beautiful-mermaid";
import type { StateDiagram } from "./StateDiagram";
import { stateDiagramToMermaid } from "./stateDiagramToMermaid";

export async function renderStateDiagram(
  spec: StateDiagram,
  currentState?: string,
  options?: RenderOptions,
): Promise<string> {
  const mermaid = stateDiagramToMermaid(spec, currentState);
  return renderMermaid(mermaid, options);
}
