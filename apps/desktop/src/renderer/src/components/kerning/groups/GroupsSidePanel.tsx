import { useState } from "react";
import type { KerningPairPosition } from "@shift/editor/model";
import { useSignalState } from "@shift/editor/signals";
import type { KerningGroupId } from "@shift/types";
import { Button, Check } from "@shift/ui";
import { useEditor } from "@/workspace/WorkspaceContext";
import { SidePanel } from "./SidePanel";

const GROUP_LIST_TITLE: Readonly<Record<KerningPairPosition, string>> = {
  first: "Right groups",
  second: "Left groups",
};

interface GroupsSidePanelProps {
  readonly position: KerningPairPosition;
  /** The group the panel shows now, ticked in the list. */
  readonly shown: KerningGroupId | null;
  readonly onPick: (groupId: KerningGroupId) => void;
  readonly onClose: () => void;
}

/** The groups at one pair position with their member counts; picking one shows it. */
export function GroupsSidePanel({ position, shown, onPick, onClose }: GroupsSidePanelProps) {
  const editor = useEditor();
  const kerning = useSignalState(editor.font.kerningCell);
  const [query, setQuery] = useState("");
  const typed = query.trim().toLowerCase();
  const groups = kerning.groups
    .atPosition(position)
    .filter((group) => !typed || group.name.toLowerCase().includes(typed));

  return (
    <SidePanel
      title={GROUP_LIST_TITLE[position]}
      searchLabel="Search groups"
      query={query}
      onQueryChange={setQuery}
      onClose={onClose}
    >
      <ul>
        {groups.map((group) => (
          <li key={group.id}>
            <Button
              type="button"
              variant="row"
              isActive={group.id === shown}
              className="h-7 justify-between"
              onClick={() => onPick(group.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex w-3 shrink-0 justify-center">
                  {group.id === shown ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="truncate">{group.name}</span>
              </span>
              <span className="shrink-0 text-ui text-muted tabular-nums">
                {group.glyphIds.length}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {groups.length === 0 ? <p className="px-2 py-1 text-ui text-muted">No groups</p> : null}
    </SidePanel>
  );
}
