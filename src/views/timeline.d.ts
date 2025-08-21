import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ViewStateResult } from "obsidian";
import "../../styles/styles-timeline.css";
import type { ProjectCache } from "../services/cache";
import ProjectManagementPlugin from "../main";
export declare const VIEW_TYPE_PM_TIMELINE = "pm-timeline-view";
/**
 * Basic project Timeline / Gantt view.
 * Displays one row per project and a 1‑day bar for each task with a `due` date.
 */
export declare class TimelineView extends ItemView {
    private cache;
    private detachFn;
    private pluginInst;
    /** Heat‑map layer element (created lazily) */
    private heatLayerEl;
    /** True if a render is already queued for the next animation frame */
    private renderQueued;
    /** User‑resizable width of the project‑name column (pixels) */
    private labelWidth;
    private sortAsc;
    /** Pixels per day — initialised from settings (must be a valid zoom stop) */
    private zoomPxPerDay;
    /** true while a zoom drag has a render queued */
    private zoomRenderScheduled;
    /** Remember scroll offsets between renders triggered externally */
    private pendingScroll;
    /** Projects whose task list is currently collapsed */
    private collapsed;
    /** Projects manually hidden via the per‑project eye icon */
    private hiddenProjects;
    /** Optional set of project file paths to display (injected by Portfolio view) */
    private filterPaths?;
    /** Optional name of the portfolio that opened this timeline */
    private filterName?;
    /** Keeps the vertical splitter height in sync with pane resize */
    private splitterRO;
    constructor(leaf: WorkspaceLeaf, cache: ProjectCache, plugin?: ProjectManagementPlugin);
    /**
     * Obsidian calls setState when the view is first loaded or when
     * leaf.setViewState({...state}) is invoked. Capture `filterProjects`
     * so we can filter the timeline rows.
     */
    setState(state: any, result: ViewStateResult): Promise<void>;
    /** Handy accessor that falls back to global plugin lookup. */
    private get plugin();
    getViewType(): string;
    getDisplayText(): string;
    /** Display the same icon used in the ribbon ("calendar-clock"). */
    getIcon(): string;
    onOpen(): Promise<void>;
    /** Allow Portfolio view to refresh the project filter at runtime */
    updateFilter(paths: string[], name?: string): void;
    onClose(): Promise<void>;
    /**
     * Opens the given markdown file (re‑uses current leaf) and scrolls to the
     * specified block reference (`^id`). It first tries the rendered element;
     * if that never appears within 1.2 s, it falls back to scrolling the editor
     * to the provided line number.
     */
    private openAndScroll;
    private render;
    /**
     * Draw a 4‑px‑tall heat‑map strip under the header. Opacity scales with
     * the number of overlapping bars recorded in `heat` for each day.
     * @param heat       day‑offset (int) → count
     * @param pxPerDay   horizontal pixels per day
     * @param horizon    number of days to cover (inclusive)
     */
    private renderHeatmap;
    /** Queue a scroll‑preserving re‑render. Multiple calls within
     *  the same animation frame coalesce into a single render. */
    saveAndRender(): void;
}
