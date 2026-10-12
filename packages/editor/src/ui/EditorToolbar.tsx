import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { useState, type ReactNode } from "react";
import { useSignalState } from "../lib/signals";
import { ShiftIcon } from "./ShiftIcon";
import type { EditorUISession } from "./types";

/** Document chrome an application supplies in place of the toolbar's embedded defaults. */
export interface EditorToolbarHost {
  /** Title shown after the family name. */
  documentTitle: string;
  /** Whether to mark the title as edited. */
  documentEdited: boolean;
  /** Controls rendered beside the title, such as back or forward buttons. */
  navigation?: ReactNode;
  /** Replaces the decorative window buttons; pass the platform's own controls or nothing. */
  windowControls?: ReactNode;
  /** Application menus drawn at the start of the row, for platforms without a system menu bar. */
  menuBar?: ReactNode;
}

export interface EditorToolbarProps {
  session: EditorUISession;
  /** Application chrome; without it the toolbar titles itself from the active source. */
  host?: EditorToolbarHost;
  /** Current left sidebar state, used for the toggle's pressed state and label. */
  leftSidebarOpen?: boolean;
  /** Current right sidebar state, used for the toggle's pressed state and label. */
  rightSidebarOpen?: boolean;
  /** Shows the left sidebar toggle; omit to hide the button. */
  onToggleLeftSidebar?: () => void;
  /** Shows the right sidebar toggle; omit to hide the button. */
  onToggleRightSidebar?: () => void;
}

/**
 * Renders the title bar: window controls, navigation, the family and document
 * title, and sidebar toggles.
 *
 * @remarks
 * The tools are not part of it; place `FloatingToolbar` over the canvas.
 */
export function EditorToolbar({
  session,
  host,
  leftSidebarOpen,
  rightSidebarOpen,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: EditorToolbarProps) {
  const { editor, font } = session;
  const metadata = useSignalState(font.metadataCell);
  const activeSourceId = useSignalState(editor.activeSourceIdCell);
  const sources = useSignalState(font.sourcesCell);
  const activeSource = sources.find(({ id }) => id === activeSourceId);
  const documentTitle =
    host?.documentTitle ?? activeSource?.name ?? metadata.styleName ?? "Interpolated";
  const navigation = host?.navigation;

  const leftSidebarToggle = onToggleLeftSidebar ? (
    <Tooltip>
      <TooltipTrigger>
        <Button
          icon={<ShiftIcon name="sidebar-left" className="h-4.5 w-4.5" />}
          aria-label={sidebarToggleLabel("left", leftSidebarOpen)}
          aria-pressed={leftSidebarOpen}
          variant="toolbar"
          size="icon-sm"
          className="h-7 w-7"
          onClick={onToggleLeftSidebar}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">Toggle left sidebar</TooltipContent>
    </Tooltip>
  ) : null;

  const rightSidebarToggle = onToggleRightSidebar ? (
    <Tooltip>
      <TooltipTrigger>
        <Button
          icon={<ShiftIcon name="sidebar-right" className="h-4.5 w-4.5" />}
          aria-label={sidebarToggleLabel("right", rightSidebarOpen)}
          aria-pressed={rightSidebarOpen}
          variant="toolbar"
          size="icon-sm"
          className="h-7 w-7"
          onClick={onToggleRightSidebar}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">Toggle right sidebar</TooltipContent>
    </Tooltip>
  ) : null;

  const familyName = metadata.familyName ?? "Untitled";
  return (
    <header className="titlebar-drag grid h-10 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-chrome">
      <div className="flex min-w-0 items-center gap-1">
        {host ? host.windowControls : <DecorativeWindowControls />}
        {host ? host.menuBar : null}
        {leftSidebarToggle}
        {navigation}
      </div>
      <p className="truncate whitespace-nowrap px-4 text-ui">
        <span className="font-medium">{familyName}</span>
        <span className="text-muted"> — {documentTitle}</span>
        {host && host.documentEdited ? <span className="text-muted"> · Edited</span> : null}
      </p>
      <div className="flex justify-end pr-2">{rightSidebarToggle}</div>
    </header>
  );
}

function DecorativeWindowControls() {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center gap-2 px-3 py-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TrafficLight color="close" hovered={hovered} />
      <TrafficLight color="minimize" hovered={hovered} />
      <TrafficLight color="maximize" hovered={hovered} />
    </div>
  );
}

function TrafficLight({
  color,
  hovered,
}: {
  color: "close" | "minimize" | "maximize";
  hovered: boolean;
}) {
  return (
    <span
      className={`shift-editor-traffic-light shift-editor-traffic-light--${color}`}
      data-hovered={hovered || undefined}
    >
      {color === "close" ? (
        <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
          <path
            d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5"
            stroke="#4D0000"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      ) : null}
      {color === "minimize" ? (
        <svg width="8" height="2" viewBox="0 0 8 2" fill="none">
          <path d="M0.5 1H7.5" stroke="#995700" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : null}
      {color === "maximize" ? (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path
            d="M1 3V7H5M7 5V1H3"
            stroke="#006500"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

function sidebarToggleLabel(side: "left" | "right", open: boolean | undefined): string {
  if (open === undefined) return `Toggle ${side} sidebar`;
  return `${open ? "Hide" : "Show"} ${side} sidebar`;
}
