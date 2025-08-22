import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ViewStateResult } from "obsidian";
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";
interface PersonResource {
    id: string;
    name: string;
    weeklyCapacity: number;
    skills?: string[];
}
declare class ResourceRegistry {
    private people;
    listPeople(): PersonResource[];
    addPerson(p: PersonResource): void;
}
/** Singleton registry (replace later with real data load) */
export declare const registry: ResourceRegistry;
import "../../styles/styles-resources.css";
export declare const VIEW_TYPE_PM_RESOURCES = "pm-resources-view";
export declare class ResourcesView extends ItemView {
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
    private collapsedProjects;
    private firstRender;
    private totalGroups;
    private currentPaths;
    private visibleGroupIds;
    private cache;
    private settings;
    private container;
    private detachFn;
    private filterText;
    private filterAssignees?;
    private showEpics;
    private showStories;
    private showSubTasks;
    private sortMode;
    constructor(leaf: WorkspaceLeaf, cache: ProjectCache, settings: PmSettings);
    /** Called when leaf.setViewState({ state }) is invoked */
    setState(state: {
        filterProjects?: string[];
        filterName?: string;
    } | undefined, result: ViewStateResult): Promise<void>;
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
    /** Check if all currently visible projects are collapsed */
    private areAllProjectsCollapsed;
    /** Collapse all currently visible projects */
    private collapseAllProjects;
    /** Toggle fold / unfold for one project and re-render */
    private toggle;
    private render;
    focusSearch(): void;
    /** Extract every unique assignee name found in current cache
        (fallback when registry has no people). */
    private gatherAssigneesFromTasks;
    /** Show dropdown of all people under the clicked element. */
    private showAssigneePicker;
    /** Replace or add `assignee:: <new>` for the *specific* task block. */
    private reassignTask;
    private toggleTaskCompletion;
}
export {};
