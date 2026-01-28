import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { FocusZone } from "@/types/focus";

interface FocusZoneContextValue {
  activeZone: FocusZone;
  focusLock: boolean;
  setZone: (zone: FocusZone) => void;
  lockToZone: (zone: FocusZone) => void;
  unlock: () => void;
  isZone: (zone: FocusZone) => boolean;
}

const FocusZoneContext = createContext<FocusZoneContextValue | null>(null);

interface FocusZoneProviderProps {
  children: ReactNode;
  defaultZone?: FocusZone;
}

export function FocusZoneProvider({ children, defaultZone = "canvas" }: FocusZoneProviderProps) {
  const [activeZone, setActiveZone] = useState<FocusZone>(defaultZone);
  const [focusLock, setFocusLock] = useState(false);
  const [lockedZone, setLockedZone] = useState<FocusZone | null>(null);

  const setZone = useCallback(
    (zone: FocusZone) => {
      if (!focusLock) {
        setActiveZone(zone);
      }
    },
    [focusLock],
  );

  const lockToZone = useCallback((zone: FocusZone) => {
    setFocusLock(true);
    setLockedZone(zone);
    setActiveZone(zone);
  }, []);

  const unlock = useCallback(() => {
    setFocusLock(false);
    setLockedZone(null);
  }, []);

  const isZone = useCallback((zone: FocusZone) => activeZone === zone, [activeZone]);

  const value = useMemo(
    () => ({
      activeZone: focusLock && lockedZone ? lockedZone : activeZone,
      focusLock,
      setZone,
      lockToZone,
      unlock,
      isZone,
    }),
    [activeZone, focusLock, lockedZone, setZone, lockToZone, unlock, isZone],
  );

  return <FocusZoneContext.Provider value={value}>{children}</FocusZoneContext.Provider>;
}

export function useFocusZone(): FocusZoneContextValue {
  const context = useContext(FocusZoneContext);
  if (!context) {
    throw new Error("useFocusZone must be used within a FocusZoneProvider");
  }
  return context;
}

interface ZoneContainerProps {
  zone: FocusZone;
  children: ReactNode;
  className?: string;
}

export function ZoneContainer({ zone, children, className }: ZoneContainerProps) {
  const { setZone } = useFocusZone();

  const handleMouseEnter = useCallback(() => {
    setZone(zone);
  }, [zone, setZone]);

  const handleFocus = useCallback(() => {
    setZone(zone);
  }, [zone, setZone]);

  return (
    <div className={className} onMouseEnter={handleMouseEnter} onFocusCapture={handleFocus}>
      {children}
    </div>
  );
}
