import { setIcon } from "obsidian";
import type { TaskItem } from "../services/cache";

// Extended task interface for tasks with sub-tasks
interface TaskWithSubs extends TaskItem {
  sub?: TaskWithSubs[];
  subs?: TaskWithSubs[];
}
/* ────────────────────────────────────────────────────────────────
   Extra helpers for task rows
────────────────────────────────────────────────────────────────── */

/** Optional callback called right after the user toggles check-state */
export interface TaskControlOptions {
  onToggle?: () => void;
}

/**
 * Insert the leading bullet or check-icon.
 * - If the task is unchecked → shows “•”.
 * - If the task is checked   → shows a green ✓ icon.
 * If `opts.onToggle` is provided, the bullet becomes clickable:
 *   1) flips `task.checked`
 *   2) refreshes the icon
 *   3) invokes the callback.
 *
 * @returns the created <span>, so callers can add extra styling if needed.
 */
export function createTaskControls(
  task: { checked?: boolean },
  parent: HTMLElement,
  opts: TaskControlOptions = {}
): HTMLSpanElement {
  const span = parent.createSpan({ cls: "pm-task-bullet" });

  const draw = () => {
    span.empty();
    if (task.checked) {
      setIcon(span, "check-circle");
      span.addClass("pm-task-check");
    } else {
      span.removeClass("pm-task-check");
      span.setText("•");
    }
  };
  draw();

  if (opts.onToggle) {
            span.classList.add("pm-eye-icon");
    span.onclick = (e) => {
      e.preventDefault();
      task.checked = !task.checked;
      draw();
      opts.onToggle?.();
    };
  }

  return span;
}

/**
 * Flatten a tree of tasks into the display order used by Dashboard/Timeline.
 * Recurses through `.sub` or `.subs` arrays if present.
 */
export function orderTasks(tasks: TaskWithSubs[]): TaskWithSubs[] {
  const out: TaskWithSubs[] = [];
  (function walk(arr: TaskWithSubs[]) {
    arr?.forEach((t) => {
      out.push(t);
      if (Array.isArray(t.sub))  walk(t.sub);
      if (Array.isArray(t.subs)) walk(t.subs);
    });
  })(tasks);
  return out;
}