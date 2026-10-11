import { getShiftHost } from "@/host/shiftHost";
import { useState } from "react";
import { Button, Tooltip, X } from "@shift/ui";
import { useWindowButtonLayout } from "./WindowControls";
import { useTitleBarColors } from "./useTitleBarColors";

interface TrafficLightButtonProps {
  color: "close" | "minimize" | "maximize";
  onClick: () => void;
  isHovered: boolean;
}

interface TitlebarProps {
  closeOnly?: boolean;
  onClose?: () => void;
}

const TrafficLightButton = ({ color, onClick, isHovered }: TrafficLightButtonProps) => {
  // These values reproduce native macOS traffic lights and are intentionally exempt from theme colors.
  const colors = {
    close: {
      bg: "#FF5F57",
      hoverBg: "#FF5F57",
      icon: (
        <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
          <path
            d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5"
            stroke="#4D0000"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
    minimize: {
      bg: "#FEBC2E",
      hoverBg: "#FEBC2E",
      icon: (
        <svg width="8" height="2" viewBox="0 0 8 2" fill="none">
          <path d="M0.5 1H7.5" stroke="#995700" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    },
    maximize: {
      bg: "#28C840",
      hoverBg: "#28C840",
      icon: (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path
            d="M1 3V7H5M7 5V1H3"
            stroke="#006500"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  };

  const { bg, icon } = colors[color];

  return (
    <button
      onClick={onClick}
      className="traffic-light-btn flex h-3 w-3 items-center justify-center rounded-full transition-all duration-150"
      style={{ backgroundColor: bg }}
      aria-label={color}
    >
      <span
        className={`transition-opacity duration-150 ${isHovered ? "opacity-100" : "opacity-0"}`}
      >
        {icon}
      </span>
    </button>
  );
};

/**
 * Renders draggable app chrome with full or close-only window controls.
 *
 * @param props - Control visibility and optional close behavior for the owning window.
 */
export const Titlebar = ({ closeOnly = false, onClose }: TitlebarProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const host = getShiftHost();

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }

    host.commands.run("window.close");
  };

  if (host.platform !== "darwin") {
    // The main window and launcher draw their own row; only small windows use this.
    return closeOnly ? <DialogTitlebar onClose={handleClose} /> : null;
  }

  const handleMinimize = () => {
    host.commands.run("window.minimise");
  };

  const handleMaximize = () => {
    host.commands.run("window.maximise");
  };

  return (
    <div
      role="toolbar"
      aria-label="Window controls"
      className="titlebar-drag flex shrink-0 items-center gap-2 px-3 py-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <TrafficLightButton color="close" onClick={handleClose} isHovered={isHovered} />
      {closeOnly ? null : (
        <>
          <TrafficLightButton color="minimize" onClick={handleMinimize} isHovered={isHovered} />
          <TrafficLightButton color="maximize" onClick={handleMaximize} isHovered={isHovered} />
        </>
      )}
    </div>
  );
};

/**
 * The close-only title-bar row of About, Feedback, and Update on Windows and Linux.
 *
 * @remarks
 * Windows draws its own close button over the row; Linux windows are frameless,
 * so the row draws a close button on the side the desktop's layout puts it.
 */
const DialogTitlebar = ({ onClose }: { onClose: () => void }) => {
  const isWindows = getShiftHost().platform === "win32";
  const layout = useWindowButtonLayout();
  useTitleBarColors(isWindows, "--color-background");

  const closeAtStart = layout?.start.includes("close") ?? false;
  const close = isWindows ? null : (
    <Tooltip content="Close" side="bottom">
      <Button
        icon={<X width={14} height={14} />}
        aria-label="Close"
        variant="toolbar"
        size="icon-sm"
        onClick={onClose}
      />
    </Tooltip>
  );

  return (
    <div className="title-bar-area shrink-0">
      <div className="flex h-10 items-center px-2">
        {closeAtStart ? close : null}
        <div className="flex-1" />
        {closeAtStart ? null : close}
      </div>
    </div>
  );
};
