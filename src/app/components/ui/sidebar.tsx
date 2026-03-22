import * as React from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "../../lib/utils";

const SIDEBAR_DEFAULT_WIDTH = 224;
const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 480;

interface SidebarContextValue {
  open: boolean;
  toggleSidebar: () => void;
  width: number;
  isDragging: boolean;
  startResize: (event: React.MouseEvent) => void;
  resetWidth: () => void;
  railTriggerRef: React.RefObject<HTMLButtonElement | null>;
  setSidebarNode: (node: HTMLDivElement | null) => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

interface SidebarProviderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width: number;
  onWidthChange: (width: number) => void;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  children: React.ReactNode;
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, width));
}

function SidebarProvider({
  open,
  onOpenChange,
  width,
  onWidthChange,
  defaultWidth = SIDEBAR_DEFAULT_WIDTH,
  minWidth = SIDEBAR_MIN_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH,
  children,
}: SidebarProviderProps) {
  const draggingRef = React.useRef(false);
  const startXRef = React.useRef(0);
  const startWidthRef = React.useRef(0);
  const railTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const sidebarNodeRef = React.useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const stopDragging = React.useCallback(() => {
    draggingRef.current = false;
    setIsDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const setWidth = React.useCallback((nextWidth: number) => {
    onWidthChange(clampWidth(nextWidth, minWidth, maxWidth));
  }, [maxWidth, minWidth, onWidthChange]);

  const startResize = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  React.useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = event.clientX - startXRef.current;
      setWidth(startWidthRef.current + delta);
    };

    const onMouseUp = () => {
      if (!draggingRef.current) return;
      stopDragging();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      stopDragging();
    };
  }, [setWidth, stopDragging]);

  React.useEffect(() => {
    if (!open && draggingRef.current) {
      stopDragging();
    }
  }, [open, stopDragging]);

  React.useEffect(() => {
    if (open) return;
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    if (!sidebarNodeRef.current?.contains(activeElement)) return;
    railTriggerRef.current?.focus();
  }, [open]);

  const toggleSidebar = React.useCallback(() => {
    onOpenChange(!open);
  }, [onOpenChange, open]);

  const resetWidth = React.useCallback(() => {
    setWidth(defaultWidth);
  }, [defaultWidth, setWidth]);

  const value = React.useMemo<SidebarContextValue>(() => ({
    open,
    toggleSidebar,
    width,
    isDragging,
    startResize,
    resetWidth,
    railTriggerRef,
    setSidebarNode: (node) => {
      sidebarNodeRef.current = node;
    },
  }), [isDragging, open, resetWidth, startResize, toggleSidebar, width]);

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

function useSidebar(): SidebarContextValue {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function Sidebar({ className, style, ...props }, ref) {
  const { open, width, isDragging, setSidebarNode } = useSidebar();

  return (
    <div
      ref={(node) => {
        setSidebarNode(node);
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      data-state={open ? "expanded" : "collapsed"}
      data-collapsible={open ? undefined : "offcanvas"}
      aria-hidden={!open}
      inert={open ? undefined : true}
      className={cn(
        "flex min-w-0 shrink-0 flex-col overflow-hidden bg-[var(--cg-bg)]",
        open ? "w-[var(--cg-sidebar-width)] border-r border-[var(--cg-border)]" : "w-0 border-r-0 pointer-events-none",
        !isDragging && "transition-[width] duration-[var(--cg-transition,0.15s)] ease-in-out",
        className,
      )}
      style={{
        ...style,
        "--cg-sidebar-width": `${width}px`,
      } as React.CSSProperties}
      {...props}
    />
  );
});

const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function SidebarHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 border-b border-[var(--cg-border)] px-3 py-2",
        className,
      )}
      {...props}
    />
  );
});

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function SidebarContent({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("flex-1 overflow-y-auto overflow-x-hidden min-w-0 overscroll-contain", className)}
      {...props}
    />
  );
});

const SidebarInset = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function SidebarInset({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  );
});

const SidebarTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function SidebarTrigger({ className, onClick, title, "aria-label": ariaLabel, type = "button", ...props }, ref) {
  const { open, toggleSidebar } = useSidebar();

  return (
    <button
      ref={ref}
      type={type}
      title={title ?? (open ? "Collapse sidebar" : "Expand sidebar")}
      aria-label={ariaLabel ?? (open ? "Collapse sidebar" : "Expand sidebar")}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded text-[var(--cg-muted)] transition-colors duration-[var(--cg-transition,0.15s)] hover:bg-[var(--cg-hover)] hover:text-[var(--cg-fg)]",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          toggleSidebar();
        }
      }}
      {...props}
    >
      <PanelLeft size={16} />
    </button>
  );
});

function SidebarRail({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open, startResize, resetWidth, railTriggerRef } = useSidebar();

  if (!open) {
    return (
      <div
        className={cn("shrink-0 flex flex-col border-r border-[var(--cg-border)]", className)}
        {...props}
      >
        <div className="px-1 py-2">
          <SidebarTrigger ref={railTriggerRef} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 w-1 cursor-col-resize relative -ml-[2px] z-10",
        "hover:bg-[var(--cg-active)] active:bg-[var(--cg-active)]",
        "transition-colors duration-[var(--cg-transition,0.15s)]",
        className,
      )}
      onMouseDown={startResize}
      onDoubleClick={resetWidth}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
};
