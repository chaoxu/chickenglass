import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";

import type { DiagnosticEntry } from "../diagnostics";
import type { HeadingEntry } from "../heading-ancestry";
import { measureSync } from "../perf";

export interface SidebarSemanticPublisherCallbacks {
  readonly onDiagnosticsChange?: (diagnostics: DiagnosticEntry[]) => void;
  readonly onHeadingsChange?: (headings: HeadingEntry[]) => void;
}

export interface SidebarSemanticPublishState {
  readonly diagnostics: DiagnosticEntry[];
  readonly headings: HeadingEntry[];
}

export interface SidebarSemanticPublishOptions {
  readonly force?: boolean;
  readonly publishDiagnostics?: boolean;
  readonly publishHeadings?: boolean;
}

export interface SidebarSemanticPublisher {
  readonly callbacksRef: RefObject<SidebarSemanticPublisherCallbacks>;
  readonly hasDiagnosticsSubscriber: () => boolean;
  readonly publish: (
    state: SidebarSemanticPublishState,
    options?: SidebarSemanticPublishOptions,
  ) => void;
  readonly resetPublished: () => void;
}

export function useSidebarSemanticPublisher({
  onDiagnosticsChange,
  onHeadingsChange,
}: SidebarSemanticPublisherCallbacks): SidebarSemanticPublisher {
  const callbacksRef = useRef<SidebarSemanticPublisherCallbacks>({
    onDiagnosticsChange,
    onHeadingsChange,
  });
  const publishedHeadingsRef = useRef<readonly HeadingEntry[] | null>(null);
  const publishedDiagnosticsRef = useRef<readonly DiagnosticEntry[] | null>(null);

  useEffect(() => {
    callbacksRef.current = {
      onDiagnosticsChange,
      onHeadingsChange,
    };
  }, [onDiagnosticsChange, onHeadingsChange]);

  const hasDiagnosticsSubscriber = useCallback(
    () => Boolean(callbacksRef.current.onDiagnosticsChange),
    [],
  );

  const publish = useCallback((
    state: SidebarSemanticPublishState,
    options: SidebarSemanticPublishOptions = {},
  ) => {
    const {
      force = false,
      publishDiagnostics = true,
      publishHeadings = true,
    } = options;

    if (publishHeadings && callbacksRef.current.onHeadingsChange) {
      if (force || publishedHeadingsRef.current !== state.headings) {
        measureSync("sidebar.publishHeadings", () => {
          callbacksRef.current.onHeadingsChange?.(state.headings);
        }, {
          category: "sidebar",
          detail: `${state.headings.length} headings`,
        });
      }
      publishedHeadingsRef.current = state.headings;
    }

    if (publishDiagnostics && callbacksRef.current.onDiagnosticsChange) {
      if (force || publishedDiagnosticsRef.current !== state.diagnostics) {
        measureSync("sidebar.publishDiagnostics", () => {
          callbacksRef.current.onDiagnosticsChange?.(state.diagnostics);
        }, {
          category: "sidebar",
          detail: `${state.diagnostics.length} diagnostics`,
        });
      }
      publishedDiagnosticsRef.current = state.diagnostics;
    }
  }, []);

  const resetPublished = useCallback(() => {
    publishedHeadingsRef.current = null;
    publishedDiagnosticsRef.current = null;
  }, []);

  return useMemo(() => ({
    callbacksRef,
    hasDiagnosticsSubscriber,
    publish,
    resetPublished,
  }), [hasDiagnosticsSubscriber, publish, resetPublished]);
}
