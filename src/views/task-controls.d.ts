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
export declare function createTaskControls(task: {
    checked?: boolean;
}, parent: HTMLElement, opts?: TaskControlOptions): HTMLSpanElement;
/**
 * Flatten a tree of tasks into the display order used by Dashboard/Timeline.
 * Recurses through `.sub` or `.subs` arrays if present.
 */
export declare function orderTasks(tasks: any[]): any[];
