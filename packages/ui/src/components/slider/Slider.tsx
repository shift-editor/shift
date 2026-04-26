import * as React from "react";
import { Slider as BaseSlider } from "@base-ui-components/react/slider";
import { cn } from "../../lib/utils";

type SliderRootProps = React.ComponentPropsWithoutRef<typeof BaseSlider.Root<number>>;

export interface SliderProps extends Omit<
  SliderRootProps,
  "value" | "defaultValue" | "onValueChange"
> {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  trackClassName?: string;
  indicatorClassName?: string;
  thumbClassName?: string;
}

export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  (
    { className, trackClassName, indicatorClassName, thumbClassName, onValueChange, ...props },
    ref,
  ) => {
    return (
      <BaseSlider.Root
        ref={ref}
        className={cn("relative flex items-center w-full select-none touch-none", className)}
        onValueChange={onValueChange ? (value) => onValueChange(value as number) : undefined}
        {...props}
      >
        <BaseSlider.Control className="flex items-center w-full h-3.5 cursor-pointer">
          <BaseSlider.Track
            className={cn("relative w-full h-1.5 bg-canvas rounded-full", trackClassName)}
          >
            <BaseSlider.Indicator
              className={cn("absolute h-full bg-accent rounded-full", indicatorClassName)}
            />
            <BaseSlider.Thumb
              className={cn(
                "w-3.5 h-3.5 rounded-full bg-white border-2 border-black shadow-sm",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                thumbClassName,
              )}
            />
          </BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>
    );
  },
);

Slider.displayName = "Slider";
