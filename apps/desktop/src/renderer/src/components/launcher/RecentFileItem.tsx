import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { pathBasename, recentOpenedLabel, type RecentDocument } from "@shared/recents";
import { RecentFileMenu } from "./RecentFileMenu";
import type { RecentFileActions } from "./useRecentFileActions";
import { filenameWrapChunks, middleTruncatedName, middleTruncationLimit } from "./recentFileName";

interface RecentFileItemProps {
  document: RecentDocument;
  /** Parent folder that distinguishes files sharing this filename. */
  folder: string | undefined;
  now: number;
  actions: RecentFileActions;
}

/** Draws a recent file's cached specimen, or nothing when it has none yet. */
const RecentSpecimen = ({
  document,
  className,
}: {
  document: RecentDocument;
  className?: string;
}) => {
  const specimen = document.specimen;
  if (!specimen) return null;

  const alignment = specimen.rightToLeft ? "xMaxYMid meet" : "xMidYMid meet";
  return (
    <svg
      aria-hidden="true"
      viewBox={specimen.viewBox.join(" ")}
      preserveAspectRatio={alignment}
      className={cn("fill-current text-primary", className)}
    >
      <path d={specimen.outline} />
    </svg>
  );
};

const NAME_CLASS = "line-clamp-2 wrap-anywhere";

/**
 * Filename that wraps to at most two lines and, when it still overflows,
 * cuts its middle so the extension stays visible.
 *
 * @remarks
 * An invisible copy with the same styles measures each candidate; the visible
 * label only re-renders with the longest one that fits.
 */
const RecentFileName = ({ name, className }: { name: string; className?: string }) => {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [label, setLabel] = useState(name);

  useLayoutEffect(() => {
    const container = measureRef.current?.parentElement;
    if (!container) return undefined;

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;

    setLabel(longestFittingName(name, measure));
  }, [name, width]);

  return (
    <span className="relative block min-w-0">
      <span className={cn(NAME_CLASS, className)}>
        {filenameWrapChunks(label).map((chunk, index) => (
          <Fragment key={index}>
            {index > 0 && <wbr />}
            {chunk}
          </Fragment>
        ))}
      </span>
      <span
        ref={measureRef}
        aria-hidden="true"
        className={cn(NAME_CLASS, className, "invisible absolute inset-x-0 top-0")}
      />
    </span>
  );
};

function longestFittingName(name: string, measure: HTMLElement): string {
  const fits = (text: string) => {
    const nodes = filenameWrapChunks(text).flatMap((chunk, index) =>
      index > 0 ? [window.document.createElement("wbr"), chunk] : [chunk],
    );
    measure.replaceChildren(...nodes);
    return measure.scrollHeight <= measure.clientHeight;
  };
  if (fits(name)) return name;

  let low = 0;
  let high = middleTruncationLimit(name) - 1;
  let best = 0;
  while (low <= high) {
    const headLength = Math.floor((low + high) / 2);
    if (fits(middleTruncatedName(name, headLength))) {
      best = headLength;
      low = headLength + 1;
    } else {
      high = headLength - 1;
    }
  }
  return middleTruncatedName(name, best);
}

function openedLine(document: RecentDocument, folder: string | undefined, now: number): string {
  const when = document.missing
    ? "Not found"
    : `Opened ${recentOpenedLabel(document.openedAt, now)}`;
  return folder ? `${folder} · ${when}` : when;
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

const CARD_CLASS =
  "group relative flex min-w-0 flex-col overflow-hidden border border-line/20 bg-background card-shadow transition-shadow hover:shadow-md";
const CARD_BUTTON_CLASS =
  "absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset";
const HOVER_REVEAL_CLASS =
  "relative shrink-0 self-center opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 data-[popup-open]:opacity-100";

/**
 * Grid card for one recent file: specimen, filename, and when it was opened.
 *
 * @remarks
 * The specimen area stays empty until cached thumbnails exist. The full path
 * lives in the tooltip and the ⋯ menu, never on the card.
 */

export const RecentFileCard = ({ document, folder, now, actions }: RecentFileItemProps) => {
  const name = pathBasename(document.path);
  const activate = document.missing ? actions.locate : actions.open;

  return (
    <li
      className={CARD_CLASS}
      data-missing={document.missing}
      data-specimen-text={document.specimen?.text}
    >
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            aria-label={name}
            onClick={() => activate(document)}
            className={CARD_BUTTON_CLASS}
          />
        </TooltipTrigger>
        <TooltipContent>{document.path}</TooltipContent>
      </Tooltip>
      <div
        className={cn(
          "pointer-events-none relative aspect-4/3 w-full bg-surface-muted",
          document.missing && "opacity-50",
        )}
      >
        <RecentSpecimen document={document} className="absolute inset-0 m-auto h-1/2 w-3/4" />
      </div>
      <div className="flex items-center gap-0.5 py-2 pr-1 pl-2.5">
        <div
          className={cn(
            "pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5",
            document.missing && "opacity-50",
          )}
        >
          <RecentFileName name={name} className="text-ui font-medium text-primary" />
          <span className="truncate text-xs text-secondary">
            {openedLine(document, folder, now)}
          </span>
        </div>
        <RecentFileMenu document={document} actions={actions} className={HOVER_REVEAL_CLASS} />
      </div>
      {document.missing && (
        <div className="relative px-2 pb-2">
          <MissingActions document={document} actions={actions} />
        </div>
      )}
    </li>
  );
};

/** List row for one recent file: specimen chip, name, full path, and when it was opened. */
export const RecentFileRow = ({ document, folder, now, actions }: RecentFileItemProps) => {
  const name = pathBasename(document.path);
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
          <RecentSpecimen document={document} className="absolute inset-0 m-auto size-6" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-primary">
            {name}
            {folder && <span className="font-normal text-secondary"> · {folder}</span>}
          </span>
          <span className="truncate text-ui text-secondary">{document.path}</span>
        </span>
        <span className="shrink-0 text-right text-ui text-secondary">
          {openedLine(document, undefined, now)}
        </span>
      </button>
      {document.missing && <MissingActions document={document} actions={actions} />}
      <RecentFileMenu document={document} actions={actions} className={HOVER_REVEAL_CLASS} />
    </li>
  );
};
