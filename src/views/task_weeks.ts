import {
  ItemView,
  WorkspaceLeaf,
  setIcon,
  TFile,
} from "obsidian";
/* Moment.js is available globally in Obsidian */
declare const moment: any;
import type { ViewStateResult } from "obsidian";
import { ProjectCache, TaskItem, ProjectEntry } from "../services/cache";
import { PmSettings } from "../../settings";

// Extended task interface for task weeks view
interface ExtendedTaskItem extends TaskItem {
  done?: boolean | string;
  percentComplete?: number;
  raw?: string;
  project?: { file?: { basename?: string } };
  projectName?: string;
  _isProjectDivider?: boolean;
  _projectName?: string;
}

// Load dashboard-specific stylesheet
import "../../styles/styles-task-weeks.css";

/** Helper: format a date or return an em-dash if undefined */
function formatDate(d: string | number | Date | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

/** "2025-W27" → "W27 2025 (30 Jun – 6 Jul)" */
function weekLabel(key: string): string {
  const m = key.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return key;
  const [ , yr, wk ] = m;
  // @ts-ignore moment global
  const start = moment().isoWeekYear(+yr).isoWeek(+wk).startOf("isoWeek");
  const end   = start.clone().endOf("isoWeek");
  return `W${wk} ${yr} (${start.format("D MMM")} – ${end.format("D MMM")})`;
}

/** Helper: determine status badge label and CSS class */
function projectStatus(
  nextDue?: string,
  pct = 0
): { label: string; cls: string } {
  if (pct >= 1) return { label: "Completed", cls: "complete" };
  if (!nextDue) return { label: "No date", cls: "no-date" };

  const today   = new Date();
  const due     = new Date(nextDue);
  const msInDay = 86_400_000;
  const diff    = (due.getTime() - today.getTime()) / msInDay;

  if (diff < 0)  return { label: "Off track", cls: "off-track" }; // red
  if (diff <= 10) return { label: "Warning",  cls: "warning"   }; // orange
  return { label: "On track", cls: "on-track" };
}


/** Progress bar colour bucket */
function progressClass(pct: number): string {
  if (pct >= 100) return "done";
  if (pct >= 75)  return "high";
  if (pct >= 40)  return "medium";
  return "low";
}

/** Tooltip explaining status */
function statusTooltip(nextDue?: string, pct = 0): string {
  if (pct >= 1) return "Task reached 100 % completion";
  if (!nextDue) return "No due date set";
  const today   = new Date();
  const due     = new Date(nextDue);
  const msInDay = 86_400_000;
  const diff    = Math.ceil((due.getTime() - today.getTime()) / msInDay);

  if (diff < 0)  return `Past due by ${-diff} day${diff === -1 ? "" : "s"} (due ${formatDate(due)})`;
  if (diff === 0) return "Due today";
  if (diff <= 10) return `Due in ${diff} day${diff === 1 ? "" : "s"} (${formatDate(due)})`;
  return `Due on ${formatDate(due)}`;
}

/** Detect whether a task is completed */
function isTaskDone(t: ExtendedTaskItem): boolean {
  /* explicit flags from parsers */
  if (t.done === true || t.checked === true) return true;
  if (typeof t.done === "string" && t.done.toLowerCase() === "done") return true;

  /* explicit status strings */
  if (typeof t.status === "string") {
    const s = t.status.toLowerCase();
    if (["done", "complete", "completed"].includes(s)) return true;
  }

  /* percent-complete field */
  if (typeof t.percentComplete === "number" && t.percentComplete >= 1) return true;

  /* markdown checkbox or bullet */
  const raw = (t.raw ?? t.text ?? "").toString();
  if (/^\s*-\s*\[[xX]\]/.test(raw)) return true;

  /* completed:: 2025‑05‑01 inline field or front‑matter */
  if (t.props?.completed || t.props?.["completionDate"]) return true;

  return false;
}

/**
 * Return tasks ordered as in Timeline:
 *   • Epics (E‑) first
 *   • then Stories (S‑) each followed by their SB‑ sub‑tasks
 *   • anything else afterwards in original order
 */
function orderTasksDash(tasks: ExtendedTaskItem[]): ExtendedTaskItem[] {
  const done = new Set<ExtendedTaskItem>();
  const out: ExtendedTaskItem[] = [];

  const pushWithSubs = (t: ExtendedTaskItem) => {
    if (done.has(t)) return;
    done.add(t);
    out.push(t);

    // Push SB‑ tasks that depend on this Story
    tasks.forEach((sb) => {
      if (done.has(sb)) return;
      const id   = (sb.id ?? "").toLowerCase();
      if (!id.startsWith("sb")) return;
      const deps = (sb.depends ?? []).map((d: string) => d.toLowerCase());
      if (deps.includes((t.id ?? "").toLowerCase())) pushWithSubs(sb);
    });
  };

  tasks.forEach((t) => {
    if (done.has(t)) return;
    const id = (t.id ?? "").toLowerCase();

    if (id.startsWith("e")) {          // Epics first
      pushWithSubs(t);
    } else if (id.startsWith("s") && !id.startsWith("sb")) { // Stories next
      pushWithSubs(t);
    }
  });

  // Append any remaining tasks (including standalone SB or others)
  tasks.forEach((t) => { if (!done.has(t)) out.push(t); });

  return out;
}

export const VIEW_TYPE_PM_TASKWEEKS = "pm-task-weeks-view";

export class TaskWeeksView extends ItemView {
  /** icon shown on the view tab */
  public icon = "calendar-check";
  /** Optional set of project file paths to display (injected by Portfolio view) */
  private filterPaths?: Set<string>;
  /** Optional name of the portfolio that opened this dashboard */
  private filterName?: string;
  /** The initial project paths passed in from Portfolio (null = no portfolio) */
  private originalPaths: string[] | null = null;
  private sortField: string | null = null;
  private sortAsc = true;
  private collapsed = new Set<string>();
  private firstRender = true;
  private totalGroups = 0;        // number of week rows in current render
  private currentPaths: string[] = [];   // paths (week keys) shown in latest render
  private visibleWeekPaths: string[] = [];   // paths of weeks that passed filters in last render
  private showEpics = true;                // show/hide epics
  private showStories = true;              // show/hide stories
  private showSubTasks = true;             // show/hide sub-tasks
  private displayMode: 'start' | 'due' = 'start';  // display tasks by start date or due date
  private sortMode: 'project' | 'hierarchical' | 'alphabetical' = 'project';  // project grouping, hierarchical, or alphabetical
  private collapsedProjects = new Set<string>();  // track collapsed project dividers

  private cache: ProjectCache;
  private settings: PmSettings;
  private container!: HTMLElement;
  private detachFn: (() => void) | null = null;

  private filterText = "";                 // live text in the quick-filter box
  /** Optional set of assignee names to display */
  private assigneeFilter: Set<string> | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    cache: ProjectCache,
    settings: PmSettings
  ) {
    super(leaf);
    this.cache = cache;
    this.settings = settings;
  }

  /** Called when leaf.setViewState({ state }) is invoked */
  async setState(state: { filterProjects?: string[]; filterName?: string } | undefined, result: ViewStateResult): Promise<void> {
    if (
      state &&
      Array.isArray(state.filterProjects) &&
      state.filterProjects.length > 0
    ) {
      this.filterPaths   = new Set(state.filterProjects as string[]);
      this.originalPaths = [...state.filterProjects];     // remember portfolio set
    } else {
      this.filterPaths   = undefined;          // empty array or undefined ⇒ show all
      this.originalPaths = null;
    }
    if (typeof state?.filterName === "string" && state.filterName.trim() !== "") {
      this.filterName = state.filterName.trim();
    } else {
      this.filterName = undefined;
    }
    this.render();
  }

  /** Update project filter & re-render.
      Pass `null` => show ALL projects.                         */
  public updateFilter(paths: string[] | null, name = "") {
    if (paths === null) {
      /* Show ALL projects */
      this.filterPaths = undefined;
    } else if (Array.isArray(paths)) {
      /* Show NONE if empty array, else selected set */
      this.filterPaths = paths.length ? new Set(paths) : new Set<string>();
    }
    this.filterName = name;
    this.render();
  }

  getViewType(): string {
    return VIEW_TYPE_PM_TASKWEEKS;
  }
  getDisplayText(): string {
    return this.filterName
      ? `Tasks – ${this.filterName}`
      : "Tasks";
  }

  getIcon(): string {
    return "calendar-check";
  }

  async onOpen() {
    this.container = this.contentEl;

    /* Apply initial filterProjects / filterName passed via view‑state */
    const st = (this.leaf.getViewState() as any).state ?? {};
    if (Array.isArray(st.filterProjects) && st.filterProjects.length) {
      this.filterPaths   = new Set(st.filterProjects);
      this.originalPaths = [...st.filterProjects];        // keep original list
    } else {
      this.filterPaths   = undefined;
      this.originalPaths = null;
    }
    this.filterName = typeof st.filterName === "string" ? st.filterName.trim() : "";

    this.render();
    this.detachFn = this.cache.onChange(() => this.render());
  }
  async onClose() {
    this.detachFn?.();
  }

  /** Returns true if every project row is collapsed */
  private allCollapsed(): boolean {
    // If we have visible week paths, check if they're all collapsed
    if (this.visibleWeekPaths.length > 0) {
      return this.visibleWeekPaths.every(path => this.collapsed.has(path));
    }
    // If no visible week paths yet, check if we have any collapsed items
    // This handles the initial state where everything starts collapsed
    return this.collapsed.size > 0;
  }

  /** Collapse or expand all projects at once */
  private toggleAll() {
    // Use the visible week paths captured during the latest render
    const visiblePaths = this.visibleWeekPaths;
    
    const allCollapsed = visiblePaths.length > 0 && visiblePaths.every(path => this.collapsed.has(path));
    
    if (allCollapsed) {
      // Expand: remove visible paths from collapsed set
      visiblePaths.forEach(path => this.collapsed.delete(path));
    } else {
      // Collapse: add visible paths to collapsed set
      visiblePaths.forEach(path => this.collapsed.add(path));
    }
    this.render();
  }

  /** Toggle fold / unfold for one project and re-render */
  private toggle(path: string) {
    if (this.collapsed.has(path)) this.collapsed.delete(path);
    else this.collapsed.add(path);
    this.render();
  }

  /** Check if all projects are currently collapsed */
  private areAllProjectsCollapsed(): boolean {
    if (this.sortMode !== 'project' && this.sortMode !== 'hierarchical') {
      return false; // Not applicable for alphabetical mode
    }
    
    // Get all unique project names from the current data
    const projectNames = new Set<string>();
    this.cache.projects.forEach((project: ProjectEntry) => {
      project.tasks?.forEach((task: TaskItem) => {
        const projectName = project.file.basename ?? "Unknown Project";
        projectNames.add(projectName);
      });
    });
    
    // Check if all projects are in the collapsed set
    return Array.from(projectNames).every(projectName => 
      this.collapsedProjects.has(projectName)
    );
  }

  /** Collapse all projects */
  private collapseAllProjects(): void {
    if (this.sortMode !== 'project' && this.sortMode !== 'hierarchical') {
      return; // Not applicable for alphabetical mode
    }
    
    // Get all unique project names and add them to collapsed set
    this.cache.projects.forEach((project: ProjectEntry) => {
      project.tasks?.forEach((task: TaskItem) => {
        const projectName = project.file.basename ?? "Unknown Project";
        this.collapsedProjects.add(projectName);
      });
    });
  }

  /** Toggle task completion status */
  private async toggleTaskCompletion(task: ExtendedTaskItem, done: boolean): Promise<void> {
    const file = (task as any).file;
    if (!file) return;

    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const checkboxRegex = /\[[ xX\/-]\]/;

    // Find the task line
    let lineIdx = typeof task.line === "number" ? task.line : -1;
    if (!(lineIdx >= 0 && checkboxRegex.test(lines[lineIdx]))) {
      lineIdx = lines.findIndex(
        (line) => line.includes(task.text ?? "") && checkboxRegex.test(line)
      );
    }

    if (lineIdx >= 0) {
      const match = lines[lineIdx].match(/\[[ xX\/-]\]/);
      if (match) {
        const replacement = done ? "[x]" : "[ ]";
        lines[lineIdx] = lines[lineIdx].replace(/\[[ xX\/-]\]/, replacement);
        await this.app.vault.modify(file, lines.join("\n"));
        this.render();
      }
    }
  }

  private render() {
    this.container.empty();
    this.container.addClass("pm-task-weeks-view");

    // Clear any lingering tooltips
    document.querySelectorAll('.pm-dash-tooltip').forEach((el) => el.remove());

    /* ── Fold/Unfold top bar ───────────────────────── */
    const topbar = this.container.createEl("div", { cls: "pm-dash-topbar" });
    const globalCaret = topbar.createEl("span", { cls: "pm-global-caret" });
    globalCaret.style.cursor = "pointer";
    globalCaret.setAttr("aria-label", "Toggle all weeks");
    setIcon(globalCaret, "chevron-right"); // Will be updated later after processing weeks
    globalCaret.onclick = () => this.toggleAll();
    topbar.createEl("span", { text: "Weeks" });

    /* Display mode toggle */
    const modeToggle = topbar.createEl("button", { 
      cls: "pm-mode-toggle"
    });
    setIcon(modeToggle, this.displayMode === 'start' ? 'clock' : 'check-circle');
    
    // Custom tooltip functionality
    let tooltip: HTMLElement | null = null;
    let tooltipTimeout: NodeJS.Timeout | null = null;
    
    const showTooltip = (event: MouseEvent) => {
      if (tooltip) return;
      
      tooltip = document.createElement('div');
      tooltip.className = 'pm-dash-tooltip';
      tooltip.textContent = `Currently showing tasks by ${this.displayMode} date. Click to switch.`;
      
      document.body.appendChild(tooltip);
      
      // Position tooltip near the button
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      tooltip.style.left = `${rect.left}px`;
      tooltip.style.top = `${rect.bottom + 8}px`;
    };
    
    const hideTooltip = () => {
      if (tooltip) {
        tooltip.remove();
        tooltip = null;
      }
      if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
        tooltipTimeout = null;
      }
    };
    
    modeToggle.addEventListener('mouseenter', (event) => {
      tooltipTimeout = setTimeout(() => showTooltip(event), 500);
    });
    
    modeToggle.addEventListener('mouseleave', hideTooltip);
    
    modeToggle.onclick = () => {
      hideTooltip();
      this.displayMode = this.displayMode === 'start' ? 'due' : 'start';
      setIcon(modeToggle, this.displayMode === 'start' ? 'clock' : 'check-circle');
      // Update tooltip text for next hover
      const newTooltipText = `Currently showing tasks by ${this.displayMode} date. Click to switch.`;
      modeToggle.setAttribute('data-tooltip', newTooltipText);
      
      // Preserve current collapsed state before re-rendering
      const wasAllCollapsed = this.allCollapsed();
      this.render();
      
      // If it was all collapsed before, collapse all again after re-render
      if (wasAllCollapsed) {
        this.visibleWeekPaths.forEach(path => this.collapsed.add(path));
        // Also immediately reflect the caret icon to match the restored state
        const caretEl = this.container.querySelector<HTMLElement>(".pm-global-caret");
        if (caretEl) setIcon(caretEl, this.allCollapsed() ? "chevron-right" : "chevron-down");
      }
    };

    /* Task sorting toggle */
    const sortToggle = topbar.createEl("button", { 
      cls: "pm-mode-toggle"
    });
    setIcon(sortToggle, this.sortMode === 'project' ? 'folder' : this.sortMode === 'hierarchical' ? 'list-tree' : 'sort-asc');
    
    // Custom tooltip functionality for sort toggle
    let sortTooltip: HTMLElement | null = null;
    let sortTooltipTimeout: NodeJS.Timeout | null = null;
    
    const showSortTooltip = (event: MouseEvent) => {
      if (sortTooltip) return;
      
      sortTooltip = document.createElement('div');
      sortTooltip.className = 'pm-dash-tooltip';
      sortTooltip.textContent = this.sortMode === 'project' 
        ? "Currently grouping by project. Click for hierarchical sorting."
        : this.sortMode === 'hierarchical'
        ? "Currently sorting hierarchically. Click for alphabetical sorting."
        : "Currently sorting alphabetically. Click for project grouping.";
      
      document.body.appendChild(sortTooltip);
      
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      sortTooltip.style.left = `${rect.left}px`;
      sortTooltip.style.top = `${rect.bottom + 8}px`;
    };
    
    const hideSortTooltip = () => {
      if (sortTooltip) {
        sortTooltip.remove();
        sortTooltip = null;
      }
      if (sortTooltipTimeout) {
        clearTimeout(sortTooltipTimeout);
        sortTooltipTimeout = null;
      }
    };
    
    sortToggle.addEventListener('mouseenter', (event) => {
      sortTooltipTimeout = setTimeout(() => showSortTooltip(event), 500);
    });
    
    sortToggle.addEventListener('mouseleave', hideSortTooltip);
    
    sortToggle.onclick = () => {
      hideSortTooltip();
      // Cycle through the three modes: project → hierarchical → alphabetical → project
      this.sortMode = this.sortMode === 'project' ? 'hierarchical' : 
                     this.sortMode === 'hierarchical' ? 'alphabetical' : 'project';
      setIcon(sortToggle, this.sortMode === 'project' ? 'folder' : this.sortMode === 'hierarchical' ? 'list-tree' : 'sort-asc');
      this.render();
    };

    /* Global project collapse/expand toggle */
    const globalProjectToggle = topbar.createEl("button", { 
      cls: "pm-mode-toggle"
    });
    setIcon(globalProjectToggle, "chevrons-down-up");
    
    // Global project toggle tooltip
    let globalTooltip: HTMLElement | null = null;
    let globalTooltipTimeout: NodeJS.Timeout | null = null;
    
    const showGlobalTooltip = (event: MouseEvent) => {
      if (globalTooltip) return;
      
      globalTooltip = document.createElement('div');
      globalTooltip.className = 'pm-dash-tooltip';
      globalTooltip.textContent = "Toggle all projects expand/collapse";
      
      document.body.appendChild(globalTooltip);
      
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      globalTooltip.style.left = `${rect.left}px`;
      globalTooltip.style.top = `${rect.bottom + 8}px`;
    };
    
    const hideGlobalTooltip = () => {
      if (globalTooltip) {
        globalTooltip.remove();
        globalTooltip = null;
      }
      if (globalTooltipTimeout) {
        clearTimeout(globalTooltipTimeout);
        globalTooltipTimeout = null;
      }
    };
    
    globalProjectToggle.addEventListener('mouseenter', (event) => {
      globalTooltipTimeout = setTimeout(() => showGlobalTooltip(event), 500);
    });
    
    globalProjectToggle.addEventListener('mouseleave', hideGlobalTooltip);
    
    globalProjectToggle.onclick = () => {
      hideGlobalTooltip();
      
      // Preserve scroll position
      const tableContainer = this.container.querySelector('.pm-table-container');
      const scrollTop = tableContainer?.scrollTop || 0;
      const scrollHeight = tableContainer?.scrollHeight || 0;
      
      // Check if all projects are currently collapsed
      const allCollapsed = this.areAllProjectsCollapsed();
      
      if (allCollapsed) {
        // Expand all projects
        this.collapsedProjects.clear();
      } else {
        // Collapse all projects
        this.collapseAllProjects();
      }
      
      this.render();
      
      // Restore scroll position with adjustment for content height changes
      const restoreScroll = () => {
        const newTableContainer = this.container.querySelector('.pm-table-container');
        if (newTableContainer) {
          const newScrollHeight = newTableContainer.scrollHeight;
          const heightRatio = scrollHeight > 0 ? newScrollHeight / scrollHeight : 1;
          const adjustedScrollTop = scrollTop * heightRatio;
          newTableContainer.scrollTop = adjustedScrollTop;
        }
      };
      
      // Try immediately, then with delays
      restoreScroll();
      setTimeout(restoreScroll, 10);
      setTimeout(restoreScroll, 50);
      setTimeout(restoreScroll, 100);
    };

    /* Task filter input now lives in the top bar */
    const searchInput = topbar.createEl("input", {
      type: "search",
      placeholder: "Filter tasks…",
      cls: "pm-search-input",
      value: this.filterText,
    });

    searchInput.oninput = () => {
      this.filterText = searchInput.value.toLowerCase();
      const caretPos = searchInput.selectionStart ?? searchInput.value.length;
      this.render();

      const again = this.container.querySelector<HTMLInputElement>(".pm-search-input");
      if (again) {
        again.focus();
        again.setSelectionRange(caretPos, caretPos);
      }
    };

    /* ── Projects dropdown (checkbox list) ─────────────────── */
    const projBtn = topbar.createEl("button", { cls: "pm-proj-btn" });
    projBtn.createSpan({ text: "Projects " });
    const projCaret = projBtn.createSpan();
    setIcon(projCaret, "chevron-down");

    let ddOpen = false;
    let ddEl: HTMLElement | null = null;

    const buildDropdown = (projectList: ProjectEntry[]) => {
      ddEl = document.createElement("div");
      ddEl.className = "pm-proj-dd";

      /* Select/Deselect controls */
      const controls = ddEl.createEl("div", { cls: "pm-proj-dd-ctl" });

      /* ALL */
      controls.createEl("a", { text: "All" }).onclick = (e) => {
        e.preventDefault();
        closeDropdown();
        /* Keep current portfolio name so middle option remains visible */
        this.updateFilter(null, this.filterName ?? "");
        setTimeout(() => this.container.querySelector<HTMLButtonElement>(".pm-proj-btn")?.click(), 0);
      };

      /* PORTFOLIO (only if originalPaths present) */
      if (this.originalPaths && this.originalPaths.length) {
        controls.createSpan({ text: " | " });
        controls.createEl("a", { text: this.filterName ?? "Portfolio" }).onclick = (e) => {
          e.preventDefault();
          closeDropdown();
          this.updateFilter([...this.originalPaths!], this.filterName ?? "");
          setTimeout(() => this.container.querySelector<HTMLButtonElement>(".pm-proj-btn")?.click(), 0);
        };
      }

      /* NONE */
      controls.createSpan({ text: " | " });
      controls.createEl("a", { text: "None" }).onclick = (e) => {
        e.preventDefault();
        closeDropdown();
        /* Preserve portfolio name so the middle option stays visible */
        this.updateFilter([], this.filterName ?? "");
        setTimeout(() => this.container.querySelector<HTMLButtonElement>(".pm-proj-btn")?.click(), 0);
      };

      /* Checkbox list */
      projectList.forEach((p: ProjectEntry) => {
        const wrap = ddEl!.createEl("div", { cls: "pm-proj-dd-item" });
        const cb = wrap.createEl("span", { cls: "pm-dd-check" });
        cb.style.cursor = "pointer";
        cb.style.marginRight = "8px";
        cb.style.display = "inline-block";
        cb.style.width = "16px";
        cb.style.height = "16px";
        wrap.createSpan({ text: ` ${p.file.basename}` });

        const isChecked = !this.filterPaths || this.filterPaths.has(p.file.path);
        setIcon(cb, isChecked ? "check-circle" : "circle");
        
        // Store the project path on the element for easy access
        cb.setAttribute("data-project-path", p.file.path);
        cb.setAttribute("data-checked", isChecked.toString());
        wrap.onclick = () => {
          const currentChecked = cb.getAttribute("data-checked") === "true";
          const newChecked = !currentChecked;
          
          cb.setAttribute("data-checked", newChecked.toString());
          setIcon(cb, newChecked ? "check-circle" : "circle");
          
          /* gather all check icons to compute new filter */
          const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check"));
          const selected = checkIcons
            .filter(icon => icon.getAttribute("data-checked") === "true")
            .map(icon => icon.getAttribute("data-project-path")!);

          const newFilter =
            selected.length === projectList.length ? null : selected;

          /* Pass through existing filterName so it doesn’t get cleared */
          this.updateFilter(newFilter, this.filterName ?? "");
        };
      });

      document.body.appendChild(ddEl);
      /* Position below the button, but prevent overflow */
      const r   = projBtn.getBoundingClientRect();
      const pad = 4;                         // minimal margin from window edge

      let left = r.left;
      let top  = r.bottom + pad;             // default: below button

      /* Measure after insertion */
      const ddW = ddEl.offsetWidth  || 240;
      const ddH = ddEl.offsetHeight || 260;

      /* Prevent horizontal overflow - check both left and right edges */
      if (left + ddW > window.innerWidth - pad) {
        left = Math.max(window.innerWidth - ddW - pad, pad);
      }
      if (left < pad) {
        left = pad;
      }

      /* Prevent vertical overflow – if no room below, place above */
      if (top + ddH > window.innerHeight - pad) {
        const above = r.top - ddH - pad;
        top = above >= pad ? above
                           : Math.max(window.innerHeight - ddH - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }

      ddEl.style.left = `${left}px`;
      ddEl.style.top  = `${top}px`;
    };

    const closeDropdown = () => {
      ddEl?.remove();
      ddEl = null;
      ddOpen = false;
      setIcon(projCaret, "chevron-down");
    };

    projBtn.onclick = () => {
      if (ddOpen) {
        closeDropdown();
        return;
      }
      ddOpen = true;
      setIcon(projCaret, "chevron-up");

      /* Build project list based on current cache + initial portfolio filter */
      const projectList = Array.from(this.cache.projects.values())   // list every project
        .sort((a, b) => a.file.basename.localeCompare(b.file.basename)); // sort A-Z
      buildDropdown(projectList);

      /* Close on outside click */
      const onDoc = (e: MouseEvent) => {
        if (ddEl && !ddEl.contains(e.target as Node) && e.target !== projBtn) {
          closeDropdown();
          document.removeEventListener("mousedown", onDoc);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", onDoc));
    };

    /* ── Assignees dropdown (checkbox list) ─────────────────── */
    const asnBtn = topbar.createEl("button", { cls: "pm-ass-btn" });
    asnBtn.createSpan({ text: "Assignees " });
    const asnCaret = asnBtn.createSpan();
    setIcon(asnCaret, "chevron-down");

    let adOpen = false;
    let adEl: HTMLElement | null = null;

    const buildAssigneeDropdown = (list: string[]) => {
      adEl = document.createElement("div");
      adEl.className = "pm-proj-dd";               // reuse same styles

      /* Controls: All | None */
      /* Controls: All | <Portfolio> | None */
      const ctl = adEl.createEl("div", { cls: "pm-proj-dd-ctl" });

      /* ALL */
      ctl.createEl("a", { text: "All" }).onclick = (e) => {
        e.preventDefault();
        closeAssigneeDropdown();
        this.assigneeFilter = null;          // clear filter ⇒ show ALL tasks
        this.render();
        setTimeout(() =>
          this.container.querySelector<HTMLButtonElement>(".pm-ass-btn")?.click(), 0);
      };

      /* PORTFOLIO (if present) */
      if (this.originalPaths && this.originalPaths.length) {
        ctl.createSpan({ text: " | " });
        ctl.createEl("a", { text: this.filterName || "Portfolio" }).onclick = (e) => {
          e.preventDefault();
          closeAssigneeDropdown();

          /* Assignees only from portfolio projects */
          const port = new Set<string>();
          this.cache.projects.forEach((p: ProjectEntry) => {
            if (!this.originalPaths!.includes(p.file.path)) return;
            (p.tasks ?? []).forEach((t: TaskItem) => {
              const a = (t.props?.assignee ?? t.props?.owner ?? "")
                .toString()
                .trim();
              if (a) port.add(a.toLowerCase());
            });
          });
          this.assigneeFilter = port.size ? port : null;
          this.render();
          setTimeout(() =>
            this.container.querySelector<HTMLButtonElement>(".pm-ass-btn")?.click(), 0);
        };
      }

      /* NONE */
      ctl.createSpan({ text: " | " });
      ctl.createEl("a", { text: "None" }).onclick = (e) => {
        e.preventDefault();
        closeAssigneeDropdown();
        this.assigneeFilter = new Set<string>();   // hide all (empty set)
        this.render();
        setTimeout(() =>
          this.container.querySelector<HTMLButtonElement>(".pm-ass-btn")?.click(), 0);
      };

      /* Collect assignees from projects currently visible with the current Project filter */
      const visibleAss = new Set<string>();
      this.cache.projects.forEach((p: ProjectEntry) => {
        if (this.filterPaths && !this.filterPaths.has(p.file.path)) return;  // only projects in view
        (p.tasks ?? []).forEach((t: TaskItem) => {
          const a = (t.props?.assignee ?? t.props?.owner ?? "")
            .toString()
            .trim()
            .toLowerCase();
          if (a) visibleAss.add(a);
        });
      });

      /* Checkbox list */
      list.forEach((name) => {
        const nameKey = name.trim().toLowerCase();
        const wrap = adEl!.createEl("div", { cls: "pm-proj-dd-item" });
        const cb = wrap.createEl("span", { cls: "pm-dd-check" });
        cb.style.cursor = "pointer";
        cb.style.marginRight = "8px";
        cb.style.display = "inline-block";
        cb.style.width = "16px";
        cb.style.height = "16px";
        
        const autoChecked = this.assigneeFilter
          ? this.assigneeFilter.has(nameKey)      // keep existing selection if user changed it
          : visibleAss.has(nameKey);              // default = assignees from visible projects
        
        setIcon(cb, autoChecked ? "check-circle" : "circle");
        
        // Store the assignee name on the element for easy access
        cb.setAttribute("data-assignee", nameKey);
        cb.setAttribute("data-checked", autoChecked.toString());
        
        wrap.createSpan({ text: name });
        
        wrap.onclick = () => {
          const currentChecked = cb.getAttribute("data-checked") === "true";
          const newChecked = !currentChecked;
          
          cb.setAttribute("data-checked", newChecked.toString());
          setIcon(cb, newChecked ? "check-circle" : "circle");
          
          /* gather all check icons to compute new filter */
          const checkIcons = Array.from(adEl!.querySelectorAll(".pm-dd-check"));
          const selected = checkIcons
            .filter(icon => icon.getAttribute("data-checked") === "true")
            .map(icon => icon.getAttribute("data-assignee")!);

          this.assigneeFilter =
            selected.length === list.length ? null : new Set(selected);
          this.render();
        };
      });

      document.body.appendChild(adEl);
      const r   = asnBtn.getBoundingClientRect();
      const pad = 4;

      let left = r.left;
      let top  = r.bottom + pad;

      /* Prevent horizontal overflow - check both left and right edges */
      if (left + adEl.offsetWidth > window.innerWidth - pad) {
        left = Math.max(window.innerWidth - adEl.offsetWidth - pad, pad);
      }
      if (left < pad) {
        left = pad;
      }

      /* Prevent vertical overflow – if no room below, place above */
      if (top + adEl.offsetHeight > window.innerHeight - pad) {
        const above = r.top - adEl.offsetHeight - pad;
        top = above >= pad ? above
                           : Math.max(window.innerHeight - adEl.offsetHeight - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }

      adEl.style.left = `${left}px`;
      adEl.style.top  = `${top}px`;
    };

    const closeAssigneeDropdown = () => {
      adEl?.remove();
      adEl = null;
      adOpen = false;
      setIcon(asnCaret, "chevron-down");
    };

    asnBtn.onclick = () => {
      if (adOpen) {
        closeAssigneeDropdown();
        return;
      }
      adOpen = true;
      setIcon(asnCaret, "chevron-up");

      /* Build unique assignee list from current cache */
      const uniq = new Set<string>();
      this.cache.projects.forEach((p: ProjectEntry) => {
        (p.tasks ?? []).forEach((t: TaskItem) => {
          const a = (t.props?.assignee ?? t.props?.owner ?? "").toString().trim();
          if (a) uniq.add(a);
        });
      });
      buildAssigneeDropdown(Array.from(uniq).sort());

      /* Close on outside click */
      const onDoc = (e: MouseEvent) => {
        if (adEl && !adEl.contains(e.target as Node) && e.target !== asnBtn) {
          closeAssigneeDropdown();
          document.removeEventListener("mousedown", onDoc);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", onDoc));
    };

    /* ── Epic, Story, and Sub-task visibility toggles ─────────────────── */
    const epicIcon = topbar.createEl("span", { cls: "pm-toggle-icon" });
    epicIcon.style.marginLeft = "16px";
    epicIcon.style.cursor = "pointer";
    setIcon(epicIcon, "crown");
    epicIcon.style.opacity = this.showEpics ? "1" : "0.3";
    epicIcon.setAttr("aria-label", this.showEpics ? "Hide Epics" : "Show Epics");
    
    // Epic icon tooltip
    let epicTip: HTMLElement | null = null;
    epicIcon.addEventListener("mouseenter", () => {
      if (epicTip) {
        epicTip.remove();
        epicTip = null;
      }
      epicTip = document.createElement("div");
      epicTip.classList.add("pm-dash-tooltip");
      epicTip.textContent = this.showEpics ? "Hide Epics" : "Show Epics";
      document.body.appendChild(epicTip);
      
      const r = epicIcon.getBoundingClientRect();
      const pad = 6;
      
      let left = r.left;
      let top = r.bottom + pad;
      
      /* Prevent horizontal overflow */
      if (left + epicTip.offsetWidth > window.innerWidth - pad) {
        left = Math.max(r.left - pad - epicTip.offsetWidth, pad);
      }
      if (left < pad) {
        left = pad;
      }
      
      /* Prevent vertical overflow */
      if (top + epicTip.offsetHeight > window.innerHeight - pad) {
        const above = r.top - epicTip.offsetHeight - pad;
        top = above >= pad ? above : Math.max(window.innerHeight - epicTip.offsetHeight - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }
      
      epicTip.style.left = `${left}px`;
      epicTip.style.top = `${top}px`;
    });
    epicIcon.addEventListener("mouseleave", () => { 
      if (epicTip) {
        epicTip.remove(); 
        epicTip = null; 
      }
    });
    
    epicIcon.onclick = () => {
      if (epicTip) {
        epicTip.remove();
        epicTip = null;
      }
      this.showEpics = !this.showEpics;
      this.render();
    };

    const storyIcon = topbar.createEl("span", { cls: "pm-toggle-icon" });
    storyIcon.style.marginLeft = "8px";
    storyIcon.style.cursor = "pointer";
    setIcon(storyIcon, "file-text");
    storyIcon.style.opacity = this.showStories ? "1" : "0.3";
    storyIcon.setAttr("aria-label", this.showStories ? "Hide Stories" : "Show Stories");
    
    // Story icon tooltip
    let storyTip: HTMLElement | null = null;
    storyIcon.addEventListener("mouseenter", () => {
      if (storyTip) {
        storyTip.remove();
        storyTip = null;
      }
      storyTip = document.createElement("div");
      storyTip.classList.add("pm-dash-tooltip");
      storyTip.textContent = this.showStories ? "Hide Stories" : "Show Stories";
      document.body.appendChild(storyTip);
      
      const r = storyIcon.getBoundingClientRect();
      const pad = 6;
      
      let left = r.left;
      let top = r.bottom + pad;
      
      /* Prevent horizontal overflow */
      if (left + storyTip.offsetWidth > window.innerWidth - pad) {
        left = Math.max(r.left - pad - storyTip.offsetWidth, pad);
      }
      if (left < pad) {
        left = pad;
      }
      
      /* Prevent vertical overflow */
      if (top + storyTip.offsetHeight > window.innerHeight - pad) {
        const above = r.top - storyTip.offsetHeight - pad;
        top = above >= pad ? above : Math.max(window.innerHeight - storyTip.offsetHeight - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }
      
      storyTip.style.left = `${left}px`;
      storyTip.style.top = `${top}px`;
    });
    storyIcon.addEventListener("mouseleave", () => { 
      if (storyTip) {
        storyTip.remove(); 
        storyTip = null; 
      }
    });
    
    storyIcon.onclick = () => {
      if (storyTip) {
        storyTip.remove();
        storyTip = null;
      }
      this.showStories = !this.showStories;
      this.render();
    };

    const subTasksIcon = topbar.createEl("span", { cls: "pm-toggle-icon" });
    subTasksIcon.style.marginLeft = "8px";
    subTasksIcon.style.cursor = "pointer";
    setIcon(subTasksIcon, "list");
    subTasksIcon.style.opacity = this.showSubTasks ? "1" : "0.3";
    subTasksIcon.setAttr("aria-label", this.showSubTasks ? "Hide Sub-tasks" : "Show Sub-tasks");
    
    // Sub-tasks icon tooltip
    let subTasksTip: HTMLElement | null = null;
    subTasksIcon.addEventListener("mouseenter", () => {
      if (subTasksTip) {
        subTasksTip.remove();
        subTasksTip = null;
      }
      subTasksTip = document.createElement("div");
      subTasksTip.classList.add("pm-dash-tooltip");
      subTasksTip.textContent = this.showSubTasks ? "Hide Sub-tasks" : "Show Sub-tasks";
      document.body.appendChild(subTasksTip);
      
      const r = subTasksIcon.getBoundingClientRect();
      const pad = 6;
      
      let left = r.left;
      let top = r.bottom + pad;
      
      /* Prevent horizontal overflow */
      if (left + subTasksTip.offsetWidth > window.innerWidth - pad) {
        left = Math.max(r.left - pad - subTasksTip.offsetWidth, pad);
      }
      if (left < pad) {
        left = pad;
      }
      
      /* Prevent vertical overflow */
      if (top + subTasksTip.offsetHeight > window.innerHeight - pad) {
        const above = r.top - subTasksTip.offsetHeight - pad;
        top = above >= pad ? above : Math.max(window.innerHeight - subTasksTip.offsetHeight - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }
      
      subTasksTip.style.left = `${left}px`;
      subTasksTip.style.top = `${top}px`;
    });
    subTasksIcon.addEventListener("mouseleave", () => { 
      if (subTasksTip) {
        subTasksTip.remove(); 
        subTasksTip = null; 
      }
    });
    
    subTasksIcon.onclick = () => {
      if (subTasksTip) {
        subTasksTip.remove();
        subTasksTip = null;
      }
      this.showSubTasks = !this.showSubTasks;
      this.render();
    };
    
    /* ── Table + header ─────────────────────────────── */
    const tableContainer = this.container.createEl("div", { cls: "pm-table-container" });
    const table = tableContainer.createEl("table", { cls: "pm-table" });
    /* Column widths: Project widest, Tasks & Status thinner */
    const colgroup = table.createEl("colgroup");
    ["48%", "12%", "8%", "8%", "24%"].forEach((w) =>
      colgroup.createEl("col", { attr: { style: `width:${w}` } })
    );
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");

    const headers: [string, string][] = [
      ["project",  "Week"],
      ["assignee", "Assignee"],
      ["tasks",    "Tasks"],
      ["status",   "Status"],
      ["origin",   "Project"],
    ];

    headers.forEach(([field, label]) => {
      const th = headerRow.createEl("th", { cls: "pm-sortable" });
      th.style.cursor = "pointer";

      /* Label text */
      th.createSpan({ text: label });

      /* Chevron icon */
      const ico = th.createSpan({ cls: "pm-sort-ico" });

      if (this.sortField === field) {
        setIcon(ico, this.sortAsc ? "chevron-up" : "chevron-down");
      } else {
        setIcon(ico, "chevrons-up-down");
        ico.style.opacity = "0.5";               /* dim when inactive */
      }

      th.onclick = () => {
        if (this.sortField === field) this.sortAsc = !this.sortAsc;
        else {
          this.sortField = field;
          this.sortAsc = true;
        }
        this.render();
      };
    });

    const tbody = table.createEl("tbody");

    /* ── Sort projects ─────────────────────────────── */
    let projects = Array.from(this.cache.projects.values()).filter(
      (p) => !this.filterPaths || this.filterPaths.has(p.file.path)
    );

    /* ── Regroup by ISO week instead of per‑project ─────────────── */
    const weekMap = new Map<string, any>();

    projects.forEach((proj: any) => {
      orderTasksDash((proj as any).tasks ?? []).forEach((t: any) => {
        /* Use selected display mode to determine which date to use for week grouping */
        const dateToUse = this.displayMode === 'start' 
          ? (t.props?.start ?? t.props?.due ?? "").toString().trim()
          : (t.props?.due ?? t.props?.start ?? "").toString().trim();
        
        if (!dateToUse) return;

        // @ts-ignore  moment is global in Obsidian
        const d = (moment as any)(dateToUse, "YYYY-MM-DD");
        if (!d.isValid()) return;

        const wkKey = `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2,"0")}`;

        /* create wrapper (once per week) */
        if (!weekMap.has(wkKey)) {
          weekMap.set(wkKey, {
            file: {           // mimic TFile shape
              basename: wkKey,
              path:     wkKey,
              stat:     { mtime: d.valueOf() }
            },
            tasks: [],
            percentComplete: 0,
            totalTasks: 0,
            completedTasks: 0,
            nextDue: undefined,
          });
        }

        const wk = weekMap.get(wkKey);
        t.projectName = proj.file.basename;   // store originating project
        t.projectPath = proj.file.path;       // store project note path
        wk.tasks.push(t);
        /* Only count SB‑ sub‑tasks in weekly tallies */
        const idLow = ((t.id ?? "") as string).toLowerCase();
        if (idLow.startsWith("sb")) {
          wk.totalTasks++;
          if (isTaskDone(t)) wk.completedTasks++;
        }

        const due = t.props?.due ?? t.props?.start;
        if (due && (!wk.nextDue || String(due) < wk.nextDue)) wk.nextDue = String(due);
      });
    });

    /* compute percentComplete for each week */
    weekMap.forEach((wk) => {
      wk.percentComplete = wk.totalTasks === 0 ? 0 : wk.completedTasks / wk.totalTasks;
    });

    /* Replace original project list with week wrappers */
    projects = Array.from(weekMap.values());
    
    /* Add today's date row at the beginning */
    const today = moment().startOf("day");
    const todayKey = "today";
    const todayTasks: any[] = [];
    
    // Collect all tasks due today
    projects.forEach((week) => {
      (week.tasks as any[]).forEach((task) => {
        const dueDate = task.props?.due ?? task.props?.start;
        if (dueDate) {
          const taskDate = moment(dueDate, "YYYY-MM-DD").startOf("day");
          if (taskDate.isSame(today)) {
            todayTasks.push(task);
          }
        }
      });
    });
    
    // Always create today's row (even if no tasks due today)
    const todayWeek: any = {
      file: {
        basename: todayKey,
        path: todayKey,
        stat: { mtime: today.valueOf() }
      },
      tasks: todayTasks,
      percentComplete: 0,
      totalTasks: 0,
      completedTasks: 0,
      nextDue: today.format("YYYY-MM-DD"),
    };
    
    // Calculate today's stats
    const sbTasks = todayTasks.filter(t => 
      ((t.id ?? "") as string).toLowerCase().startsWith("sb")
    );
    todayWeek.totalTasks = sbTasks.length;
    todayWeek.completedTasks = sbTasks.filter(isTaskDone).length;
    todayWeek.percentComplete = todayWeek.totalTasks === 0 ? 0 : todayWeek.completedTasks / todayWeek.totalTasks;
    
    // Don't add today row yet - we'll insert it after sorting
    // projects.unshift(todayWeek);
    
    this.currentPaths = projects.map(p => p.file.path);
    this.totalGroups = projects.length;        // remember for caret logic

    /* Default order on first render = nearest upcoming ISO‑week first
       (only when user hasn't clicked a sortable header) */
    if (!this.sortField) {
      const today = moment().startOf("day");
      projects.sort((a, b) => {
        const sa = moment(a.file.basename, "YYYY-[W]WW").startOf("isoWeek");
        const sb = moment(b.file.basename, "YYYY-[W]WW").startOf("isoWeek");
        return sa.diff(today) - sb.diff(today);
      });
    }

    // Auto‑collapse only on the very first render; afterwards respect user toggles
    if (this.firstRender) {
      this.collapsed = new Set(projects.map(p => p.file.path));
      // Also collapse the today row on first render
      this.collapsed.add(todayWeek.file.path);
      this.firstRender = false;
    }
    // (Defer setting caret icon until after we know how many rows are visible)
    
    if (this.sortField) {
      const dir = this.sortAsc ? 1 : -1;
      const statusRank = (p: typeof projects[number]) => {
        const { label } = projectStatus(p.nextDue, p.percentComplete);
        return ["Off track", "Warning", "On track", "Completed", "No date"].indexOf(
          label
        );
      };

      projects.sort((a, b) => {
        switch (this.sortField) {
          case "project":
            return a.file.basename.localeCompare(b.file.basename) * dir;
          case "progress":
            return (a.percentComplete - b.percentComplete) * dir;
          case "tasks":
            const ratio = (p: typeof a) =>
              (p.completedTasks ?? 0) / Math.max(p.totalTasks ?? 1, 1);
            return (ratio(a) - ratio(b)) * dir;
          case "status":
            return (statusRank(a) - statusRank(b)) * dir;
          case "nextDue": {
            const dv = (d?: string) =>
              d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
            return (dv(a.nextDue) - dv(b.nextDue)) * dir;
          }
          case "lastUpdated":
            return (
              ((a.file.stat?.mtime ?? 0) - (b.file.stat?.mtime ?? 0)) * dir
            );
          default:
            return 0;
        }
      });
    }

    /* Now insert today row in the correct chronological position */
    const todayDate = moment().startOf("day");
    let insertIndex = 0;

    if (this.sortField === "nextDue") {
      const dir = this.sortAsc ? 1 : -1;
      if (dir === 1) { // Ascending
        insertIndex = projects.findIndex(p => {
          const weekDate = p.nextDue ? moment(p.nextDue, "YYYY-MM-DD").startOf("day") : moment().add(1, "year");
          return weekDate.isSameOrAfter(todayDate);
        });
        if (insertIndex === -1) insertIndex = projects.length;
      } else { // Descending
        insertIndex = projects.findIndex(p => {
          const weekDate = p.nextDue ? moment(p.nextDue, "YYYY-MM-DD").startOf("day") : moment().subtract(1, "year");
          return weekDate.isSameOrBefore(todayDate);
        });
        if (insertIndex === -1) insertIndex = projects.length;
      }
    } else {
      insertIndex = 0; // For other sorts, place today at the beginning
    }

    projects.splice(insertIndex, 0, todayWeek);
    
    // Update total groups count after adding today row
    this.totalGroups = projects.length;

    /* Helper: show styled tooltip for status cells */
    const attachStatusPopup = (cell: HTMLElement, msg: string) => {
      let tip: HTMLElement | null = null;
      cell.addEventListener("mouseenter", (ev) => {
        const mouse = ev as MouseEvent;
        tip = document.createElement("div");
        tip.className = "pm-dash-tooltip";
        tip.textContent = msg;
        document.body.appendChild(tip);

        const pad = 8;

        /* default: below-right of cursor */
        let left = mouse.clientX + pad;
        let top  = mouse.clientY + pad;

        /* Horizontal overflow – flip to left of cursor */
        if (left + tip.offsetWidth > window.innerWidth - pad) {
          left = mouse.clientX - tip.offsetWidth - pad;
        }
        /* Vertical overflow – flip above cursor */
        if (top + tip.offsetHeight > window.innerHeight - pad) {
          top = mouse.clientY - tip.offsetHeight - pad;
        }
        if (left < pad) left = pad;
        if (top < pad)  top  = pad;

        tip.style.left = `${left}px`;
        tip.style.top  = `${top}px`;
      });
      cell.addEventListener("mouseleave", () => {
        tip?.remove();
        tip = null;
      });
    };

    /* ── Project rows ─────────────────────────────── */
    let visibleWeeks = 0;
    let collapsedWeeks = 0;
    this.visibleWeekPaths = [];
    for (const project of projects) {
      /* ── Evaluate filters *before* rendering this week ── */
      const matchesFilter = this.filterText
        ? (project.tasks as any[]).some(t => {
            const hay = `${t.text ?? ""} ${(t.id ?? "")}`.toLowerCase();
            return hay.includes(this.filterText);
          })
        : true;                                   // no quick‑filter ⇒ match

      // Special handling for today's row - always show it regardless of assignee filter
      const isToday = project.file.basename === "today";
      
      const matchesAssignees = isToday 
        ? true                                    // always show today's row
        : this.assigneeFilter === null
        ? true                                    // no assignee filter ⇒ match
        : this.assigneeFilter.size === 0
          ? false                                 // “None” ⇒ hide week
          : (project.tasks as any[]).some(t => {
              const a = (t.assignee ??
                         t.props?.assignee ??
                         t.owner ??
                         t.props?.owner ??
                         "")
                .toString()
                .trim()
                .toLowerCase();
              return this.assigneeFilter!.has(a);
            });

      /* Skip this week entirely if it fails either filter */
      if (!matchesFilter || !matchesAssignees) continue;

      visibleWeeks++;
      this.visibleWeekPaths.push(project.file.path);

      const row = tbody.createEl("tr");

      /* Auto‑expand only when a quick‑filter is active *and* this week matches it */
      const autoExpand =
        this.filterText && matchesFilter;

      const isCollapsed =
        this.collapsed.has(project.file.path) && !autoExpand;

      if (isCollapsed) collapsedWeeks++;

      if (isToday) {
        // Simple today row without chevron or clickable link
        const nameCell = row.createEl("td", { cls: "pm-dash-name" });
        nameCell.createEl("span", { 
          text: `Today (${today.format("D MMM YYYY")})`,
          cls: "pm-today-label"
        });
      } else {
        // Regular week row with chevron and clickable link
        const nameCell = row.createEl("td", { cls: "pm-dash-name" });
        const caret = nameCell.createEl("span");
        setIcon(caret, isCollapsed ? "chevron-right" : "chevron-down");
        caret.style.marginRight = "4px";
        caret.style.cursor = "pointer";
        caret.onclick = (e) => {
          e.stopPropagation();
          this.toggle(project.file.path);
        };

        const displayText = weekLabel(project.file.basename);
        nameCell.createEl("span", {
          text: displayText,
        });
      }

      /* Calculate task tally – fall back to pre‑computed cache fields */
      let totalTasks: number;
      let doneTasks:  number;

      if (Array.isArray((project as any).tasks)) {
        const projTasks: any[] = (project as any).tasks;
        const subTasks = projTasks.filter((tk) =>
          ((tk.id ?? "") as string).toUpperCase().startsWith("SB")
        );
        totalTasks = subTasks.length;
        doneTasks  = subTasks.filter(isTaskDone).length;
      } else {
        totalTasks = (project as any).totalTasks ?? 0;
        doneTasks  = (project as any).completedTasks ?? 0;
      }

      /* Assignee column (leave blank for week rows) */
      row.createEl("td");   // empty cell

      /* Use project.percentComplete for status calculations */
      const pctNum = Math.round((project as any).percentComplete * 100);

      /* Tasks ✓/total (+ red ! if total > 20) – skip for Today row */
      if (!isToday) {
        const tasksCell = row.createEl("td", {
          text: `${doneTasks} / ${totalTasks}`,
        });

                        if (totalTasks > this.settings.taskWeeksOverloadThreshold) {
          tasksCell.createEl("span", {
            text: " !",
            cls: "pm-overload",
          });
        }
      } else {
        row.createEl("td"); // empty cell for Today
      }

      /* Status – skip for Today row */
      if (!isToday) {
        const { label, cls } = projectStatus(
          project.nextDue,
          pctNum / 100      // 1 ⇒ “Completed”
        );
        const wTd = row.createEl("td");
        wTd.createEl("span", {
          cls:  `pm-badge ${cls}`,
          text: label,
        });
        attachStatusPopup(wTd, statusTooltip(project.nextDue, pctNum / 100));
      } else {
        row.createEl("td"); // empty cell for Today
      }

      /* Project column (blank for week rows) */
      row.createEl("td");


      /* ── Task sub-rows ─────────────────────────── */
      if (!isToday && !isCollapsed && Array.isArray((project as any).tasks)) {
        /* Sort tasks based on toggle setting */
        let tasks: any[];
        if (this.sortMode === 'project') {
          // Group tasks by project, then sort by type within each project
          const projectGroups = new Map<string, any[]>();
          
          // Group tasks by their project
          (project as any).tasks.forEach((t: any) => {
            const projectName = t.projectName ?? t.project?.file?.basename ?? "Unknown Project";
            if (!projectGroups.has(projectName)) {
              projectGroups.set(projectName, []);
            }
            projectGroups.get(projectName)!.push(t);
          });
          
          // Sort projects alphabetically, then sort tasks within each project
          const sortedProjects = Array.from(projectGroups.keys()).sort();
          tasks = [];
          
          for (let i = 0; i < sortedProjects.length; i++) {
            const projectName = sortedProjects[i];
            const projectTasks = projectGroups.get(projectName)!;
            
            // Add project divider for all projects
            tasks.push({ 
              _isProjectDivider: true, 
              _projectName: projectName,
              _originalTasks: projectTasks 
            });
            
            // Sort tasks within this project by type (Epics → Stories → Subtasks)
            const sortedProjectTasks = orderTasksDash(projectTasks);
            tasks.push(...sortedProjectTasks);
          }
        } else if (this.sortMode === 'hierarchical') {
          // Group tasks by project, then sort hierarchically within each project
          const projectGroups = new Map<string, any[]>();
          
          // Group tasks by their project
          (project as any).tasks.forEach((t: any) => {
            const projectName = t.projectName ?? t.project?.file?.basename ?? "Unknown Project";
            if (!projectGroups.has(projectName)) {
              projectGroups.set(projectName, []);
            }
            projectGroups.get(projectName)!.push(t);
          });
          
          // Sort projects alphabetically, then sort tasks hierarchically within each project
          const sortedProjects = Array.from(projectGroups.keys()).sort();
          tasks = [];
          
          for (let i = 0; i < sortedProjects.length; i++) {
            const projectName = sortedProjects[i];
            const projectTasks = projectGroups.get(projectName)!;
            
            // Add project divider for all projects
            tasks.push({ 
              _isProjectDivider: true, 
              _projectName: projectName,
              _originalTasks: projectTasks 
            });
            
            // Sort tasks within this project hierarchically (Epics → Stories → Subtasks)
            const sortedProjectTasks = orderTasksDash(projectTasks);
            tasks.push(...sortedProjectTasks);
          }
        } else {
          // Sort alphabetically by task text
          tasks = [...(project as any).tasks as any[]].sort((a, b) => {
            const textA = (a.text ?? "").toLowerCase();
            const textB = (b.text ?? "").toLowerCase();
            return textA.localeCompare(textB);
          });
        }
        for (const t of tasks) {
          // Handle project divider rows
          if ((t as any)._isProjectDivider) {
            const projectName = (t as any)._projectName;
            const isProjectCollapsed = this.collapsedProjects.has(projectName);
            
            const dividerRow = tbody.createEl("tr", { cls: "pm-project-divider" });
            
            // Create a full-width divider cell
            const dividerCell = dividerRow.createEl("td", { 
              cls: "pm-project-divider-cell",
              attr: { colspan: "5" }
            });
            
            // Create the divider content with chevron
            const dividerContent = dividerCell.createEl("div", { cls: "pm-project-divider-content" });
            
            // Chevron button
            const chevron = dividerContent.createEl("span", { cls: "pm-project-chevron" });
            setIcon(chevron, isProjectCollapsed ? "chevron-right" : "chevron-down");
            chevron.style.cursor = "pointer";
            chevron.style.marginRight = "8px";
            
            // Project name
            const projectText = dividerContent.createEl("span", { 
              cls: "pm-project-divider-text",
              text: projectName
            });
            
            // Visual separator line
            const dividerLine = dividerContent.createEl("div", { cls: "pm-project-divider-line" });
            
            // Click handler for the entire divider row
            dividerRow.style.cursor = "pointer";
            dividerRow.onclick = () => {
              // Preserve scroll position
              const tableContainer = this.container.querySelector('.pm-table-container');
              const scrollTop = tableContainer?.scrollTop || 0;
              const scrollHeight = tableContainer?.scrollHeight || 0;
              
              if (this.collapsedProjects.has(projectName)) {
                this.collapsedProjects.delete(projectName);
              } else {
                this.collapsedProjects.add(projectName);
              }
              
              this.render();
              
              // Restore scroll position with adjustment for content height changes
              const restoreScroll = () => {
                const newTableContainer = this.container.querySelector('.pm-table-container');
                if (newTableContainer) {
                  const newScrollHeight = newTableContainer.scrollHeight;
                  const heightRatio = scrollHeight > 0 ? newScrollHeight / scrollHeight : 1;
                  const adjustedScrollTop = scrollTop * heightRatio;
                  newTableContainer.scrollTop = adjustedScrollTop;
                }
              };
              
              // Try immediately, then with delays
              restoreScroll();
              setTimeout(restoreScroll, 10);
              setTimeout(restoreScroll, 50);
              setTimeout(restoreScroll, 100);
            };
            
            continue;
          }
          
          /* Skip tasks if their project is collapsed */
          if (this.sortMode === 'project' || this.sortMode === 'hierarchical') {
            const taskProjectName = t.projectName ?? t.project?.file?.basename ?? "Unknown Project";
            if (this.collapsedProjects.has(taskProjectName)) {
              continue;
            }
          }
          /* ── Skip tasks based on visibility settings ─────────────────── */
          const taskIdUpper = ((t as any).id ?? "").toUpperCase();
          const isEpic = taskIdUpper.startsWith("E");
          const isStory = taskIdUpper.startsWith("S") && !taskIdUpper.startsWith("SB");
          const isSubTask = taskIdUpper.startsWith("SB");
          
          if (isEpic && !this.showEpics) continue;
          if (isStory && !this.showStories) continue;
          if (isSubTask && !this.showSubTasks) continue;

          /* Skip tasks not in assignee filter */
          if (this.assigneeFilter !== null) {
            if (this.assigneeFilter.size === 0) continue;   // "None" ⇒ skip all
            const aName = (t.assignee ??
                           t.props?.assignee ??
                           t.owner ??
                           t.props?.owner ??
                           "")
              .toString()
              .trim()
              .toLowerCase();
            if (!this.assigneeFilter.has(aName)) continue;
          }
          /* Skip tasks that don’t match filter */
          if (this.filterText) {
            const hay = `${t.text ?? ""} ${(t.id ?? "")}`.toLowerCase();
            if (!hay.includes(this.filterText)) continue;
          }
          
          const tRow = tbody.createEl("tr", { cls: "pm-task-row" });

          /* Task name (clickable link) */
          const tName = tRow.createEl("td", { cls: "pm-task-name" });

          const idTag = ((t as any).id ?? "").toUpperCase();
          const indentLevel =
            idTag.startsWith("E") ? 0 :                     // Epics
            (idTag.startsWith("S") && !idTag.startsWith("SB")) ? 1 : 2;  // Stories vs. SB-tasks

          /* 20 px base + 12 px per indent level */
          tName.style.paddingLeft = `${20 + indentLevel * 12}px`;

          /* Determine completion */
          let done = isTaskDone(t);

          /* percentComplete: prefer explicit field, else done → 100 or 0 */
          const tPct =
            typeof (t as any).percentComplete === "number"
              ? Math.round((t as any).percentComplete * 100)
              : done ? 100 : 0;

          /* Bullet or check icon depending on completion */
          if (done) {
            const chk = tName.createEl("span");
            setIcon(chk, "check-circle");
            chk.addClass("pm-task-check");
            chk.style.marginRight = "4px";
          } else {
            tName.createEl("span", { text: "• ", cls: "pm-task-bullet" });
          }

          /* Show ID prefix (E‑, S‑, SB‑) before the task name */
          const prefix = (() => {
            const id: string = (t as any).id ?? "";
            if (!id) return "";
            const match = id.match(/^(E|SB?|S)-?\d+/i); // captures E‑, S‑, SB‑
            return match ? `${match[0].toUpperCase()} ` : "";
          })();

          const anchor = tName.createEl("a", {
            text: `${prefix}${t.text ?? "(untitled)"}`,
            href: (t as any).file?.path ?? "",
            cls: "pm-task-weeks-link",
          });
          
          // Force the color styling with inline styles using CSS variables
          anchor.style.color = "var(--text-muted)";
          
          // Ensure styles are applied after a brief delay
          setTimeout(() => {
            anchor.style.color = "var(--text-muted)";
          }, 10);
          
          anchor.addEventListener("mouseenter", () => {
            anchor.style.color = "var(--interactive-accent)";
          });
          anchor.addEventListener("mouseleave", () => {
            anchor.style.color = "var(--text-muted)";
          });

          /* ── Hover tooltip for task meta ─────────────────────────── */
          let hoverTip: HTMLElement | null = null;

          anchor.addEventListener("mouseenter", () => {
            const props = (t as any).props ?? {};
            const val = (k: string) => props[k] ?? props[k.toLowerCase()] ?? "—";

            const who = (
              t.assignee ??
              t.props?.assignee ??
              t.owner ??
              t.props?.owner ??
              "—"
            ).toString().trim() || "—";

            const html = `
              <strong>${prefix}${t.text ?? "(untitled)"}</strong><br>
              <em>${val("description") || (t.description ?? "").toString().trim() || "—"}</em><br>
              <span>Start: ${val("start")}</span><br>
              <span>Due&nbsp;&nbsp;: ${val("due") || val("end")}</span><br>
              <span>Assignee: ${who}</span>
            `;

            hoverTip = document.createElement("div");
            hoverTip.className = "pm-dash-tooltip";
            hoverTip.innerHTML = html;
            document.body.appendChild(hoverTip);

            const r = anchor.getBoundingClientRect();
            const pad = 8;
            
            let left = r.right + pad;
            let top = r.top;
            
            /* Prevent horizontal overflow */
            if (left + hoverTip.offsetWidth > window.innerWidth - pad) {
              left = Math.max(r.left - pad - hoverTip.offsetWidth, pad);
            }
            if (left < pad) {
              left = pad;
            }
            
            /* Prevent vertical overflow */
            if (top + hoverTip.offsetHeight > window.innerHeight - pad) {
              const above = r.top - hoverTip.offsetHeight - pad;
              top = above >= pad ? above : Math.max(window.innerHeight - hoverTip.offsetHeight - pad, pad);
            }
            if (top < pad) {
              top = pad;
            }
            
            hoverTip.style.left = `${left}px`;
            hoverTip.style.top = `${top}px`;
          });

          anchor.addEventListener("mouseleave", () => {
            hoverTip?.remove();
            hoverTip = null;
          });
          
          /* Bold for Epics (E‑) and Stories (S‑) but not SB‑ sub‑tasks */
          const idUpper = ((t as any).id ?? "").toUpperCase();
          if (idUpper.startsWith("E") ||
             (idUpper.startsWith("S") && !idUpper.startsWith("SB"))) {
            anchor.addClass("pm-task-bold");
          }

          anchor.style.cursor = "pointer";
          anchor.onclick = (e) => {
            e.preventDefault();
            const filePath = (t as any).file?.path;
            if (filePath) this.app.workspace.openLinkText(filePath, "", false);
          };


          /* Assignee column */
          tRow.createEl("td", {
            text:
              (t.assignee ??
               t.props?.assignee ??
               t.owner ??
               t.props?.owner ??
               "—").toString(),
            cls: "pm-assignee-cell",
          });

          // For SB tasks, add completion toggle in the Tasks column
          const isSB = ((t as any).id ?? "").toUpperCase().startsWith("SB");
          if (isSB) {
            // Create the tasks cell with completion toggle
            const tasksCell = tRow.createEl("td");
            
            // Create clickable completion toggle
            const toggleBtn = tasksCell.createEl("span");
            setIcon(toggleBtn, done ? "check-circle" : "circle");
            toggleBtn.style.cursor = "pointer";
            
            // Add tooltip
            let tooltip: HTMLElement | null = null;
            toggleBtn.addEventListener("mouseenter", () => {
              tooltip = document.createElement("div");
              tooltip.className = "pm-dash-tooltip";
              tooltip.textContent = done ? "Mark as incomplete" : "Mark as complete";
              document.body.appendChild(tooltip);
              
              const rect = toggleBtn.getBoundingClientRect();
              const pad = 4;
              
              let left = rect.left;
              let top = rect.bottom + pad;
              
              /* Prevent horizontal overflow */
              if (left + tooltip.offsetWidth > window.innerWidth - pad) {
                left = Math.max(window.innerWidth - tooltip.offsetWidth - pad, pad);
              }
              if (left < pad) {
                left = pad;
              }
              
              /* Prevent vertical overflow */
              if (top + tooltip.offsetHeight > window.innerHeight - pad) {
                const above = rect.top - tooltip.offsetHeight - pad;
                top = above >= pad ? above : Math.max(window.innerHeight - tooltip.offsetHeight - pad, pad);
              }
              if (top < pad) {
                top = pad;
              }
              
              tooltip.style.left = `${left}px`;
              tooltip.style.top = `${top}px`;
            });
            
            toggleBtn.addEventListener("mouseleave", () => {
              tooltip?.remove();
              tooltip = null;
            });
            
            toggleBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              await this.toggleTaskCompletion(t, !done);
              tooltip?.remove();
              tooltip = null;
            });
            
            // Also hide tooltip on scroll
            this.container.addEventListener("scroll", () => {
              tooltip?.remove();
              tooltip = null;
            });
          } else {
            // For non-SB tasks, use the existing logic
            (() => {
              const idUp = ((t as any).id ?? "").toUpperCase();
              const isEpic = idUp.startsWith("E");
              const isStory = idUp.startsWith("S") && !idUp.startsWith("SB");
              let taskText = "—";

              if (isEpic || isStory) {
                /* Gather descendant tasks (recursive for Epics,
                   direct SB-children for Stories) */

                const gatherDescendants = (rootId: string): any[] => {
                  const desc: any[] = [];
                  const seen = new Set<string>();
                  const queue = [rootId];
                  while (queue.length) {
                    const pid = queue.shift()!;
                    tasks.forEach((candidate) => {
                      const deps = (candidate.depends ?? []).map((d: string) => d.toUpperCase());
                      if (deps.includes(pid)) {
                        const cid = ((candidate.id ?? "") as string).toUpperCase();
                        if (!seen.has(cid)) {
                          seen.add(cid);
                          desc.push(candidate);
                          queue.push(cid);   // explore deeper levels
                        }
                      }
                    });
                  }
                  return desc;
                };

                let childTasks: any[] = [];

                if (isStory) {
                  /* Only direct SB‑children for Stories */
                  childTasks = tasks.filter((candidate) => {
                    const deps = (candidate.depends ?? []).map((d: string) => d.toUpperCase());
                    if (!deps.includes(idUp)) return false;
                    const cid = ((candidate.id ?? "") as string).toUpperCase();
                    return cid.startsWith("SB");
                  });
                } else if (isEpic) {
                  /* All descendant tasks across every depth for Epics */
                  childTasks = gatherDescendants(idUp).filter((cand) => {
                    const cid = ((cand.id ?? "") as string).toUpperCase();
                    return cid.startsWith("SB");          // only SB‑tasks
                  });
                }

                if (childTasks.length > 0) {
                  const doneCnt = childTasks.filter(isTaskDone).length;
                  taskText = `${doneCnt} / ${childTasks.length}`;
                }
              }
              tRow.createEl("td", { text: taskText });
            })();
          }

          /* Status + dates — mirror Timeline logic */
          const taskDueIso = ((t as any).props?.["due"] ?? "")
            .toString()
            .replace(/\u00A0/g, " ")
            .trim();

          const taskStartIso = ((t as any).props?.["start"] ?? "")
            .toString()
            .replace(/\u00A0/g, " ")
            .trim();

          /* prefer due::, fall back to start:: */
          const taskDue = taskDueIso || taskStartIso || undefined;

          /* last‑modified: note file mtime if present */
          const taskMtime =
            (t as any).file?.stat?.mtime ??
            (t as any).mtime ??
            (t as any).updated ??
            undefined;

          /* Status badge logic: any task at 100 % or marked done ⇒ Completed */
          const pctForStatus = (done || tPct === 100) ? 1 : (tPct / 100);
          const { label: tLabel0, cls: tCls0 } = projectStatus(taskDue, pctForStatus);

          /* Force label “Completed” when pct == 100 */
          const tLabel = (tPct === 100) ? "Completed" : tLabel0;
          const tCls   = (tPct === 100) ? "complete"   : tCls0;

          /* Status */
          const sTd = tRow.createEl("td");

          // Only render play/pause button and status dot logic for SB-tasks
          if (t?.id?.toUpperCase().startsWith("SB")) {
            // Wrapper div for all status elements (badge, dot, button)
            const statusWrapper = sTd.createDiv({ cls: "pm-status-cell-wrapper" });

            // Status badge (copied from Dashboard)
            statusWrapper.createEl("span", { cls: `pm-badge ${tCls}`, text: tLabel });
            attachStatusPopup(statusWrapper, statusTooltip(taskDueIso || taskStartIso, pctForStatus));

            // Status dot
            if (t.status === "in-progress") {
              statusWrapper.createEl("span", { text: "●", cls: "pm-in-progress-dot" });
            } else if (t.status === "on-hold") {
              statusWrapper.createEl("span", { text: "●", cls: "pm-on-hold-dot" });
            }

            // Determine task status for play/pause icon
            let taskStatusVal: "not-started" | "in-progress" | "on-hold" | "done" = "not-started";
            if (typeof t.status === "string") {
              const s = t.status.toLowerCase();
              if (["done", "complete", "completed"].includes(s)) {
                taskStatusVal = "done";
              } else if (s === "in-progress") {
                taskStatusVal = "in-progress";
              } else if (s === "on-hold") {
                taskStatusVal = "on-hold";
              }
            }

            // Play/pause button (only if not done)
            if (taskStatusVal !== "done") {
              const iconBtn = statusWrapper.createEl("span", { cls: `pm-status-btn ${taskStatusVal}` });
              iconBtn.style.cursor = "pointer";
              setIcon(iconBtn, taskStatusVal === "in-progress" ? "pause" : "play");
              
              // Add custom tooltip for play/pause button
              let tooltip: HTMLElement | null = null;
              iconBtn.addEventListener("mouseenter", () => {
                tooltip = document.createElement("div");
                tooltip.className = "pm-dash-tooltip";
                tooltip.textContent = taskStatusVal === "in-progress" ? "Mark as on hold" : "Mark as in progress";
                document.body.appendChild(tooltip);
                const rect = iconBtn.getBoundingClientRect();
                tooltip.style.left = `${rect.left}px`;
                tooltip.style.top = `${rect.top - 30}px`;
              });
              const hideTooltip = () => { tooltip?.remove(); tooltip = null; };
              iconBtn.addEventListener("mouseleave", hideTooltip);
              document.addEventListener("scroll", hideTooltip, { capture: true, once: true });

              iconBtn.onclick = async (ev) => {
                ev.stopPropagation();
                hideTooltip();
                const file = (t as any).file;
                if (!file) return;

                const content = await this.app.vault.read(file);
                const lines = content.split(/\r?\n/);
                const checkboxRegex = /\[[ xX\/-]\]/;

                // Find the task line
                let lineIdx = typeof t.line === "number" ? t.line : -1;
                if (!(lineIdx >= 0 && checkboxRegex.test(lines[lineIdx]))) {
                  lineIdx = lines.findIndex(
                    (line) => line.includes(t.text ?? "") && checkboxRegex.test(line)
                  );
                }

                if (lineIdx >= 0) {
                  const match = lines[lineIdx].match(/\[[ xX\/-]\]/);
                  if (match) {
                    let replacement = match[0];
                    if (replacement === "[ ]") replacement = "[/]";
                    else if (replacement === "[/]") replacement = "[-]";
                    else if (replacement === "[-]") replacement = "[/]";
                    lines[lineIdx] = lines[lineIdx].replace(/\[[ xX\/-]\]/, replacement);
                    await this.app.vault.modify(file, lines.join("\n"));
                    this.render();
                    const popup = iconBtn.closest(".pm-status-popup");
                    if (popup) popup.remove();
                    const tip = document.querySelector(".pm-dash-tooltip");
                    if (tip) tip.remove();
                  }
                }
              };
            }
          } else {
            // For non-SB tasks, render only the default badge and status dot, no play/pause button.
            sTd.createEl("span", {
              cls:  `pm-badge ${tCls}`,
              text: tLabel,
            });
            // Add colored dot for status
            if (t.status === "in-progress") {
              sTd.createEl("span", { text: "●", cls: "pm-in-progress-dot" });
            } else if (t.status === "on-hold") {
              sTd.createEl("span", { text: "●", cls: "pm-on-hold-dot" });
            }
            attachStatusPopup(sTd, statusTooltip(taskDueIso || taskStartIso, pctForStatus));
            // (No play/pause button for non-SB tasks)
          }

          /* Project column (link to project note) */
          const projCell = tRow.createEl("td", { cls: "pm-text-muted" });
          if (t.projectPath) {
            const link = projCell.createEl("a", {
              text: (t.projectName ?? "—").toString(),
              href: t.projectPath,
            });
            link.style.cursor = "pointer";
            link.style.color = "var(--text-muted)";
            
            // Ensure styles are applied after a brief delay
            setTimeout(() => {
              link.style.color = "var(--text-muted)";
            }, 10);
            
            link.addEventListener("mouseenter", () => {
              link.style.color = "var(--interactive-accent)";
            });
            link.addEventListener("mouseleave", () => {
              link.style.color = "var(--text-muted)";
            });
            
            link.onclick = (e) => {
              e.preventDefault();
              this.app.workspace.openLinkText(t.projectPath, "", false);
            };
            /* Hover tooltip showing project front‑matter */
            let projHover: HTMLElement | null = null;

            link.addEventListener("mouseenter", () => {
              /* Front‑matter: prefer full file cache (if TFile is ready),
                 else fall back to path cache.                                   */
              const tFile = this.app.vault.getFileByPath(t.projectPath);
              const fm: Record<string, any> =
                (tFile instanceof TFile
                  ? this.app.metadataCache.getFileCache(tFile)?.frontmatter
                  : undefined) ??
                this.app.metadataCache.getCache(t.projectPath)?.frontmatter ??
                {};

              /* Normalise keys: ignore case, spaces, underscores                */
              const fmVal = (k: string) => {
                const norm  = (s: string) => s.replace(/[\s_]+/g, "").toLowerCase();
                const target = norm(k);
                for (const key in fm) {
                  if (norm(key) === target) return fm[key];
                }
                return "—";
              };

              /* Always show name; append meta only if front‑matter present */
              let html = `<strong>${t.projectName}</strong>`;

              if (Object.keys(fm).length > 0) {
                html += `<br><em>${fmVal("description")}</em>
                         <br><span>Start: ${fmVal("start date")}</span>
                         <br><span>Due  : ${fmVal("end date") || fmVal("due date")}</span>`;
              }

              projHover = document.createElement("div");
              projHover.className = "pm-dash-tooltip";
              projHover.innerHTML = html;
              document.body.appendChild(projHover);

              /* Position tooltip beside link, stay on screen */
              const r   = link.getBoundingClientRect();
              const pad = 8;
              const hdr = 40;
              
              let left = r.right + pad;
              let top = Math.max(r.top, hdr + pad);
              
              /* Prevent horizontal overflow */
              if (left + projHover.offsetWidth > window.innerWidth - pad) {
                left = Math.max(r.left - pad - projHover.offsetWidth, pad);
              }
              if (left < pad) {
                left = pad;
              }
              
              /* Prevent vertical overflow */
              if (top + projHover.offsetHeight > window.innerHeight - pad) {
                const above = r.top - projHover.offsetHeight - pad;
                top = above >= pad ? above : Math.max(window.innerHeight - projHover.offsetHeight - pad, pad);
              }
              if (top < pad) {
                top = pad;
              }
              
              projHover.style.left = `${left}px`;
              projHover.style.top = `${top}px`;
            });

            link.addEventListener("mouseleave", () => {
              projHover?.remove();
              projHover = null;
            });
          } else {
            projCell.setText((t.projectName ?? "—").toString());
          }
        }
      }
    }

    if (this.cache.projects.size === 0) {
      this.container.createEl("p", {
        text: `No project notes found (front-matter \`${this.settings.projectFlagProperty}: true\`).`,
      });
    }

    // Update caret icon based on current state after processing all weeks
    setIcon(globalCaret, this.allCollapsed() ? "chevron-right" : "chevron-down");
  }

  public focusSearch() {
  this.container
    .querySelector<HTMLInputElement>(".pm-search-input")
    ?.focus();
  }
}