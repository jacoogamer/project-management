import { App, PluginSettingTab } from "obsidian";
import type ProjectManagementPlugin from "./src/main";
export interface PmSettings {
    statusProperty: string;
    dueProperty: string;
    ownerProperty: string;
    /** Front‑matter boolean key that marks a note as a Project (default: "project") */
    projectFlagProperty: string;
    /** Vault‑relative path to a markdown file that will be used as the template
     *  when `New Project` creates a project note.  Blank = use the built‑in
     *  default template bundled with the plugin. */
    projectTemplate: string;
    statusValues: string[];
    showTasksInTimeline: boolean;
    showArrows: boolean;
    showHeatmap: boolean;
    showAssignees: boolean;
    showMilestones: boolean;
    showTooltips: boolean;
    showBarShadows: boolean;
    allowBarMove: boolean;
    timelineStart?: string;
    timelineEnd?: string;
    zoomPxPerDay: number;
    heatMin: number;
    heatMax: number;
    resourcesOverloadThreshold: number;
    taskWeeksOverloadThreshold: number;
    barColorE: string;
    barColorS: string;
    barColorSB: string;
    completedBarLight: string;
    milestoneLineLight: string;
    barColorE_dark: string;
    barColorS_dark: string;
    barColorSB_dark: string;
    completedBarDark: string;
    milestoneLineDark: string;
    showProgressRibbon: boolean;
    showTimelineRibbon: boolean;
    showTaskRibbon: boolean;
    showResourcesRibbon: boolean;
    showCalendarRibbon: boolean;
    reuseProgressPane: boolean;
    reuseTimelinePane: boolean;
    reuseTaskWeeksPane: boolean;
    reuseResourcesPane: boolean;
    lastSelectedPortfolio?: string;
}
export declare const DEFAULT_SETTINGS: PmSettings;
export declare class PmSettingsTab extends PluginSettingTab {
    plugin: ProjectManagementPlugin;
    constructor(app: App, plugin: ProjectManagementPlugin);
    display(): void;
}
