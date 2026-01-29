import { useEffect, useRef, useState, useCallback } from "react";
import {
  ToastProvider,
  ToastViewport,
  ToastRoot,
  ToastTitle,
  useToastManager,
  Button,
} from "@shift/ui";
import PlusIcon from "@/assets/plus.svg";
import MinusIcon from "@/assets/minus.svg";

const TOAST_DURATION_MS = 1500;
const VIEWPORT_CLASS = "top-16 left-auto right-[266px] translate-x-0 origin-top-right";

const hoverState = { isHovering: false };

function useZoomToastListener(onZoomChange: (percent: number) => void) {
  const manager = useToastManager();
  const managerRef = useRef(manager);
  const toastIdRef = useRef<string | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  managerRef.current = manager;

  const scheduleClose = useCallback(() => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    if (hoverState.isHovering) return;

    closeTimeoutRef.current = setTimeout(() => {
      const idToClose = toastIdRef.current;
      if (idToClose) {
        managerRef.current.close(idToClose);
        toastIdRef.current = null;
      }
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    const onZoom = window.electronAPI?.onUiZoomChanged;
    if (!onZoom) return undefined;

    const unsubscribe = onZoom((zoomPercent: number) => {
      onZoomChange(zoomPercent);

      const m = managerRef.current;
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);

      const id = toastIdRef.current;
      const exists = id !== null && m.toasts.some((t) => t.id === id);

      if (exists) {
        m.update(id, { title: `${zoomPercent}%` });
      } else {
        toastIdRef.current = m.add({ title: `${zoomPercent}%` });
      }

      scheduleClose();
    });

    return () => {
      unsubscribe();
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, [onZoomChange, scheduleClose]);

  return { closeTimeoutRef, scheduleClose };
}

function ZoomToastListener({
  onZoomChange,
  onScheduleClose,
}: {
  onZoomChange: (percent: number) => void;
  onScheduleClose: (fn: () => void) => void;
}) {
  const { scheduleClose } = useZoomToastListener(onZoomChange);
  useEffect(() => {
    onScheduleClose(() => scheduleClose);
  }, [scheduleClose, onScheduleClose]);
  return null;
}

function ZoomToastList({ scheduleClose }: { scheduleClose: () => void }) {
  const { toasts } = useToastManager();

  const handleMouseEnter = () => {
    hoverState.isHovering = true;
  };

  const handleMouseLeave = () => {
    hoverState.isHovering = false;
    scheduleClose();
  };

  return toasts.map((toast) => (
    <ToastRoot key={toast.id} toast={toast}>
      <div
        className="flex items-center justify-between gap-2 min-w-60"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <ToastTitle>{String(toast.title)}</ToastTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon">
            <PlusIcon className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon">
            <MinusIcon className="w-3 h-3" />
          </Button>
          <div className="ml-4">
            <Button variant="primary">Reset</Button>
          </div>
        </div>
      </div>
    </ToastRoot>
  ));
}

export function ZoomToast({ children }: { children: React.ReactNode }) {
  const [zoomPercent, setZoomPercent] = useState(100);
  const [scheduleClose, setScheduleClose] = useState<() => void>(() => () => {});
  const counterScale = 100 / zoomPercent;

  return (
    <ToastProvider timeout={0}>
      <ZoomToastListener onZoomChange={setZoomPercent} onScheduleClose={setScheduleClose} />
      {children}
      <ToastViewport className={VIEWPORT_CLASS} style={{ transform: `scale(${counterScale})` }}>
        <ZoomToastList scheduleClose={scheduleClose} />
      </ToastViewport>
    </ToastProvider>
  );
}
