import {
  forceParsing,
  syntaxParserRunning,
  syntaxTreeAvailable,
} from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

type IdleTaskHandle = number;
type IdleTaskDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};
type WindowWithIdleTask = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleTaskDeadline) => void,
    options?: { readonly timeout?: number },
  ) => IdleTaskHandle;
  cancelIdleCallback?: (handle: IdleTaskHandle) => void;
};

interface ScheduledHandle {
  readonly kind: "idle" | "timeout";
  readonly id: number;
}

export interface SyntaxParseScheduleRequest {
  readonly targetTo: number;
  readonly budgetMs?: number;
  readonly isStillNeeded: () => boolean;
}

const DEFAULT_PARSE_BUDGET_MS = 25;
const PARSE_IDLE_TIMEOUT_MS = 250;
const PARSE_RETRY_DELAY_MS = 32;

function scheduleIdleOrTimeout(task: () => void): ScheduledHandle {
  const idleWindow = window as WindowWithIdleTask;
  if (idleWindow.requestIdleCallback) {
    return {
      kind: "idle",
      id: idleWindow.requestIdleCallback(task, { timeout: PARSE_IDLE_TIMEOUT_MS }),
    };
  }

  return {
    kind: "timeout",
    id: window.setTimeout(task, PARSE_RETRY_DELAY_MS),
  };
}

function cancelScheduledHandle(handle: ScheduledHandle): void {
  if (handle.kind === "idle") {
    const idleWindow = window as WindowWithIdleTask;
    idleWindow.cancelIdleCallback?.(handle.id);
    return;
  }
  window.clearTimeout(handle.id);
}

/**
 * Coalesces low-priority CM6 parse nudges for render plugins.
 *
 * Renderers should request the smallest target that covers their dirty region.
 * The scheduler yields to normal browser work and retries only while CM6 still
 * reports an active parser.
 */
export class SyntaxParseScheduler {
  private scheduled: ScheduledHandle | null = null;
  private destroyed = false;
  private targetTo = 0;
  private budgetMs = DEFAULT_PARSE_BUDGET_MS;
  private isStillNeeded: (() => boolean) | null = null;

  constructor(private readonly view: EditorView) {}

  schedule(request: SyntaxParseScheduleRequest): void {
    if (this.destroyed) return;
    this.targetTo = request.targetTo;
    this.budgetMs = request.budgetMs ?? DEFAULT_PARSE_BUDGET_MS;
    this.isStillNeeded = request.isStillNeeded;
    if (!this.shouldParse()) return;
    if (this.scheduled !== null) return;
    this.scheduled = scheduleIdleOrTimeout(() => this.run());
  }

  destroy(): void {
    this.destroyed = true;
    const scheduled = this.scheduled;
    this.scheduled = null;
    if (scheduled !== null) {
      cancelScheduledHandle(scheduled);
    }
  }

  private shouldParse(): boolean {
    if (this.destroyed) return false;
    if (!this.isStillNeeded?.()) return false;
    return !syntaxTreeAvailable(this.view.state, this.targetTo);
  }

  private run(): void {
    this.scheduled = null;
    if (!this.shouldParse()) return;

    forceParsing(this.view, this.targetTo, this.budgetMs);
    if (this.shouldParse() && syntaxParserRunning(this.view)) {
      this.scheduled = scheduleIdleOrTimeout(() => this.run());
    }
  }
}
