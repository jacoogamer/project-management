import { ItemView, WorkspaceLeaf } from "obsidian";
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";
import "../../styles/styles-today.css";
export declare const VIEW_TYPE_PM_TODAY = "pm-today-view";
export declare class TodayView extends ItemView {
    private cache;
    private settings;
    private container;
    private detachFn;
    private showSubtasksOnly;
    private showCompleted;
    private showOverdueOnly;
    private lastScrollTop;
    private collapsedSections;
    private selectedDate;
    /** Optional set of project file paths to display */
    private filterPaths?;
    constructor(leaf: WorkspaceLeaf, cache: ProjectCache, settings: PmSettings);
    getViewType(): string;
    getDisplayText(): string;
    getIcon(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
    /** Collect all tasks with intelligent recommendations */
    private collectTodayTasks;
    /** Calculate intelligent priority score for a task */
    private calculateTaskScore;
    /** Get task type for categorization */
    private getTaskType;
    /** Update project filter & re-render */
    updateFilter(paths: string[] | null): void;
    /** Get task status for color coding */
    private getTaskStatus;
    private render;
    private renderTaskSection;
    private renderTask;
}
