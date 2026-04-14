import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

function Breadcrumb({ ...props }: React.ComponentPropsWithoutRef<"nav">) {
  return <nav aria-label="breadcrumb" {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentPropsWithoutRef<"ol">) {
  return (
    <ol
      className={cn(
        "flex flex-wrap items-center gap-0.5 text-xs",
        className,
      )}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentPropsWithoutRef<"li">) {
  return (
    <li
      className={cn("inline-flex min-w-0 items-center gap-0.5", className)}
      {...props}
    />
  );
}

type BreadcrumbButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

function BreadcrumbButton({ className, type = "button", ...props }: BreadcrumbButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-w-0 items-center rounded px-1 py-[1px]",
        "text-[var(--cf-muted)] transition-colors duration-[var(--cf-transition)]",
        "hover:bg-[var(--cf-hover)] hover:text-[var(--cf-fg)]",
        className,
      )}
      {...props}
    />
  );
}

function BreadcrumbPage({ className, ...props }: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      aria-current="page"
      className={cn("inline-flex min-w-0 items-center rounded px-1 py-[1px] font-medium text-[var(--cf-fg)]", className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({ className, children, ...props }: React.ComponentPropsWithoutRef<"li">) {
  return (
    <li
      aria-hidden="true"
      className={cn("mx-0.5 shrink-0 text-[var(--cf-muted)] opacity-60", className)}
      {...props}
    >
      {children ?? <ChevronRight size={12} />}
    </li>
  );
}

export {
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
};
