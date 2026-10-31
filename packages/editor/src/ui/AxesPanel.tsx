import { Slider, cn } from "@shift/ui";
import type { Axis } from "@shift/types";
import type { ReactNode } from "react";
import { useSignalState } from "../lib/signals";
import { continuousBounds, discreteValues } from "../lib/variation/axisKind";
import { axisValue, withExternalAxisValue } from "../lib/variation/location";
import { EditableSidebarInput } from "./EditableSidebarInput";
import type { EditorUISession } from "./types";

export interface AxesPanelProps {
  session: EditorUISession;
  actions?: (axis: Axis) => ReactNode;
}

export function AxesPanel({ session, actions }: AxesPanelProps) {
  const { editor, font } = session;
  const axes = useSignalState(font.externalAxesCell).filter((axis) => {
    const bounds = continuousBounds(axis);
    return bounds !== null && bounds.minimum !== bounds.maximum;
  });
  const location = useSignalState(editor.externalLocationCell);

  if (axes.length === 0) return <p className="pl-2 text-ui text-muted">No varying axes</p>;

  return (
    <div className="flex flex-col gap-1">
      {axes.map((axis) => {
        const bounds = continuousBounds(axis);
        const values = discreteValues(axis) ?? [];
        const minimum = bounds?.minimum ?? Math.min(axis.kind.default, ...values);
        const maximum = bounds?.maximum ?? Math.max(axis.kind.default, ...values);
        const value = axisValue(location, axis);
        const setValue = (nextValue: number) =>
          editor.setExternalLocation(withExternalAxisValue(location, axis, nextValue));

        return (
          <div key={axis.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-2">
              <span className="text-ui text-secondary">{axis.name}</span>
            </div>
            <div
              className={cn(
                "grid items-center gap-2 pl-2",
                actions
                  ? "grid-cols-[minmax(0,1fr)_3.5rem_1.5rem]"
                  : "grid-cols-[minmax(0,1fr)_3.5rem]",
              )}
            >
              <div
                className="min-w-0 flex-1"
                onDoubleClick={(event) => {
                  event.preventDefault();
                  setValue(axis.kind.default);
                }}
              >
                <Slider
                  aria-label={axis.name}
                  min={minimum}
                  max={maximum}
                  step={0.01}
                  value={value}
                  onValueChange={setValue}
                />
              </div>
              <EditableSidebarInput
                ariaLabel={`${axis.name} value`}
                value={value}
                className="w-14"
                onValueChange={setValue}
              />
              {actions ? actions(axis) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
