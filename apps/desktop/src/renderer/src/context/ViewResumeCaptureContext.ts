import { createContext, useContext } from "react";

export type ViewResumeCaptureControls = {
  flush: () => Promise<void>;
  notifyConsumed: () => void;
};

export const ViewResumeCaptureContext = createContext<ViewResumeCaptureControls | null>(null);

export function useViewResumeCapture(): ViewResumeCaptureControls {
  const controls = useContext(ViewResumeCaptureContext);
  if (!controls) {
    throw new Error("useViewResumeCapture must be used within ViewResumeCaptureProvider");
  }

  return controls;
}
