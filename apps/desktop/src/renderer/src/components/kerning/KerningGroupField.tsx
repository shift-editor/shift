import { useMemo, useRef, useState } from "react";
import type { Kerning, KerningPairPosition } from "@shift/editor/model";
import { useSignalState } from "@shift/editor/signals";
import type { GlyphId, KerningGroupId } from "@shift/types";
import {
  Button,
  Check,
  ChevronDown,
  Input,
  Plus,
  Popover,
  PopoverClose,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
  Search,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  X,
  cn,
} from "@shift/ui";
import { useEditor } from "@/workspace/WorkspaceContext";

/** The glyph edge whose group a pair position names: a first glyph's right, a second's left. */
const EDGE_LABEL: Readonly<Record<KerningPairPosition, string>> = {
  first: "right",
  second: "left",
};

const EDGE_GROUPS_TITLE: Readonly<Record<KerningPairPosition, string>> = {
  first: "Right groups",
  second: "Left groups",
};

interface KerningGroupFieldProps {
  readonly position: KerningPairPosition;
  readonly glyphId: GlyphId;
  readonly glyphName: string;
  readonly disabled: boolean;
  /** Names the field for assistive technology, saying which glyph and edge it is. */
  readonly ariaLabel: string;
}

/**
 * The kerning group a glyph belongs to at one pair position, as a field that
 * opens a panel of groups: search them, pick one to move the glyph into it
 * or "No group" to take it out, or + to create a group named after the
 * search or else the glyph. Each choice is one undo step.
 */
export function KerningGroupField({
  position,
  glyphId,
  glyphName,
  disabled,
  ariaLabel,
}: KerningGroupFieldProps) {
  const editor = useEditor();
  const kerning = useSignalState(editor.font.kerningCell);
  const currentId = kerning.groupOf(position, glyphId);
  const current = currentId ? (kerning.groups.group(currentId)?.name ?? null) : null;
  const [open, setOpen] = useState(false);
  // Whether the group name is cut off, measured when the pointer arrives.
  const valueRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      {/* The full name when the field cuts it off. */}
      <Tooltip disabled={!truncated || open || current === null}>
        <TooltipTrigger>
          <PopoverTrigger
            disabled={disabled}
            render={
              <Button
                ref={triggerRef}
                type="button"
                variant="field"
                size="field"
                isActive={open}
                aria-label={ariaLabel}
                className="h-6"
                onPointerEnter={() => {
                  const value = valueRef.current;
                  setTruncated(value !== null && value.scrollWidth > value.clientWidth);
                }}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    ref={valueRef}
                    className={
                      current === null
                        ? "min-w-0 flex-1 truncate text-center text-secondary"
                        : "min-w-0 flex-1 truncate text-left"
                    }
                  >
                    {current ?? "—"}
                  </span>
                  <span className="flex shrink-0 text-muted">
                    <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
                  </span>
                </span>
              </Button>
            }
          />
        </TooltipTrigger>
        <TooltipContent>{current}</TooltipContent>
      </Tooltip>
      <PopoverPortal>
        {/* Beside the sidebar like its other panels: right border over the sidebar's, top on the divider above the field's block. */}
        <PopoverPositioner
          anchor={() => sidebarBlock(triggerRef.current)}
          side="left"
          align="start"
          sideOffset={-1}
          alignOffset={-1}
        >
          {open ? (
            <GroupList
              position={position}
              glyphId={glyphId}
              glyphName={glyphName}
              current={currentId}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  );
}

interface GroupListProps {
  readonly position: KerningPairPosition;
  readonly glyphId: GlyphId;
  readonly glyphName: string;
  readonly current: KerningGroupId | null;
  readonly onDone: () => void;
}

/** A row of the list: a group by id and name, or "No group" with a null id. */
interface GroupChoice {
  readonly id: KerningGroupId | null;
  readonly name: string;
}

const NO_GROUP: GroupChoice = { id: null, name: "No group" };

/** The panel of groups: title with + and close, a search, then the groups. */
function GroupList({ position, glyphId, glyphName, current, onDone }: GroupListProps) {
  const editor = useEditor();
  const kerning = useSignalState(editor.font.kerningCell);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  // The name being typed for a new group, while its row is open.
  const [naming, setNaming] = useState<string | null>(null);

  const typed = query.replace(/^@/, "").trim();
  // "No group" only while not searching, so Enter on a search with no match names a new group.
  const choices = useMemo<GroupChoice[]>(() => {
    const groups: GroupChoice[] = kerning.groups.atPosition(position);
    if (!typed) return [...groups, NO_GROUP];
    const lower = typed.toLowerCase();
    return groups.filter((group) => group.name.toLowerCase().includes(lower));
  }, [kerning, position, typed]);
  const startNaming = () => setNaming(newGroupName(kerning, position, typed || glyphName));

  const choose = (choice: GroupChoice) => {
    onDone();
    if (choice.id !== current) void editor.font.assignKerningGroup(position, [glyphId], choice.id);
  };
  const create = (name: string) => {
    onDone();
    void editor.font.createKerningGroup(position, name, [glyphId]);
  };

  return (
    <PopoverPopup className="relative flex w-60 flex-col p-0" initialFocus={searchRef}>
      {naming !== null ? (
        <CreateGroupPanel
          title={`New ${EDGE_LABEL[position]} group`}
          value={naming}
          taken={naming.trim() !== "" && kerning.groups.named(position, naming.trim()) !== null}
          onChange={setNaming}
          onCancel={() => setNaming(null)}
          onCreate={create}
        />
      ) : null}
      <div className="flex h-8 items-center justify-between gap-1 border-b border-line-subtle pl-2 pr-1">
        <PopoverTitle>{EDGE_GROUPS_TITLE[position]}</PopoverTitle>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="New group"
                onClick={startNaming}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New group</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <PopoverClose variant="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </PopoverClose>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="border-b border-line-subtle p-2">
        <Input
          ref={searchRef}
          aria-label="Search kerning groups"
          icon={<Search className="h-3 w-3 text-muted" />}
          iconPosition="left"
          placeholder="Search groups"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setHighlighted((index) => clamp(index + step, 0, choices.length - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (choices.length === 0) startNaming();
              else choose(choices[highlighted] ?? NO_GROUP);
            }
          }}
        />
      </div>
      <ul
        role="listbox"
        aria-label={EDGE_GROUPS_TITLE[position]}
        className="scrollbar-hidden max-h-72 overflow-y-auto p-1"
      >
        {choices.map((group, index) => (
          <li key={group.id ?? "none"} role="option" aria-selected={group.id === current}>
            <Button
              type="button"
              variant="row"
              isActive={index === highlighted}
              className="h-7"
              onPointerEnter={() => setHighlighted(index)}
              onClick={() => choose(group)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex w-3 shrink-0 justify-center">
                  {group.id === current ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className={cn("truncate", group.id === null && "text-muted")}>
                  {group.name}
                </span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
      {typed && choices.length === 0 ? (
        <p className="px-3 pb-2 text-ui text-muted">
          No matching groups. Press Enter to name a new one.
        </p>
      ) : null}
    </PopoverPopup>
  );
}

/**
 * The padded sidebar block holding a field: the parent of its section, which
 * starts at the sidebar's inner edge just below a divider.
 */
function sidebarBlock(field: HTMLElement | null): Element | null {
  return field?.closest("section")?.parentElement ?? null;
}

interface CreateGroupPanelProps {
  readonly title: string;
  readonly value: string;
  /** Whether a group at this position already has the name. */
  readonly taken: boolean;
  readonly onChange: (value: string) => void;
  readonly onCancel: () => void;
  readonly onCreate: (name: string) => void;
}

/**
 * A small panel beside the group list for naming a new group, its top level
 * with the list's: the name starts selected so typing replaces it, Enter or
 * the button creates the group, Escape or close cancels. A blank or taken
 * name cannot be created.
 */
function CreateGroupPanel({
  title,
  value,
  taken,
  onChange,
  onCancel,
  onCreate,
}: CreateGroupPanelProps) {
  const name = value.trim();
  const creatable = name !== "" && !taken;

  return (
    <section
      aria-label={title}
      className="absolute -top-px right-full flex w-64 flex-col rounded-md border border-line-subtle bg-surface shadow-lg"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <div className="flex h-8 items-center justify-between border-b border-line-subtle pl-2 pr-1">
        <h2 className="truncate text-ui font-medium text-primary">{title}</h2>
        <Tooltip>
          <TooltipTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel"
              onClick={onCancel}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1 p-2">
        <div className="flex items-center gap-2">
          <label htmlFor="new-kerning-group-name" className="w-14 shrink-0 text-ui text-secondary">
            Name
          </label>
          <Input
            id="new-kerning-group-name"
            autoFocus
            aria-invalid={taken || undefined}
            placeholder="Group name"
            value={value}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (creatable) onCreate(name);
            }}
          />
        </div>
        {taken ? (
          <p className="pl-16 text-ui text-muted">A group is already called {name}.</p>
        ) : null}
      </div>
      <div className="flex justify-end border-t border-line-subtle p-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          aria-disabled={!creatable || undefined}
          onClick={() => {
            if (creatable) onCreate(name);
          }}
        >
          Create group
        </Button>
      </div>
    </section>
  );
}

/**
 * A name no group at `position` has: `base` itself, else `base` with the
 * first free number, as Glyphs names a group after its first glyph.
 */
function newGroupName(kerning: Kerning, position: KerningPairPosition, base: string): string {
  if (!kerning.groups.named(position, base)) return base;
  for (let suffix = 2; ; suffix++) {
    const name = `${base}_${suffix}`;
    if (!kerning.groups.named(position, name)) return name;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
