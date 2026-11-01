import { useLayoutEffect, useRef, useState } from "react";
import { Button, cn, Tooltip } from "@shift/ui";
import { pathBasename, recentOpenedLabel, type RecentDocument } from "@shared/recents";
import { RecentFileMenu } from "./RecentFileMenu";
import { FittedSpecimen, LastOpenedSpecimen, TileSpecimen } from "./RecentSpecimen";
import { useAltKeyHeld } from "./useRecentDocuments";
import { filenameParts, longestFittingName } from "./recentFileName";
import type { RecentFileActions } from "./useRecentFileActions";

interface RecentFileItemProps {
  document: RecentDocument;
  /** Parent folder that distinguishes files sharing this filename. */
  folder: string | undefined;
  now: number;
  actions: RecentFileActions;
}

/**
 * A name on one line that loses its middle when the line is too short,
 * keeping its end, as Finder and Glyphs do: `shantellsans-w…INFM`.
 *
 * @remarks
 * An invisible copy measures each candidate against the line's width.
 */
const OneLineName = ({ name, className }: { name: string; className?: string }) => {
  const lineRef = useRef<HTMLParagraphElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [label, setLabel] = useState(name);

  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return undefined;

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(line);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const line = lineRef.current;
    const measure = measureRef.current;
    if (!line || !measure) return;

    setLabel(
      longestFittingName(name, (candidate) => {
        measure.textContent = candidate;
        return measure.offsetWidth <= line.clientWidth;
      }),
    );
  }, [name, width]);

  return (
    <p ref={lineRef} className={cn("relative min-w-0 whitespace-nowrap", className)}>
      {label}
      <span
        ref={measureRef}
        aria-hidden="true"
        className="invisible absolute top-0 left-0 whitespace-nowrap"
      />
    </p>
  );
};

/**
 * A tile's caption: the font's name (`Host Grotesk Bold`) on its own line,
 * then the file's extension as written, in monospace, and when it was opened
 * (`.glyphspackage · 18 Oct`), both quieter than the name.
 *
 * @remarks
 * Before the specimen is cached, or for a font with no name, the filename
 * without its extension stands in for the font's name. The extension tells
 * apart a family's `.shift` and `.glyphspackage`; the tooltip has the full
 * path.
 */
const RecentFileTileCaption = ({
  filename,
  fontName,
  when,
}: {
  filename: string;
  fontName: string | undefined;
  when: string;
}) => {
  const { stem, extension } = filenameParts(filename);

  return (
    <div className="mx-0.5 flex min-w-0 flex-col gap-0.5 text-sm/4">
      <OneLineName name={fontName ?? stem} className="font-medium text-primary" />
      <p className="truncate text-secondary">
        {extension && (
          <>
            <code className="font-mono text-ui/4">{extension}</code> ·{" "}
          </>
        )}
        {when}
      </p>
    </div>
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
 * Grid tile for one recent file: its specimen on a muted tile, then the
 * font's name over its filename and when it was opened.
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
            <LastOpenedSpecimen specimen={document.specimen} preview={document.preview} />
          ) : (
            <TileSpecimen specimen={document.specimen} preview={document.preview} />
          )}
        </div>
        <RecentFileMenu document={document} actions={actions} className={TILE_MENU_CLASS} />
      </div>
      <div className={cn(document.missing && "opacity-50")}>
        <RecentFileTileCaption
          filename={name}
          fontName={document.specimen?.displayName ?? undefined}
          when={whenLabel(document, now)}
        />
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
