import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(function Slider({ className, ...props }, ref) {
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[var(--cg-subtle)]">
        <SliderPrimitive.Range className="absolute h-full bg-[var(--cg-accent)]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-[var(--cg-accent)] bg-[var(--cg-bg)] shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--cg-accent)] disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  );
});

export { Slider };
