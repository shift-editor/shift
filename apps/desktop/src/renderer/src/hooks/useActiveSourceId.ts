import { useMemo } from "react";
import { useAxes } from "./useAxes";
import { useSources } from "./useSources";
import { useVariationLocation } from "./useVariationLocation";

/**
 * The id of the source whose location matches the current variation location,
 * or null if none match (e.g. mid-scrub between masters).
 */
export const useActiveSourceId = (): string | null => {
  const axes = useAxes();
  const sources = useSources();
  const [location] = useVariationLocation();

  return useMemo(() => {
    for (const source of sources) {
      if (axes.every((axis) => source.location[axis.tag] === location[axis.tag])) {
        return source.id;
      }
    }
    return null;
  }, [axes, sources, location]);
};
