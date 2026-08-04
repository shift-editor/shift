import { Button, Slider } from "@shift/ui";
import { EditableSidebarInput } from "@/components/editor/sidebar-right/EditableSidebarInput";
import { useSignalState } from "@/lib/signals";
import { useFontSession } from "@/workspace/WorkspaceContext";
import VerticalEllipsis from "@/assets/general/vertical-ellipsis.svg";

/** Authored Axes sidebar presentation backed by retained source coordinates. */
export const DisplayAxesPanel = () => {
  const catalog = useFontSession().catalog;
  const axes = useSignalState(catalog.axesCell);
  const location = useSignalState(catalog.locationCell);

  if (axes.length === 0) return <p className="text-ui text-muted pl-2">No axes defined</p>;

  return (
    <div className="flex flex-col gap-1">
      {axes.map((axis, index) => {
        const value = location[index] ?? axis.defaultValue;
        const minimum = axis.minimum ?? Math.min(...axis.values);
        const maximum = axis.maximum ?? Math.max(...axis.values);

        const updateLocation = async (nextValue: number): Promise<void> => {
          const nextLocation = [...location];
          nextLocation[index] = nextValue;
          try {
            await catalog.setLocation(nextLocation);
          } catch (error) {
            console.error("failed to set preview location", error);
          }
        };

        return (
          <div key={axis.index} className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-2">
              <span className="text-ui text-secondary">{axis.name}</span>
            </div>

            <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_1.5rem] items-center gap-4 pl-2">
              <EditableSidebarInput value={value} className="w-14" onValueChange={updateLocation} />
              <div
                className="min-w-0 flex-1"
                onDoubleClick={async (event) => {
                  event.preventDefault();
                  await updateLocation(axis.defaultValue);
                }}
              >
                <Slider
                  min={minimum}
                  max={maximum}
                  step={axis.kind === "discrete" ? undefined : 0.01}
                  value={value}
                  onValueChange={updateLocation}
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 p-0.5"
                aria-label={`Actions for ${axis.name}`}
                data-read-only-mutation
              >
                <VerticalEllipsis className="h-5 w-5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
