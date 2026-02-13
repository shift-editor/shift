import type { ToolManifest, ToolName } from "@/lib/tools/core";

export type ToolDescriptor = ToolManifest;

export type ToolShortcutEntry = {
  toolId: ToolName;
  shortcut: string;
};
