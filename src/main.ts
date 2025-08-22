import { Plugin, WorkspaceLeaf, TFile, TFolder, Notice, Menu, MenuItem } from "obsidian";
import { ProjectProgressView, VIEW_TYPE_PM_PROGRESS } from "./views/progress";
import { TimelineView, VIEW_TYPE_PM_TIMELINE } from "./views/timeline";
import { PortfolioView, VIEW_TYPE_PM_PORTFOLIO } from "./views/portfolio";
import { TaskWeeksView, VIEW_TYPE_PM_TASKWEEKS } from "./views/task_weeks";
import { ResourcesView, VIEW_TYPE_PM_RESOURCES } from "./views/resources";
import { DashboardView, VIEW_TYPE_PM_DASHBOARD } from "./views/dashboard";
import { TodayView, VIEW_TYPE_PM_TODAY } from "./views/today";
import { ProjectCache } from "./services/cache";
import { PmSettings, DEFAULT_SETTINGS, PmSettingsTab } from "../settings";
import { newProject } from "./newProject";

export default class ProjectManagementPlugin extends Plugin {
  public settings!: PmSettings;
  public cache!: ProjectCache;
  /** Track ribbon icons so we can show/hide them on‑the‑fly from Settings */
  private ribbons: {
    progress?: HTMLElement;
    timeline?:  HTMLElement;
    taskWeeks?: HTMLElement;
    resources?: HTMLElement;
    portfolio?: HTMLElement;
    dashboard?: HTMLElement;
  } = {};
  private addedPortfolio: boolean = false;

  async onload() {
    await this.loadSettings();
    this.applyBarColours();          // inject CSS variables for bar colours

    this.cache = new ProjectCache(this.app, this);
    await this.cache.reindex(); // initial scan

    // Ribbon icons according to user settings
    this.refreshRibbonIcons();

    // Command palette
    this.addCommand({
      id: "open-project-progress",
      name: "Open Project Progress",
      callback: () => this.activateProgress(),
    });
    this.addCommand({
      id: "open-project-timeline",
      name: "Open Project Timeline",
      callback: () => this.activateTimeline(),
    });
    this.addCommand({
      id: "open-portfolio-configurator",
      name: "Open Projects",
      callback: () => this.activatePortfolio(),
    });
    this.addCommand({
      id: "pm-new-project",
      name: "Create New Project Note",
      callback: () => newProject(this.app),
    });
    this.addCommand({
      id: "open-weekly-task-view",
      name: "Open Weekly Task View",
      callback: () => this.activateTaskWeeks(),
    });
    this.addCommand({
      id: "open-resources-view",
      name: "Open Resources View",
      callback: () => this.activateResources(),
    });
    this.addCommand({
      id: "open-dashboard-view",
      name: "Open Dashboard View",
      callback: () => this.activateDashboard(),
    });


    /* Manual re‑index command */
    this.addCommand({
      id: "pm-reindex-cache",
      name: "Re‑index Project/Task Cache",
      callback: async () => {
        new Notice("Re‑indexing project cache…");
        await this.cache.reindex();
        new Notice("Project cache re‑indexed.");
      },
    });

    // Register custom view
    this.registerView(
      VIEW_TYPE_PM_PROGRESS,
      (leaf: WorkspaceLeaf) =>
        new ProjectProgressView(leaf, this.cache, this.settings)
    );
    this.registerView(
      VIEW_TYPE_PM_TIMELINE,
      (leaf: WorkspaceLeaf) => new TimelineView(leaf, this.cache, this)
    );
    this.registerView(
      VIEW_TYPE_PM_PORTFOLIO,
      (leaf: WorkspaceLeaf) => new PortfolioView(leaf, this.cache, this.settings)
    );
    this.registerView(
      VIEW_TYPE_PM_TASKWEEKS,
      (leaf: WorkspaceLeaf) => new TaskWeeksView(leaf, this.cache, this.settings)
    );
    this.registerView(
      VIEW_TYPE_PM_RESOURCES,
      (leaf: WorkspaceLeaf) => new ResourcesView(leaf, this.cache, this.settings)
    );
    this.registerView(
      VIEW_TYPE_PM_DASHBOARD,
      (leaf: WorkspaceLeaf) => new DashboardView(leaf, this.cache, this.settings)
    );
    this.registerView(
      VIEW_TYPE_PM_TODAY,
      (leaf: WorkspaceLeaf) => new TodayView(leaf, this.cache, this.settings)
    );

    // Keep cache updated when metadata is resolved
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => this.cache.reindex())
    );

    // Re‑index project/task cache when a note is modified (so newly‑added
    // project flag front‑matter shows up without reloading the plugin)
    this.registerEvent(
      this.app.vault.on("modify", () => this.cache.reindex())
    );

    /* Right‑click: create Project Note in selected folder */
    this.registerEvent(
      (this.app.workspace as any).on("file-menu", (menu: Menu, file: TFile | TFolder) => {
        if (file && file.constructor?.name === "TFolder") {
          menu.addItem((item: MenuItem) =>
            item
              .setTitle("New Project Note here")
              .setIcon("document-plus")
              .onClick(() => newProject(this.app, file as TFolder))
          );
        }
      })
    );

    // Settings tab
    this.addSettingTab(new PmSettingsTab(this.app, this));

    // Listen for Alt‑drag reschedule events from Timeline
    this.registerDomEvent(document, "pm-bar-moved" as keyof HTMLElementEventMap, (e: Event) => {
      const ev = e as CustomEvent<{ taskKey: string; deltaDays: number }>;
      if (ev?.detail) this.handleBarMove(ev.detail.taskKey, ev.detail.deltaDays);
    });

    // Listen for resize‑edge events from Timeline
    this.registerDomEvent(document, "pm-bar-resized" as keyof HTMLElementEventMap, (e: Event) => {
      const ev = e as CustomEvent<{ taskKey: string; deltaStart: number; deltaDue: number }>;
      if (ev?.detail) this.handleBarResize(ev.detail.taskKey, ev.detail.deltaStart, ev.detail.deltaDue);
    });

    /* Listen for project‑bar drags (shift Start/End dates in YAML) */
    this.registerDomEvent(document, "pm-project-bar-moved" as keyof HTMLElementEventMap, async (e: Event) => {
      const ev = e as CustomEvent<{ projectPath: string; deltaDays: number }>;
      if (!ev?.detail) return;
      const { projectPath, deltaDays } = ev.detail;
      if (!projectPath || !Number.isInteger(deltaDays) || deltaDays === 0) return;

      const file = this.app.vault.getFileByPath(projectPath);
      if (!(file && file instanceof TFile)) return;

      const raw = await this.app.vault.read(file);
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
      if (!fmMatch) return;                     // no front‑matter

      const blockLines = fmMatch[1].split(/\r?\n/);

      const findIdx = (keys: string[]): number =>
        blockLines.findIndex(l =>
          keys.some(k => l.toLowerCase().replace(/\s|_/g,"").startsWith(k))
        );

      const idxS = findIdx(["startdate","start"]);
      const idxE = findIdx(["enddate","end"]);
      if (idxS === -1 || idxE === -1) return;

      const getISO = (idx: number) => blockLines[idx].split(":")[1].trim();
      const momentFn = (window as any).moment;
      const shift = (iso: string) =>
        momentFn(iso, [ "YYYY-MM-DD", momentFn.ISO_8601 ], true)
          .add(deltaDays, "days")
          .format("YYYY-MM-DD");

      blockLines[idxS] = blockLines[idxS].replace(/:\s*.*/, `: ${shift(getISO(idxS))}`);
      blockLines[idxE] = blockLines[idxE].replace(/:\s*.*/, `: ${shift(getISO(idxE))}`);

      const newRaw = raw.replace(fmMatch[0], `---\n${blockLines.join("\n")}\n---\n`);
      await this.app.vault.modify(file, newRaw);

      //new Notice(`Moved project by ${deltaDays} day${deltaDays===1?"":"s"}.`);

      // Refresh cache so timeline updates immediately
      await this.cache.reindex();
    });

    /* Listen for project‑bar resize (shift only Start or End) */
    this.registerDomEvent(document, "pm-project-bar-resized" as keyof HTMLElementEventMap, async (e: Event) => {
      const ev = e as CustomEvent<{ projectPath: string; deltaStart: number; deltaEnd: number }>;
      if (!ev?.detail) return;
      const { projectPath, deltaStart, deltaEnd } = ev.detail;
      if (!projectPath || (!deltaStart && !deltaEnd)) return;

      const file = this.app.vault.getFileByPath(projectPath);
      if (!(file && file instanceof TFile)) return;

      const raw = await this.app.vault.read(file);
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
      if (!fmMatch) return;

      const lines = fmMatch[1].split(/\r?\n/);
      const find = (keys: string[]) =>
        lines.findIndex(l => keys.some(k => l.toLowerCase().replace(/\s|_/g,"").startsWith(k)));

      const iS = find(["startdate","start"]);
      const iE = find(["enddate","end"]);
      if (iS === -1 || iE === -1) return;

      const iso = (idx: number) => lines[idx].split(":")[1].trim();
      const m = (window as any).moment;
      const fmt = (iso: string, d: number) =>
        m(iso, ["YYYY-MM-DD", m.ISO_8601], true).add(d, "days").format("YYYY-MM-DD");

      if (deltaStart) lines[iS] = lines[iS].replace(/:\s*.*/, `: ${fmt(iso(iS), deltaStart)}`);
      if (deltaEnd)   lines[iE] = lines[iE].replace(/:\s*.*/, `: ${fmt(iso(iE), deltaEnd)}`);

      const newRaw = raw.replace(fmMatch[0], `---\n${lines.join("\n")}\n---\n`);
      await this.app.vault.modify(file, newRaw);
      await this.cache.reindex();
    });
  }

  onunload() {
    /* Remove ribbon icons */
    Object.values(this.ribbons).forEach(el => el?.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_PM_PROGRESS)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_PM_PORTFOLIO)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_PM_TASKWEEKS)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_PM_RESOURCES)
      .forEach((leaf) => leaf.detach());
  }

  async activateProgress() {
    // Use existing dashboard if open, else grab the upper‑left main pane
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_PROGRESS)[0];

    if (!leaf) {
      // Try to get the main editor leaf
      leaf = this.app.workspace.getLeaf("tab");

      // If that fails, try any leaf
      if (!leaf) leaf = this.app.workspace.getLeaf();
    }

    if (!leaf) leaf = this.app.workspace.getLeaf(true); // final fallback
    await leaf.setViewState({ type: VIEW_TYPE_PM_PROGRESS });
    this.app.workspace.revealLeaf(leaf);
  }

  async activateTimeline() {
    /** Re‑use an existing Timeline view if one is already open… */
    let leaf =
      this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE)[0];

    /** …otherwise create a new leaf directly *below* the active note. */
    if (!leaf) {
      const active = this.app.workspace.activeLeaf;
      if (active) {
        // Split the active leaf downward (horizontal split)
        leaf = this.app.workspace.splitActiveLeaf("horizontal");
      } else {
        leaf = this.app.workspace.getLeaf(true);  // fallback: new main leaf
      }
    }

    await leaf.setViewState({
      type: VIEW_TYPE_PM_TIMELINE,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  async activatePortfolio() {
    // Re‑use existing Portfolio view if open
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_PORTFOLIO)[0];

    // Otherwise open it to the right of a pinned pane; fall back to new main leaf
    if (!leaf) {
      const active = this.app.workspace.activeLeaf;
      if ((active as any)?.pinned) {   // if a pinned tab is active
        // Open a new tab in the same pane group (after the pinned tabs)
        leaf = this.app.workspace.getLeaf(false);
      } else {
        // Default: create or reuse an unpinned leaf in the main area
        leaf = this.app.workspace.getLeaf(true);
      }
    }

    await leaf.setViewState({ type: VIEW_TYPE_PM_PORTFOLIO, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    const saved: Partial<PmSettings> = (await this.loadData()) || {};
    const migrated: PmSettings = { ...DEFAULT_SETTINGS, ...saved };

    // Backward-compat: migrate old Dashboard keys to Progress
    if (Object.prototype.hasOwnProperty.call(saved, "showDashboardRibbon")
        && !Object.prototype.hasOwnProperty.call(saved, "showProgressRibbon")) {
      migrated.showProgressRibbon = !!(saved as any).showDashboardRibbon;
    }
    if (Object.prototype.hasOwnProperty.call(saved, "reuseDashboardPane")
        && !Object.prototype.hasOwnProperty.call(saved, "reuseProgressPane")) {
      migrated.reuseProgressPane = !!(saved as any).reuseDashboardPane;
    }

    this.settings = migrated as PmSettings;

    // Persist migration silently (avoid full saveSettings side-effects on load)
    if (Object.prototype.hasOwnProperty.call(saved, "showDashboardRibbon") ||
        Object.prototype.hasOwnProperty.call(saved, "reuseDashboardPane")) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyBarColours();        // update CSS variables
    this.refreshAllTimelines();    // refresh timelines immediately
    this.refreshRibbonIcons();
  }

  /** Re‑render all open Timeline views (invoked after settings change). */
  private refreshAllTimelines() {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_PM_TIMELINE)
      .forEach((leaf) => {
        const v = leaf.view as any;
        if (typeof v.saveAndRender === "function") {
          v.saveAndRender();           // preserves scroll offsets
        } else if (typeof v.render === "function") {
          v.render();
        }
      });
  }

  /** Push user‑chosen bar colours into CSS variables and toggle shadows. */
  public applyBarColours() {
    const st = document.documentElement.style;

    /* Light‑mode palette (existing settings) */
    st.setProperty("--pm-bar-e-color-light",  this.settings.barColorE);
    st.setProperty("--pm-bar-s-color-light",  this.settings.barColorS);
    st.setProperty("--pm-bar-sb-color-light", this.settings.barColorSB);

    /* Dark‑mode palette — fall back to light if not yet in settings */
    // @ts-ignore – dark variants may not exist yet in earlier config versions
    st.setProperty("--pm-bar-e-color-dark",  (this.settings.barColorE_dark  ?? this.settings.barColorE));
    // @ts-ignore
    st.setProperty("--pm-bar-s-color-dark",  (this.settings.barColorS_dark  ?? this.settings.barColorS));
    // @ts-ignore
    st.setProperty("--pm-bar-sb-color-dark", (this.settings.barColorSB_dark ?? this.settings.barColorSB));

    /* Maintain convenience vars used by existing CSS */
    st.setProperty("--pm-bar-e-color",  "var(--pm-bar-e-color-light)");
    st.setProperty("--pm-bar-s-color",  "var(--pm-bar-s-color-light)");
    st.setProperty("--pm-bar-sb-color", "var(--pm-bar-sb-color-light)");

    st.setProperty("--pm-bar-done-light", this.settings.completedBarLight);
    st.setProperty("--pm-bar-done-dark", this.settings.completedBarDark);
    
    /* Milestone guideline colours */
    st.setProperty("--pm-milestone-line-light", this.settings.milestoneLineLight);
    st.setProperty("--pm-milestone-line-dark", this.settings.milestoneLineDark);
    
    /* Toggle bar shadows */
    const htmlEl = document.documentElement;
    htmlEl.classList.toggle("pm-no-shadows", !this.settings.showBarShadows);
  }

  /** Shift the inline `start::` / `due::` properties on the specific task line. */
  private async handleBarMove(taskKey: string, deltaDays: number) {
    const [filePath, taskId] = taskKey.split("::");
    const file = this.app.vault.getFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    const raw = await this.app.vault.read(file);
    const lines = raw.split("\n");
    const momentFn = (window as any).moment;
    const isoRE   = /\d{4}-\d{2}-\d{2}/;

    const shiftIso = (iso: string) =>
      momentFn(iso, momentFn.ISO_8601, true)
        .add(deltaDays, "days")
        .format("YYYY-MM-DD");

    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const lineLower = line.toLowerCase();
      const idLower   = (taskId ?? "").toLowerCase();

      /* Identify the task line:
         – Exact caret anchor ^id   (e.g. ^s-1)
         – Any occurrence of the id text (fallback)
         – Or, if no id, first checkbox line */
      const isTarget =
        (idLower && lineLower.includes("^" + idLower)) ||
        (idLower && lineLower.includes(idLower)) ||
        (!idLower && /^\s*[-*]\s+\[.\]/.test(lineLower));

      if (!isTarget) continue;

      // Replace inline start:: and due:: dates on this line
      lines[i] = line.replace(/(start::\s*)(\d{4}-\d{2}-\d{2})/i, (_, p1, iso) => {
        changed = true;
        return p1 + shiftIso(iso);
      });

      lines[i] = lines[i].replace(/(due::\s*)(\d{4}-\d{2}-\d{2})/i, (_, p1, iso) => {
        changed = true;
        return p1 + shiftIso(iso);
      });

      break; // only shift the first matching task line
    }

    if (!changed) return;

    await this.app.vault.modify(file, lines.join("\n"));
    await this.cache.reindex();
  }

  /** Shift start and/or due by delta days based on resize edge. */
  private async handleBarResize(taskKey: string, deltaStart: number, deltaDue: number) {
    if (deltaStart === 0 && deltaDue === 0) return;  // nothing to do

    const [filePath, taskId] = taskKey.split("::");
    const file = this.app.vault.getFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    const raw   = await this.app.vault.read(file);
    const lines = raw.split("\n");
    const momentFn = (window as any).moment;

    const shift = (iso: string, delta: number) =>
      momentFn(iso, momentFn.ISO_8601, true)
        .add(delta, "days")
        .format("YYYY-MM-DD");

    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().includes((taskId ?? "").toLowerCase())) continue;

      if (deltaStart !== 0) {
        lines[i] = lines[i].replace(/(start::\s*)(\d{4}-\d{2}-\d{2})/i, (_, p1, iso) => {
          changed = true;
          return p1 + shift(iso, deltaStart);
        });
      }

      if (deltaDue !== 0) {
        lines[i] = lines[i].replace(/(due::\s*)(\d{4}-\d{2}-\d{2})/i, (_, p1, iso) => {
          changed = true;
          return p1 + shift(iso, deltaDue);
        });
      }
      break;  // edited the target line; stop searching
    }

    if (!changed) return;
    await this.app.vault.modify(file, lines.join("\n"));
    await this.cache.reindex();
  }

  /**
   * Open the Task Weeks view.
   * @param filterProjects  array of project paths to pre‑filter (empty = all)
   * @param filterName      optional label shown in the view header
   */
  async activateTaskWeeks(filterProjects: string[] = [], filterName: string = "") {
    // Re‑use an existing Task View if one is open
    let leaf =
      this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TASKWEEKS)[0];

    // Otherwise open below the active note like Timeline
    if (!leaf) {
      const active = this.app.workspace.activeLeaf;
      leaf = active
        ? this.app.workspace.splitActiveLeaf("horizontal")
        : this.app.workspace.getLeaf(true);
    }

    await leaf.setViewState({
      type: VIEW_TYPE_PM_TASKWEEKS,
      active: true,
      state: {
        filterProjects,
        filterName,
      },
    });
    this.app.workspace.revealLeaf(leaf);
  }
  /**
   * Open the Resources view.
   * @param filterProjects  array of project paths to pre‑filter (empty = all)
   * @param filterName      optional label shown in the view header
   */
  async activateResources(filterProjects: string[] | null = null, filterName: string = "") {
    // If filterProjects is empty, treat it as "show all"
    if (Array.isArray(filterProjects) && filterProjects.length === 0) {
      filterProjects = null;
    }
    // Re‑use an existing Resources view if open
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_RESOURCES)[0];

    // Otherwise create a new leaf to the right of the active pane
    if (!leaf) {
      const active = this.app.workspace.activeLeaf;
      leaf = active
        ? this.app.workspace.splitActiveLeaf("vertical")
        : this.app.workspace.getLeaf(true);
    }

    // Conditionally omit filterProjects if null, so view defaults to "all"
    const stateObj: { filterName: string; filterProjects?: string[] } = { filterName };
    if (filterProjects) stateObj.filterProjects = filterProjects;

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_RESOURCES,
      active: true,
      state:  stateObj,
    });
    // If the view is already mounted, update its filter in-place
    const v = leaf.view as ResourcesView;
    if (v?.updateFilter)
      v.updateFilter(filterProjects ?? null, filterName);
    this.app.workspace.revealLeaf(leaf);
  }
  /**
   * Open the Dashboard view.
   * @param filterProjects  array of project paths to pre‑filter (empty = all)
   * @param filterName      optional label shown in the view header
   */
  async activateDashboard(filterProjects: string[] | null = null, filterName: string = "") {
    // If filterProjects is empty, treat it as "show all"
    if (Array.isArray(filterProjects) && filterProjects.length === 0) {
      filterProjects = null;
    }
    // Re‑use an existing Dashboard view if open
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_DASHBOARD)[0];

    // Otherwise create a new leaf to the right of the active pane
    if (!leaf) {
      const active = this.app.workspace.activeLeaf;
      leaf = active
        ? this.app.workspace.splitActiveLeaf("vertical")
        : this.app.workspace.getLeaf(true);
    }

    // Conditionally omit filterProjects if null, so view defaults to "all"
    const stateObj: { filterName: string; filterProjects?: string[] } = { filterName };
    if (filterProjects) stateObj.filterProjects = filterProjects;

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_DASHBOARD,
      active: true,
      state:  stateObj,
    });
    // If the view is already mounted, update its filter in-place
    const v = leaf.view as DashboardView;
    if (v?.updateFilter)
      v.updateFilter(filterProjects ?? null, filterName);
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Open the Today view.
   */
  async activateToday() {
    // Re‑use an existing Today view if open
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TODAY)[0];

    // Otherwise create a new leaf to the right of the active pane
    if (!leaf) {
      const active = this.app.workspace.activeLeaf;
      leaf = active
        ? this.app.workspace.splitActiveLeaf("vertical")
        : this.app.workspace.getLeaf(true);
    }

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_TODAY,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }
  /**
   * Create or remove ribbon icons according to current settings.
   * Called onload() and whenever a toggle changes in Settings.
   */
  public refreshRibbonIcons() {
    const s = this.settings;

    /* Progress */
    if (s.showProgressRibbon && !this.ribbons.progress) {
      this.ribbons.progress = this.addRibbonIcon(
        "bar-chart-2",
        "Open Project Progress",
        () => this.activateProgress()
      );
    } else if (!s.showProgressRibbon && this.ribbons.progress) {
      this.ribbons.progress.detach();
      delete this.ribbons.progress;
    }

    /* Timeline */
    if (s.showTimelineRibbon && !this.ribbons.timeline) {
      this.ribbons.timeline = this.addRibbonIcon(
        "calendar-clock",
        "Open Project Timeline",
        () => this.activateTimeline()
      );
    } else if (!s.showTimelineRibbon && this.ribbons.timeline) {
      this.ribbons.timeline.detach();
      delete this.ribbons.timeline;
    }

    /* Task‑Weeks */
    if (s.showTaskRibbon && !this.ribbons.taskWeeks) {
      this.ribbons.taskWeeks = this.addRibbonIcon(
        "calendar-check",
        "Open Weekly Task View",
        () => this.activateTaskWeeks()
      );
    } else if (!s.showTaskRibbon && this.ribbons.taskWeeks) {
      this.ribbons.taskWeeks.detach();
      delete this.ribbons.taskWeeks;
    }

    /* Resources */
    if (s.showResourcesRibbon && !this.ribbons.resources) {
      this.ribbons.resources = this.addRibbonIcon(
        "users",
        "Open Resources View",
        () => this.activateResources()
      );
    } else if (!s.showResourcesRibbon && this.ribbons.resources) {
      this.ribbons.resources.detach();
      delete this.ribbons.resources;
    }

    /* Portfolio icon is always shown – nothing to toggle */
    if (!this.ribbons.portfolio && !this.addedPortfolio) {
      this.addRibbonIcon("layers", "Open Project Management", () =>
        this.activatePortfolio()
      );
      this.addedPortfolio = true;
    }


  }
}