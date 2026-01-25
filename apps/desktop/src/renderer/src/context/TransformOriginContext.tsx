import { createContext, useContext, useState, ReactNode } from "react";
import type { AnchorPosition } from "@/components/sidebar/TransformGrid";

interface TransformOriginContextValue {
  anchor: AnchorPosition;
  setAnchor: (anchor: AnchorPosition) => void;
}

const TransformOriginContext = createContext<TransformOriginContextValue | null>(null);

interface TransformOriginProviderProps {
  children: ReactNode;
  defaultAnchor?: AnchorPosition;
}

export function TransformOriginProvider({
  children,
  defaultAnchor = "m",
}: TransformOriginProviderProps) {
  const [anchor, setAnchor] = useState<AnchorPosition>(defaultAnchor);

  return (
    <TransformOriginContext.Provider value={{ anchor, setAnchor }}>
      {children}
    </TransformOriginContext.Provider>
  );
}

export function useTransformOrigin(): TransformOriginContextValue {
  const context = useContext(TransformOriginContext);
  if (!context) {
    throw new Error("useTransformOrigin must be used within a TransformOriginProvider");
  }
  return context;
}
