import { useLayoutEffect, useRef, useState } from "react";
import { Button, cn, Tooltip } from "@shift/ui";
import { pathBasename, recentOpenedLabel, type RecentDocument } from "@shared/recents";
import { RecentFileMenu } from "./RecentFileMenu";
import { FittedSpecimen, LastOpenedSpecimen, TileSpecimen } from "./RecentSpecimen";
import { useAltKeyHeld } from "./useRecentDocuments";
import type { RecentFileActions } from "./useRecentFileActions";
import { filenameParts, longestFittingName } from "./recentFileName";

interface RecentFileItemProps {
  document: RecentDocument;
  /** Parent folder that distinguishes files sharing this filename. */
  folder: string | undefined;
  now: number;
  actions: RecentFileActions;
}

/** A filename with its extension in a lighter shade. */
const FileNameLabel = ({ label }: { label: string }) => {
  const { stem, extension } = filenameParts(label);

  return (
    <span className="min-w-0 overflow-hidden">
      {stem}
      <span className="text-secondary/60">{extension}</span>
    </span>
  );
};

/**
 * One line under a tile: the filename, its extension dimmed, then " · " and
 * when it was opened.
 *
 * @remarks
 * A name too long for the line loses its middle, keeping the extension. An
 * invisible copy measures each candidate against the width the date leaves.
 */
const RecentFileCaption = ({ name, when }: { name: string; when: string }) => {
  const captionRef = useRef<HTMLParagraphElement>(null);
  const whenRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [label, setLabel] = useState(name);

  useLayoutEffect(() => {
    const caption = captionRef.current;
    if (!caption) return undefined;

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(caption);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const caption = captionRef.current;
    const measure = measureRef.current;
    const whenLabel = whenRef.current;
    if (!caption || !measure || !whenLabel) return;

    const available = caption.clientWidth - whenLabel.offsetWidth;
    setLabel(
      longestFittingName(name, (candidate) => {
        measure.textContent = candidate;
        return measure.offsetWidth <= available;
      }),
    );
  }, [name, when, width]);

  return (
    <p
      ref={captionRef}
      className="relative mx-0.5 flex min-w-0 text-sm/4 whitespace-nowrap text-secondary"
    >
      <FileNameLabel label={label} />
      <span ref={whenRef} className="shrink-0">
        &nbsp;· {when}
      </span>
      <span
        ref={measureRef}
        aria-hidden="true"
        className="invisible absolute top-0 left-0 whitespace-nowrap"
      />
    </p>
  );
};

/** When a file was opened, or that it is missing. */
function whenLabel(document: RecentDocument, now: number): string {
  return document.missing ? "Not found" : recentOpenedLabel(document.openedAt, now);
}

function openedLine(document: RecentDocument, now: number): string {
  return document.missing ? "Not found" : `Opened ${recentOpenedLabel(document.openedAt, now)}`;
}

const MissingActions = ({
  document,
  actions,
}: Pick<RecentFileItemProps, "document" | "actions">) => (
  <div className="flex gap-1">
    <Button variant="muted" size="sm" onClick={() => actions.locate(document)}>
      Locate…
    </Button>
    <Button variant="muted" size="sm" onClick={() => actions.remove(document)}>
      Remove
    </Button>
  </div>
);

/** Size and shape shared by every grid slot: 150 px tall, 12 px corners. */
export const TILE_CLASS = "h-37.5 rounded-xl";

const TILE_BUTTON_CLASS =
  "absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset";
const TILE_MENU_CLASS =
  "absolute top-2 right-2 opacity-0 group-hover/tile:opacity-100 group-has-focus-visible/tile:opacity-100 data-[popup-open]:opacity-100";
const ROW_MENU_CLASS =
  "relative shrink-0 self-center opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 data-[popup-open]:opacity-100";

/**
 * Grid tile for one recent file: its specimen on a muted tile, then one line
 * with the filename and when it was opened.
 *
 * @remarks
 * The newest file gets the wide tile, which draws the family name in the font
 * itself. The specimen area stays empty until cached thumbnails exist. The
 * full path lives in the tooltip and the ⋯ menu, which shows while the
 * pointer is over the tile.
 */
export const RecentFileTile = ({
  document,
  folder,
  now,
  actions,
  wide,
}: RecentFileItemProps & { wide: boolean }) => {
  const filename = pathBasename(document.path);
  const name = folder ? `${folder}/${filename}` : filename;
  const activate = document.missing ? actions.locate : actions.open;

  return (
    <li
      className={cn("flex min-w-0 flex-col gap-2", wide && "col-span-2")}
      data-missing={document.missing}
      data-specimen-text={document.specimen?.text}
      data-family-name={wide ? document.specimen?.familyName?.text : undefined}
    >
      <div className={cn("group/tile relative overflow-hidden bg-surface-muted", TILE_CLASS)}>
        <Tooltip content={document.path}>
          <button
            type="button"
            aria-label={filename}
            onClick={() => activate(document)}
            className={TILE_BUTTON_CLASS}
          />
        </Tooltip>
        <div className={cn("pointer-events-none h-full", document.missing && "opacity-50")}>
          {wide ? (
            <LastOpenedSpecimen specimen={document.specimen} />
          ) : (
            <TileSpecimen specimen={document.specimen} />
          )}
        </div>
        <RecentFileMenu document={document} actions={actions} className={TILE_MENU_CLASS} />
      </div>
      <div className={cn(document.missing && "opacity-50")}>
        <RecentFileCaption name={name} when={whenLabel(document, now)} />
      </div>
      {document.missing && <MissingActions document={document} actions={actions} />}
    </li>
  );
};

/** A row's filename; holding Alt prefixes its folder in a lighter shade, forming the path. */
const RecentFileRowName = ({ document }: { document: RecentDocument }) => {
  const showLocation = useAltKeyHeld();

  return (
    <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
      {showLocation && <span className="font-normal text-muted">{document.location}/</span>}
      {pathBasename(document.path)}
    </span>
  );
};

/**
 * List row for one recent file: specimen chip, name, and when it was opened.
 * Holding Alt prefixes each name with its folder, forming the path.
 */
export const RecentFileRow = ({ document, now, actions }: RecentFileItemProps) => {
  const activate = document.missing ? actions.locate : actions.open;

  return (
    <li
      className="group flex items-center gap-2 rounded-md pr-2 hover:bg-hover/50"
      data-missing={document.missing}
      data-specimen-text={document.specimen?.text}
    >
      <button
        type="button"
        onClick={() => activate(document)}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md p-1.5 text-left outline-none",
          "focus-visible:ring-2 focus-visible:ring-accent",
          document.missing && "opacity-50",
        )}
      >
        <span
          aria-hidden="true"
          className="relative size-9 shrink-0 rounded-md border border-line/20 bg-surface-muted"
        >
          <FittedSpecimen specimen={document.specimen} className="absolute inset-0 m-auto size-6" />
        </span>
        <RecentFileRowName document={document} />
        <span className="shrink-0 text-right text-ui text-secondary">
          {openedLine(document, now)}
        </span>
      </button>
      {document.missing && <MissingActions document={document} actions={actions} />}
      <RecentFileMenu document={document} actions={actions} className={ROW_MENU_CLASS} />
    </li>
  );
};
