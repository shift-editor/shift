import { getShiftHost } from "@/host/shiftHost";
import { useState } from "react";

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
      <span className="transition-opacity duration-150" style={{ opacity: isHovered ? 1 : 0 }}>
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

  if (host.platform !== "darwin") return null;

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }

    host.commands.run("window.close");
  };

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
