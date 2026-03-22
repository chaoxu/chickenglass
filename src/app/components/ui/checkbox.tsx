import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-[var(--cf-border)] bg-[var(--cf-bg)] text-[var(--cf-accent-fg)] shadow-sm",
        "focus:outline-none focus:ring-1 focus:ring-[var(--cf-accent)]",
        "data-[state=checked]:border-[var(--cf-accent)] data-[state=checked]:bg-[var(--cf-accent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="h-3.5 w-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export { Checkbox };
