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
  readonly sameHeadings?: (
    before: readonly HeadingEntry[],
    after: readonly HeadingEntry[],
  ) => boolean;
}

export interface SidebarSemanticHeadingJob {
  readonly derive: () => readonly HeadingEntry[];
  readonly force?: boolean;
  readonly revisionKey?: unknown;
  readonly sameHeadings?: (
    before: readonly HeadingEntry[],
    after: readonly HeadingEntry[],
  ) => boolean;
}

export interface SidebarSemanticDiagnosticsJob {
  readonly derive: () => readonly DiagnosticEntry[];
  readonly force?: boolean;
  readonly revisionKey?: unknown;
}

export interface SidebarSemanticPublisher {
  readonly callbacksRef: RefObject<SidebarSemanticPublisherCallbacks>;
  readonly flushDiagnostics: (job: SidebarSemanticDiagnosticsJob) => void;
  readonly flushHeadings: (job: SidebarSemanticHeadingJob) => void;
  readonly hasDiagnosticsSubscriber: () => boolean;
  readonly publish: (
    state: SidebarSemanticPublishState,
    options?: SidebarSemanticPublishOptions,
  ) => void;
  readonly queueDiagnostics: (job: SidebarSemanticDiagnosticsJob) => void;
  readonly queueHeadings: (job: SidebarSemanticHeadingJob) => void;
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
  const headingFlushHandleRef = useRef<number | null>(null);
  const diagnosticsFlushHandleRef = useRef<number | null>(null);
  const pendingHeadingJobRef = useRef<SidebarSemanticHeadingJob | null>(null);
  const pendingDiagnosticsJobRef = useRef<SidebarSemanticDiagnosticsJob | null>(null);
  const queuedHeadingRevisionKeyRef = useRef<unknown>(undefined);
  const queuedDiagnosticsRevisionKeyRef = useRef<unknown>(undefined);
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
      const previousHeadings = publishedHeadingsRef.current;
      const headingsChanged = previousHeadings !== state.headings
        && (
          !previousHeadings
          || !options.sameHeadings
          || !options.sameHeadings(previousHeadings, state.headings)
        );
      if (force || headingsChanged) {
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

  const clearHeadingTimer = useCallback(() => {
    if (headingFlushHandleRef.current !== null) {
      window.clearTimeout(headingFlushHandleRef.current);
      headingFlushHandleRef.current = null;
    }
  }, []);

  const clearDiagnosticsTimer = useCallback(() => {
    if (diagnosticsFlushHandleRef.current !== null) {
      window.clearTimeout(diagnosticsFlushHandleRef.current);
      diagnosticsFlushHandleRef.current = null;
    }
  }, []);

  const flushHeadings = useCallback((job: SidebarSemanticHeadingJob) => {
    clearHeadingTimer();
    pendingHeadingJobRef.current = null;
    publish({
      diagnostics: [],
      headings: [...job.derive()],
    }, {
      force: job.force,
      publishDiagnostics: false,
      sameHeadings: job.sameHeadings,
    });
  }, [clearHeadingTimer, publish]);

  const flushDiagnostics = useCallback((job: SidebarSemanticDiagnosticsJob) => {
    clearDiagnosticsTimer();
    pendingDiagnosticsJobRef.current = null;
    publish({
      diagnostics: [...job.derive()],
      headings: [],
    }, {
      force: job.force,
      publishHeadings: false,
    });
  }, [clearDiagnosticsTimer, publish]);

  const queueHeadings = useCallback((job: SidebarSemanticHeadingJob) => {
    if (!callbacksRef.current.onHeadingsChange) return;
    if (
      !job.force &&
      job.revisionKey !== undefined &&
      Object.is(job.revisionKey, queuedHeadingRevisionKeyRef.current)
    ) {
      return;
    }
    queuedHeadingRevisionKeyRef.current = job.revisionKey;
    pendingHeadingJobRef.current = job;
    if (headingFlushHandleRef.current !== null) return;
    headingFlushHandleRef.current = window.setTimeout(() => {
      const pending = pendingHeadingJobRef.current;
      if (!pending) return;
      flushHeadings(pending);
    }, 0);
  }, [flushHeadings]);

  const queueDiagnostics = useCallback((job: SidebarSemanticDiagnosticsJob) => {
    if (!callbacksRef.current.onDiagnosticsChange) return;
    if (
      !job.force &&
      job.revisionKey !== undefined &&
      Object.is(job.revisionKey, queuedDiagnosticsRevisionKeyRef.current)
    ) {
      return;
    }
    queuedDiagnosticsRevisionKeyRef.current = job.revisionKey;
    pendingDiagnosticsJobRef.current = job;
    if (diagnosticsFlushHandleRef.current !== null) return;
    diagnosticsFlushHandleRef.current = window.setTimeout(() => {
      const pending = pendingDiagnosticsJobRef.current;
      if (!pending) return;
      flushDiagnostics(pending);
    }, 0);
  }, [flushDiagnostics]);

  useEffect(() => {
    return () => {
      clearHeadingTimer();
      clearDiagnosticsTimer();
      pendingHeadingJobRef.current = null;
      pendingDiagnosticsJobRef.current = null;
    };
  }, [clearDiagnosticsTimer, clearHeadingTimer]);

  const resetPublished = useCallback(() => {
    queuedHeadingRevisionKeyRef.current = undefined;
    queuedDiagnosticsRevisionKeyRef.current = undefined;
    publishedHeadingsRef.current = null;
    publishedDiagnosticsRef.current = null;
  }, []);

  return useMemo(() => ({
    callbacksRef,
    flushDiagnostics,
    flushHeadings,
    hasDiagnosticsSubscriber,
    publish,
    queueDiagnostics,
    queueHeadings,
    resetPublished,
  }), [
    flushDiagnostics,
    flushHeadings,
    hasDiagnosticsSubscriber,
    publish,
    queueDiagnostics,
    queueHeadings,
    resetPublished,
  ]);
}
