import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ViewStateResult } from "obsidian";
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";
import "../../styles/styles-task-weeks.css";
export declare const VIEW_TYPE_PM_TASKWEEKS = "pm-task-weeks-view";
export declare class TaskWeeksView extends ItemView {
    /** icon shown on the view tab */
    icon: string;
    /** Optional set of project file paths to display (injected by Portfolio view) */
    private filterPaths?;
    /** Optional name of the portfolio that opened this dashboard */
    private filterName?;
    /** The initial project paths passed in from Portfolio (null = no portfolio) */
    private originalPaths;
    private sortField;
    private sortAsc;
    private collapsed;
    private firstRender;
    private totalGroups;
    private currentPaths;
    private visibleWeekPaths;
    private showEpics;
    private showStories;
    private showSubTasks;
    private displayMode;
    private sortMode;
    private collapsedProjects;
    private cache;
    private settings;
    private container;
    private detachFn;
    private filterText;
    /** Optional set of assignee names to display */
    private assigneeFilter;
    constructor(leaf: WorkspaceLeaf, cache: ProjectCache, settings: PmSettings);
    /** Called when leaf.setViewState({ state }) is invoked */
    setState(state: any, result: ViewStateResult): Promise<void>;
    /** Update project filter & re-render.
        Pass `null` => show ALL projects.                         */
    updateFilter(paths: string[] | null, name?: string): void;
    getViewType(): string;
    getDisplayText(): string;
    getIcon(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
    /** Returns true if every project row is collapsed */
    private allCollapsed;
    /** Collapse or expand all projects at once */
    private toggleAll;
    /** Toggle fold / unfold for one project and re-render */
    private toggle;
    /** Check if all projects are currently collapsed */
    private areAllProjectsCollapsed;
    /** Collapse all projects */
    private collapseAllProjects;
    /** Toggle task completion status */
    private toggleTaskCompletion;
    private render;
    focusSearch(): void;
}
