import { Plugin } from "obsidian";
import { ProjectCache } from "./services/cache";
import { PmSettings } from "../settings";
export default class ProjectManagementPlugin extends Plugin {
    settings: PmSettings;
    cache: ProjectCache;
    /** Track ribbon icons so we can show/hide them on‑the‑fly from Settings */
    private ribbons;
    private addedPortfolio;
    onload(): Promise<void>;
    onunload(): void;
    activateProgress(): Promise<void>;
    activateTimeline(): Promise<void>;
    activatePortfolio(): Promise<void>;
    loadSettings(): Promise<void>;
    saveSettings(): Promise<void>;
    /** Re‑render all open Timeline views (invoked after settings change). */
    private refreshAllTimelines;
    /** Push user‑chosen bar colours into CSS variables and toggle shadows. */
    applyBarColours(): void;
    /** Shift the inline `start::` / `due::` properties on the specific task line. */
    private handleBarMove;
    /** Shift start and/or due by delta days based on resize edge. */
    private handleBarResize;
    /**
     * Open the Task Weeks view.
     * @param filterProjects  array of project paths to pre‑filter (empty = all)
     * @param filterName      optional label shown in the view header
     */
    activateTaskWeeks(filterProjects?: string[], filterName?: string): Promise<void>;
    /**
     * Open the Resources view.
     * @param filterProjects  array of project paths to pre‑filter (empty = all)
     * @param filterName      optional label shown in the view header
     */
    activateResources(filterProjects?: string[] | null, filterName?: string): Promise<void>;
    /**
     * Open the Dashboard view.
     * @param filterProjects  array of project paths to pre‑filter (empty = all)
     * @param filterName      optional label shown in the view header
     */
    activateDashboard(filterProjects?: string[] | null, filterName?: string): Promise<void>;
    /**
     * Open the Today view.
     */
    activateToday(): Promise<void>;
    /**
     * Open the Calendar view.
     */
    activateCalendar(): Promise<void>;
    /**
     * Create or remove ribbon icons according to current settings.
     * Called onload() and whenever a toggle changes in Settings.
     */
    refreshRibbonIcons(): void;
}
