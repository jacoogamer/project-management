import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ViewStateResult } from "obsidian";
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";
import "../../styles/styles-progress.css";
export declare const VIEW_TYPE_PM_PROGRESS = "pm-progress-view";
export declare class ProjectProgressView extends ItemView {
    /** icon shown on the view tab */
    icon: string;
    /** Optional set of project file paths to display (injected by Portfolio view) */
    private filterPaths?;
    /** Optional name of the portfolio that opened this dashboard */
    private filterName?;
    private sortField;
    private sortAsc;
    private collapsed;
    private firstRender;
    private showEpics;
    private showStories;
    private showSubTasks;
    private filterAssignees?;
    private originalPaths;
    private filterText;
    private cache;
    private settings;
    private container;
    private detachFn;
    constructor(leaf: WorkspaceLeaf, cache: ProjectCache, settings: PmSettings);
    /** Called when leaf.setViewState({ state }) is invoked */
    setState(state: any, result: ViewStateResult): Promise<void>;
    /** Allow Portfolio view to refresh the filter at runtime */
    updateFilter(paths: string[] | null, name?: string): void;
    getViewType(): string;
    getDisplayText(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
    /** Returns true if every project row is collapsed */
    private allCollapsed;
    /** Collapse or expand all projects at once */
    private toggleAll;
    /** Toggle fold / unfold for one project and re-render */
    private toggle;
    private render;
    private toggleTaskCompletion;
    focusSearch(): void;
}
