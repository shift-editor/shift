import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { FocusZone } from "@/types/focus";

interface FocusZoneContextValue {
  activeZone: FocusZone;
  setZone: (zone: FocusZone) => void;
  isZone: (zone: FocusZone) => boolean;
}

const FocusZoneContext = createContext<FocusZoneContextValue | null>(null);

interface FocusZoneProviderProps {
  children: ReactNode;
  defaultZone?: FocusZone;
}

/**
 * Tracks which zone keyboard shortcuts belong to.
 *
 * @remarks
 * The zone is a hint, never a lock: the pointer or focus entering a zone moves it there. Text
 * inputs keep their keys because the keyboard router ignores events aimed at editable targets,
 * so no state here has to be released when an input blurs or unmounts.
 */
export function FocusZoneProvider({ children, defaultZone = "canvas" }: FocusZoneProviderProps) {
  const [activeZone, setActiveZone] = useState<FocusZone>(defaultZone);

  const setZone = useCallback((zone: FocusZone) => setActiveZone(zone), []);

  const isZone = useCallback((zone: FocusZone) => activeZone === zone, [activeZone]);

  const value = useMemo(() => ({ activeZone, setZone, isZone }), [activeZone, setZone, isZone]);

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
  const { activeZone, setZone } = useFocusZone();
  const ref = useRef<HTMLDivElement>(null);

  // Claim on every pointer move, not only on enter: focus can move the zone while the pointer
  // stays put (a menu handing focus back to its sidebar trigger, the window refocusing a sidebar
  // control), and with an enter-only claim the canvas then stayed dead until the pointer left
  // and re-entered it. Native listeners follow the DOM, so a popup portaled out of a sidebar
  // over the canvas is not mistaken for the sidebar. They only listen while another zone is active.
  useEffect(() => {
    const element = ref.current;
    if (!element || activeZone === zone) return undefined;

    const claim = () => setZone(zone);
    element.addEventListener("pointermove", claim);
    element.addEventListener("pointerdown", claim);

    return () => {
      element.removeEventListener("pointermove", claim);
      element.removeEventListener("pointerdown", claim);
    };
  }, [activeZone, zone, setZone]);

  const handleFocus = useCallback(() => {
    setZone(zone);
  }, [zone, setZone]);

  return (
    <div ref={ref} className={className} onFocusCapture={handleFocus}>
      {children}
    </div>
  );
}
