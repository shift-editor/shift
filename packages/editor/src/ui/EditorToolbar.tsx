import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@shift/ui";
import { useState, type ReactNode } from "react";
import { useSignalState } from "../lib/signals";
import { ShiftIcon } from "./ShiftIcon";
import { ToolsPane } from "./ToolsPane";
import type { EditorUISession } from "./types";

export interface EditorToolbarHost {
  documentTitle: string;
  documentEdited: boolean;
  navigation?: ReactNode;
  windowControls?: ReactNode;
}

export interface EditorToolbarProps {
  session: EditorUISession;
  host?: EditorToolbarHost;
  leftSidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
}

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
  const editedDocumentTitle = `${documentTitle} — Edited`;

  return (
    <header className="titlebar-drag grid h-[50px] w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-toolbar">
      <div className="flex min-w-0 items-center">
        {host ? host.windowControls : <DecorativeWindowControls />}
        {onToggleLeftSidebar ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                icon={<ShiftIcon name="sidebar-left" className="h-5 w-5" />}
                aria-label={
                  leftSidebarOpen === undefined
                    ? "Toggle left sidebar"
                    : leftSidebarOpen
                      ? "Hide left sidebar"
                      : "Show left sidebar"
                }
                aria-pressed={leftSidebarOpen}
                variant="ghost"
                size="icon"
                className="text-sidebar-icon hover:bg-icon-button-hover"
                onClick={onToggleLeftSidebar}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle left sidebar</TooltipContent>
          </Tooltip>
        ) : null}
        <div className="flex min-w-0 items-center justify-center gap-6">
          {host?.navigation}
          <div className="min-w-0">
            <p className="grid truncate whitespace-nowrap text-ui">
              {host ? (
                <>
                  <span className="invisible col-start-1 row-start-1">{editedDocumentTitle}</span>
                  <span className="col-start-1 row-start-1">
                    {host.documentEdited ? editedDocumentTitle : documentTitle}
                  </span>
                </>
              ) : (
                documentTitle
              )}
            </p>
            <p className="truncate text-ui font-medium">{metadata.familyName ?? "Untitled"}</p>
          </div>
        </div>
      </div>

      <ToolsPane editor={editor} />

      <div className="flex justify-end pr-2">
        {onToggleRightSidebar ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                icon={<ShiftIcon name="sidebar-right" className="h-5 w-5" />}
                aria-label={
                  rightSidebarOpen === undefined
                    ? "Toggle right sidebar"
                    : rightSidebarOpen
                      ? "Hide right sidebar"
                      : "Show right sidebar"
                }
                aria-pressed={rightSidebarOpen}
                variant="ghost"
                size="icon"
                className="text-sidebar-icon hover:bg-icon-button-hover"
                onClick={onToggleRightSidebar}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle right sidebar</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
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
