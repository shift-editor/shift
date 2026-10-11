import { useEffect, useMemo, useState } from "react";
import type { KerningPairPosition } from "@shift/editor/model";
import { useSignalState } from "@shift/editor/signals";
import type { GlyphId, KerningGroupId } from "@shift/types";
import { Button } from "@shift/ui";
import { useEditor } from "@/workspace/WorkspaceContext";
import { GlyphThumbnail } from "./GlyphThumbnail";
import { memberCandidates } from "./memberSuggestions";
import { glyphName } from "./previewGlyphs";
import { SidePanel } from "./SidePanel";

interface AddMembersPanelProps {
  readonly position: KerningPairPosition;
  readonly groupId: KerningGroupId;
  readonly groupName: string;
  readonly members: readonly GlyphId[];
  readonly onClose: () => void;
}

/**
 * A glyph search beside the groups panel. Each glyph picked joins the group,
 * leaving its old one, and the search stays open to add more.
 */
export function AddMembersPanel({
  position,
  groupId,
  groupName,
  members,
  onClose,
}: AddMembersPanelProps) {
  const editor = useEditor();
  const entries = useSignalState(editor.font.glyphEntriesCell);
  const kerning = useSignalState(editor.font.kerningCell);
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const candidates = useMemo(
    () =>
      memberCandidates(
        entries,
        members,
        members.map((glyphId) => glyphName(editor, glyphId)),
        query,
        (entry) => kerning.groupOf(position, entry.id),
      ),
    [editor, entries, kerning, members, position, query],
  );

  useEffect(() => {
    editor.font.loadGlyphs(candidates.map((entry) => entry.id)).catch((error: unknown) => {
      console.error("failed to load glyphs to add", error);
    });
  }, [candidates, editor]);

  return (
    <SidePanel
      title={`Add to ${groupName}`}
      searchLabel="Search glyphs"
      query={query}
      onQueryChange={setQuery}
      onClose={onClose}
    >
      {!searching && candidates.length > 0 ? (
        <p className="px-2 py-1 text-ui text-muted">Suggested</p>
      ) : null}
      <ul>
        {candidates.map((entry) => (
          <li key={entry.id}>
            <Button
              type="button"
              variant="row"
              className="h-8"
              onClick={() => void editor.font.assignKerningGroup(position, [entry.id], groupId)}
            >
              <GlyphThumbnail glyphId={entry.id} />
              <span className="truncate">{entry.name}</span>
            </Button>
          </li>
        ))}
      </ul>
      {searching && candidates.length === 0 ? (
        <p className="px-2 py-1 text-ui text-muted">No matching glyphs</p>
      ) : null}
    </SidePanel>
  );
}
