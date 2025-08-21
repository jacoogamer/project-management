import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ViewStateResult } from "obsidian";
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";
import "../../styles/styles-dashboard.css";
export declare const VIEW_TYPE_PM_DASHBOARD = "pm-dashboard-view";
export declare class DashboardView extends ItemView {
    /** icon shown on the view tab */
    icon: string;
    /** Optional set of project file paths to display (injected by Portfolio view) */
    private filterPaths?;
    /** Optional name of the portfolio that opened this dashboard */
    private filterName?;
    /** The initial project paths passed in from Portfolio (null = no portfolio) */
    private originalPaths;
    /** Optional set of assignees to filter by */
    private filterAssignees?;
    /** Optional name of the assignee filter that opened this dashboard */
    private filterAssigneeName?;
    /** The initial assignees passed in (null = no assignee filter) */
    private originalAssignees;
    /** Currently focused chart type (for drill-down view) */
    private focusedChart?;
    private cache;
    private settings;
    private container;
    private detachFn;
    private charts;
    constructor(leaf: WorkspaceLeaf, cache: ProjectCache, settings: PmSettings);
    /** Called when leaf.setViewState({ state }) is invoked */
    setState(state: any, result: ViewStateResult): Promise<void>;
    /** Update project filter & re-render.
        Pass `null` => show ALL projects.                         */
    updateFilter(paths: string[] | null, name?: string): void;
    /** Update assignee filter & re-render.
        Pass `null` => show ALL assignees.                         */
    updateAssigneeFilter(assignees: string[] | null, name?: string): void;
    /** Focus on a specific chart type for drill-down view */
    focusChart(chartType: 'status' | 'type' | 'assignee' | 'assignee-status' | 'project' | null): void;
    getViewType(): string;
    getDisplayText(): string;
    getIcon(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
    /** Collect all tasks from filtered projects */
    private collectTasks;
    /** Create chart data for task status distribution */
    private createStatusChartData;
    /** Create chart data for task type distribution */
    private createTypeChartData;
    /** Create chart data for assignee distribution */
    private createAssigneeChartData;
    /** Create chart data for assignee per project distribution (stacked bar chart) */
    private createAssigneeProjectChartData;
    /** Create chart data for project status distribution (stacked bar chart) */
    private createProjectStatusChartData;
    /** Create chart data for assignee status distribution (stacked bar chart) */
    private createAssigneeStatusChartData;
    /** Create chart data for project distribution */
    private createProjectChartData;
    /** Render project breakdown summary for focused view */
    private renderProjectBreakdown;
    /** Render assignee breakdown charts for focused view */
    private renderAssigneeBreakdown;
    /** Create a bar chart */
    private createBarChart;
    /** Create a pie chart */
    private createPieChart;
    private render;
}
