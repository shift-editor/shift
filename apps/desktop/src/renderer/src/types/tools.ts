import type { ToolName } from "@/lib/tools/core";

export type { ToolManifest } from "@/lib/tools/core";

export type ToolShortcutEntry = {
  toolId: ToolName;
  shortcut: string;
};
