import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ViewStateResult } from "obsidian";
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";
import "../../styles/styles-calendar.css";
export declare const VIEW_TYPE_PM_CALENDAR = "pm-calendar-view";
export declare class CalendarView extends ItemView {
    /** icon shown on the view tab */
    icon: string;
    /** Optional set of project file paths to display */
    private filterPaths?;
    /** Optional name of the portfolio that opened this calendar */
    private filterName?;
    /** The initial project paths passed in from Portfolio (null = no portfolio) */
    private originalPaths;
    /** Project filter dropdown state */
    private filterDropdownOpen;
    /** Optional assignees to filter by */
    private filterAssignees;
    private originalAssignees;
    /** Assignee filter dropdown state */
    private assigneeDropdownOpen;
    private currentDate;
    private collapsed;
    private firstRender;
    private lastScrollTop;
    private cache;
    private settings;
    private container;
    private detachFn;
    private filterText;
    private showEpics;
    private showStories;
    private showSubTasks;
    constructor(leaf: WorkspaceLeaf, cache: ProjectCache, settings: PmSettings);
    /** Called when leaf.setViewState({ state }) is invoked */
    setState(state: {
        filterProjects?: string[];
        filterName?: string;
    } | undefined, result: ViewStateResult): Promise<void>;
    getViewType(): string;
    getDisplayText(): string;
    getIcon(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
    /** Collect all tasks for the current view period */
    private collectTasksForPeriod;
    /** Generate calendar days for the current month */
    private generateCalendarDays;
    /** Clean up any open popups/dropdowns */
    private cleanupPopups;
    /** Update project filter & re-render */
    updateFilter(paths: string[] | null): void;
    /** Update assignee filter & re-render */
    updateAssigneeFilter(assignees: string[] | null): void;
    /** Get tasks for a specific date */
    private getTasksForDate;
    /** Render the calendar view */
    private render;
    /** Render month view */
    private renderMonthView;
    /** Render a single day cell */
    private renderDayCell;
    /** Show day expansion with task details */
    private showDayExpansion;
    /** Render a single task item in the expansion */
    private renderTaskItem;
}
