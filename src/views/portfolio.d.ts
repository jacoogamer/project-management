import { ItemView, WorkspaceLeaf } from "obsidian";
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";
import "../../styles/styles-portfolio.css";
export declare const VIEW_TYPE_PM_PORTFOLIO = "pm-portfolio-view";
export declare class PortfolioView extends ItemView {
    private cache;
    private settings;
    private plugin;
    icon: string;
    private portfolios;
    private selectedId;
    private descBox?;
    /** Active sidebar tooltip so we can close it on render/change */
    private descTip;
    /** Sorting key and direction (1 = asc, -1 = desc) */
    private sortKey;
    private sortDir;
    constructor(leaf: WorkspaceLeaf, cache: ProjectCache, settings: PmSettings, plugin: any);
    getViewType(): string;
    getDisplayText(): string;
    onOpen(): Promise<void>;
    onClose(): Promise<void>;
    private ensureFolder;
    private loadPortfolios;
    /** Try to find a file by its name (for handling renamed files) */
    private findFileByName;
    /** Check if a file is a project file by looking at its front matter */
    private isProjectFile;
    /** Persist the YAML back to the portfolio storage folder */
    private savePortfolio;
    /** Delete a portfolio YAML and refresh list */
    private deletePortfolio;
    /** Open Progress view showing only projects in the selected portfolio */
    private openProgress;
    /** Open Dashboard showing only projects in the selected portfolio */
    private openDashboard;
    /** Open Today view showing task recommendations */
    private openToday;
    /** Open Calendar view showing task calendar for this portfolio */
    private openCalendar;
    /** Open Timeline showing only projects in the selected portfolio */
    private openTimeline;
    private toggleSort;
    private render;
    /** Open Dashboard filtered to the supplied project paths */
    private openDashboardFor;
    /** Open Timeline filtered to the supplied project paths */
    private openTimelineFor;
    /** Open Task Weeks filtered to the current portfolio */
    private openTaskWeeks;
    /** Open Task Weeks filtered to the supplied project paths */
    private openTaskWeeksFor;
    /** Open Resources view filtered to current portfolio */
    private openResources;
    /** Open Resources view filtered to the supplied project paths */
    private openResourcesFor;
}
