import { Slider } from "@shift/ui";
import { useSignalState } from "@/lib/signals";
import { useFontSession } from "@/workspace/WorkspaceContext";

/** Retained-source axis controls over the common dense catalog location. */
export const DisplayAxesPanel = () => {
  const catalog = useFontSession().catalog;
  const axes = useSignalState(catalog.axesCell);
  const location = useSignalState(catalog.locationCell);

  if (axes.length === 0) return <p className="text-ui text-muted pl-2">No axes defined</p>;

  return (
    <div className="flex flex-col gap-2">
      {axes.map((axis, index) => {
        const value = location[index] ?? axis.defaultValue;
        const minimum = axis.minimum ?? Math.min(...axis.values);
        const maximum = axis.maximum ?? Math.max(...axis.values);

        return (
          <div key={axis.index} className="flex flex-col gap-1 px-2">
            <div className="flex items-center justify-between text-ui">
              <span className="text-secondary">{axis.name}</span>
              <span className="font-mono text-muted">{Math.round(value * 100) / 100}</span>
            </div>
            <Slider
              min={minimum}
              max={maximum}
              step={axis.kind === "discrete" ? undefined : 0.01}
              value={value}
              onValueChange={async (nextValue) => {
                const nextLocation = [...location];
                nextLocation[index] = nextValue;
                try {
                  await catalog.setLocation(nextLocation);
                } catch (error) {
                  console.error("failed to set preview location", error);
                }
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
