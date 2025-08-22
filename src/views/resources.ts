import {
  ItemView,
  WorkspaceLeaf,
  setIcon,
  Notice,
} from "obsidian";
import { TFile } from "obsidian";
/* Moment.js is available globally in Obsidian */
declare const moment: any;
import type { ViewStateResult } from "obsidian";
import { ProjectCache, TaskItem, ProjectEntry } from "../services/cache";
import { PmSettings } from "../../settings";

// Extended task interface for resources view
interface ExtendedTaskItem extends TaskItem {
  done?: boolean | string;
  percentComplete?: number;
  raw?: string;
}

/* ── Minimal in‑memory resource registry (people only) ─────────── */
interface PersonResource {
  id: string;
  name: string;
  weeklyCapacity: number;
  skills?: string[];
}

class ResourceRegistry {
  private people = new Map<string, PersonResource>();

  listPeople(): PersonResource[] { return Array.from(this.people.values()); }

  addPerson(p: PersonResource) { this.people.set(p.id.toLowerCase(), p); }
}

/** Singleton registry (replace later with real data load) */
export const registry = new ResourceRegistry();

// Load dashboard-specific stylesheet
import "../../styles/styles-resources.css";

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
  if (!nextDue) return { label: "On track", cls: "on-track" };

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

/** Tooltip explaining status (same logic as Task Weeks view) */
function statusTooltip(nextDue?: string, pct = 0): string {
  if (pct >= 1) return "Task reached 100 % completion";
  if (!nextDue) return "No due date set";
  const today   = new Date();
  const due     = new Date(nextDue);
  const msInDay = 86_400_000;
  const diff    = Math.ceil((due.getTime() - today.getTime()) / msInDay);

  if (diff < 0)  return `Past due by ${-diff} day${diff === -1 ? "" : "s"} (due ${formatDate(due)})`;
  if (diff === 0) return "Due today";
  if (diff <= 10) return `Due in ${diff} day${diff === 1 ? "" : "s"} (${formatDate(due)})`;
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

  /** quick helpers */
  const idLower = (t: ExtendedTaskItem) => t.id.toLowerCase();
  const isEpic  = (t: ExtendedTaskItem) => idLower(t).startsWith("e");
  const isStory = (t: ExtendedTaskItem) =>
    idLower(t).startsWith("s") && !idLower(t).startsWith("sb");
  const isSub   = (t: ExtendedTaskItem) => idLower(t).startsWith("sb");

  /** map Story‑id → [sub‑tasks]  (reuse existing Story column + depends logic) */
  const subsByStory = new Map<string, ExtendedTaskItem[]>();
  const stripType = (raw: string) =>
    raw.trim().toLowerCase().replace(/^(fs|ss|ff|sf):/, ""); // drop link‑type

  tasks.forEach(t => {
    if (!isSub(t)) return;

    /* 1️⃣  Preferred: explicit Story column */
    let storyKey = (t.props["story"] ?? "").toString().trim();
    storyKey = storyKey ? storyKey.toLowerCase() : "";

    /* 2️⃣  Fallback: first depends:: entry, minus any FS/SS/FF/SF prefix */
    if (!storyKey && Array.isArray(t.depends) && t.depends.length) {
      storyKey = stripType(String(t.depends[0]));
    }

    if (!storyKey) return;

    if (!subsByStory.has(storyKey)) subsByStory.set(storyKey, []);
    subsByStory.get(storyKey)!.push(t);
  });

  /** map Epic‑id → [stories] (Story.Epic column) */
  const storiesByEpic = new Map<string, ExtendedTaskItem[]>();
  tasks.forEach(t => {
    if (!isStory(t)) return;
    const epicField = (t.props["epic"] ?? "").toString().trim().toLowerCase();
    if (!epicField) return;
    if (!storiesByEpic.has(epicField)) storiesByEpic.set(epicField, []);
    storiesByEpic.get(epicField)!.push(t);
  });

  /** helper to push Story + its subs */
  const pushStoryWithSubs = (s: ExtendedTaskItem) => {
    if (done.has(s)) return;
    done.add(s);
    out.push(s);
    const kids = subsByStory.get(idLower(s));
    if (kids) kids.forEach(k => {
      if (!done.has(k)) {
        done.add(k);
        out.push(k);
      }
    });
  };

  /** 1️⃣ Epics in original order, each followed by its Stories + Subs */
  tasks.forEach(t => {
    if (!isEpic(t) || done.has(t)) return;
    done.add(t);
    out.push(t);
    const stories = storiesByEpic.get(idLower(t));
    if (stories) {
      stories.forEach(pushStoryWithSubs);
    }
  });

  /** 2️⃣ Standalone Stories (no Epic) */
  tasks.forEach(t => {
    if (!isStory(t) || done.has(t)) return;
    pushStoryWithSubs(t);
  });

  /** 3️⃣ Remaining tasks (subs w/out story, plain rows, etc.) */
  tasks.forEach(t => {
    if (!done.has(t)) {
      done.add(t);
      out.push(t);
    }
  });

  return out;
}

export const VIEW_TYPE_PM_RESOURCES = "pm-resources-view";

export class ResourcesView extends ItemView {
  /** icon shown on the view tab */
  public icon = "users";
  /** Optional set of project file paths to display (injected by Portfolio view) */
  private filterPaths?: Set<string>;
  /** Optional name of the portfolio that opened this dashboard */
  private filterName?: string;
  /** The initial project paths passed in from Portfolio (null = no portfolio) */
  private originalPaths: string[] | null = null;
  private sortField: string | null = "assignee";
  private sortAsc = true;
  private collapsed = new Set<string>();
  private collapsedProjects = new Set<string>();  // track collapsed project dividers
  private firstRender = true;
  private totalGroups = 0;        // number of week rows in current render
  private currentPaths: string[] = [];   // paths (week keys) shown in latest render
  private visibleGroupIds: string[] = [];   // ids of groups visible in the last render

  private cache: ProjectCache;
  private settings: PmSettings;
  private container!: HTMLElement;
  private detachFn: (() => void) | null = null;

  private filterText = "";                 // live text in the quick-filter box
  private filterAssignees?: Set<string>;   // filtered assignees (undefined = all)
  private showEpics = true;                // show/hide epics
  private showStories = true;              // show/hide stories
  private showSubTasks = true;             // show/hide sub-tasks
  private sortMode: 'project' | 'hierarchical' | 'alphabetical' = 'project';  // project grouping, hierarchical, or alphabetical

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
    return VIEW_TYPE_PM_RESOURCES;
  }
  getDisplayText(): string {
    return this.filterName
      ? `Resources – ${this.filterName}`
      : "Resources";
  }

  getIcon(): string {
    return "users";
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
    return this.totalGroups > 0 && this.collapsed.size === this.totalGroups;
  }

  /** Collapse or expand all projects at once */
  private toggleAll() {
    const visible = this.visibleGroupIds;
    const allCollapsed = visible.length > 0 && visible.every(id => this.collapsed.has(id));
    if (allCollapsed) {
      visible.forEach(id => this.collapsed.delete(id));
    } else {
      visible.forEach(id => this.collapsed.add(id));
    }
    this.render();
  }

  /** Check if all currently visible projects are collapsed */
  private areAllProjectsCollapsed(): boolean {
    if (this.sortMode !== 'project' && this.sortMode !== 'hierarchical') {
      return false; // Not applicable for alphabetical mode
    }
    
    // Get all unique project names from the currently visible/filtered data
    const visibleProjectNames = new Set<string>();
    
    // Get filtered projects (same logic as in render method)
    let projects: any[] = Array.from(this.cache.projects.values())
      .sort((a, b) => a.file.basename.localeCompare(b.file.basename))
      .filter((p) => !this.filterPaths || this.filterPaths.has(p.file.path));

    projects.forEach((proj: any) => {
      (proj as any).tasks?.forEach((t: any) => {
        const projectName = proj.file?.basename ?? proj.name ?? "Untitled";
        visibleProjectNames.add(projectName);
      });
    });
    
    // Check if all visible projects are in the collapsed set
    return visibleProjectNames.size > 0 && Array.from(visibleProjectNames).every(projectName => 
      this.collapsedProjects.has(projectName)
    );
  }

  /** Collapse all currently visible projects */
  private collapseAllProjects(): void {
    if (this.sortMode !== 'project' && this.sortMode !== 'hierarchical') {
      return; // Not applicable for alphabetical mode
    }
    
    // Only add project names that are currently visible/filtered
    const visibleProjectNames = new Set<string>();
    
    // Get filtered projects (same logic as in render method)
    let projects: any[] = Array.from(this.cache.projects.values())
      .sort((a, b) => a.file.basename.localeCompare(b.file.basename))
      .filter((p) => !this.filterPaths || this.filterPaths.has(p.file.path));

    projects.forEach((proj: any) => {
      (proj as any).tasks?.forEach((t: any) => {
        const projectName = proj.file?.basename ?? proj.name ?? "Untitled";
        visibleProjectNames.add(projectName);
      });
    });
    
    // Only add visible project names to the collapsed set
    visibleProjectNames.forEach(projectName => {
      this.collapsedProjects.add(projectName);
    });
  }

  /** Toggle fold / unfold for one project and re-render */
  private toggle(path: string) {
    if (this.collapsed.has(path)) this.collapsed.delete(path);
    else this.collapsed.add(path);
    this.render();
  }

  private render() {
    this.container.empty();
    this.container.addClass("pm-resources-view");

    // Clear any lingering tooltips and status popups
    document.querySelectorAll('.pm-dash-tooltip').forEach((el) => el.remove());
    document.querySelectorAll('.pm-status-popup').forEach((el) => el.remove());

    /* ── Fold/Unfold top bar ───────────────────────── */
    const topbar = this.container.createEl("div", { cls: "pm-dash-topbar" });
    const globalCaret = topbar.createEl("span");
    globalCaret.style.cursor = "pointer";
    globalCaret.setAttr("aria-label", "Toggle all groups");
    setIcon(globalCaret, "chevron-right");
    globalCaret.onclick = () => this.toggleAll();
    topbar.createEl("span", { text: "Resources" });

    /* Task sorting toggle */
    const sortToggle = topbar.createEl("button", { 
      cls: "pm-mode-toggle"
    });
    setIcon(sortToggle, this.sortMode === 'project' ? 'folder' : this.sortMode === 'hierarchical' ? 'list-tree' : 'sort-asc');
    
    // Custom tooltip functionality
    let tooltip: HTMLElement | null = null;
    let tooltipTimeout: NodeJS.Timeout | null = null;
    
    const showTooltip = (event: MouseEvent) => {
      if (tooltip) return;
      
      tooltip = document.createElement('div');
      tooltip.className = 'pm-dash-tooltip';
      tooltip.textContent = this.sortMode === 'project' 
        ? "Currently grouping by project. Click for hierarchical sorting."
        : this.sortMode === 'hierarchical'
        ? "Currently sorting hierarchically. Click for alphabetical sorting."
        : "Currently sorting alphabetically. Click for project grouping.";
      
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
    
    sortToggle.addEventListener('mouseenter', (event) => {
      tooltipTimeout = setTimeout(() => showTooltip(event), 500);
    });
    
    sortToggle.addEventListener('mouseleave', hideTooltip);
    
    sortToggle.onclick = () => {
      hideTooltip();
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
    /* Label */
    projBtn.createSpan({ text: "Projects " });
    /* Lucide chevron-down icon */
    const caret = projBtn.createSpan();
    setIcon(caret, "chevron-down");

    let ddOpen = false;
    let ddEl: HTMLElement | null = null;

    const buildDropdown = (projectList: any[]) => {
      ddEl = document.createElement("div");
      ddEl.className = "pm-proj-dd";

      /* Select/Deselect controls */
      const controls = ddEl.createEl("div", { cls: "pm-proj-dd-ctl" });

      /* ALL */
      controls.createEl("a", { text: "All" }).onclick = (e) => {
        e.preventDefault();
        /* Keep current portfolio name so middle option remains visible */
        this.updateFilter(null, this.filterName ?? "");
      };

      /* PORTFOLIO (only if originalPaths present) */
      if (this.originalPaths && this.originalPaths.length) {
        controls.createSpan({ text: " | " });
        controls.createEl("a", { text: this.filterName ?? "Portfolio" }).onclick = (e) => {
          e.preventDefault();
          this.updateFilter([...this.originalPaths!], this.filterName ?? "");
        };
      }

      /* NONE */
      controls.createSpan({ text: " | " });
      controls.createEl("a", { text: "None" }).onclick = (e) => {
        e.preventDefault();
        /* Preserve portfolio name so the middle option stays visible */
        this.updateFilter([], this.filterName ?? "");
      };

      /* Checkbox list */
      projectList.forEach((p: any) => {
        const wrap = ddEl!.createEl("div", { cls: "pm-proj-dd-item" });
        const cb = wrap.createEl("span", { cls: "pm-dd-check" });
        cb.style.cursor = "pointer";
        cb.style.marginRight = "8px";
        cb.style.display = "inline-block";
        cb.style.width = "16px";
        cb.style.height = "16px";
        
        const isChecked = !this.filterPaths || this.filterPaths.has(p.file.path);
        setIcon(cb, isChecked ? "check-circle" : "circle");
        
        // Store the project path on the element for easy access
        cb.setAttribute("data-project-path", p.file.path);
        cb.setAttribute("data-checked", isChecked.toString());
        
        wrap.createSpan({ text: p.file.basename });
        
        wrap.onclick = (e) => {
          e.stopPropagation(); // Prevent dropdown from closing
          const currentChecked = cb.getAttribute("data-checked") === "true";
          const newChecked = !currentChecked;
          
          cb.setAttribute("data-checked", newChecked.toString());
          setIcon(cb, newChecked ? "check-circle" : "circle");
          
          /* gather all check icons to compute new filter */
          const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check"));
          const selected = checkIcons
            .filter(icon => icon.getAttribute("data-checked") === "true")
            .map(icon => icon.getAttribute("data-project-path")!);

          this.updateFilter(selected.length === projectList.length ? null : selected);
        };
      });

      document.body.appendChild(ddEl);

      /* Position dropdown and ensure it stays within the viewport */
      const r   = projBtn.getBoundingClientRect();
      const pad = 4;                           // minimal gap from window edges

      let left = r.left;
      let top  = r.bottom + pad;               // default: just below button

      /* Measure after insertion */
      const ddW = ddEl.offsetWidth  || 240;
      const ddH = ddEl.offsetHeight || 260;

      /* Prevent horizontal overflow */
      if (left + ddW > window.innerWidth - pad) {
        left = Math.max(window.innerWidth - ddW - pad, pad);
      } else if (left < pad) {
        left = pad;
      }

      /* Prevent vertical overflow – if not enough space below, flip above;
         if still too tall, clamp to bottom edge */
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
    };

    projBtn.onclick = () => {
      if (ddOpen) {
        closeDropdown();
        return;
      }
      ddOpen = true;

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
    const assigneesBtn = topbar.createEl("button", { cls: "pm-proj-btn" });
    /* Label */
    assigneesBtn.createSpan({ text: "Assignees " });
    /* Lucide chevron-down icon */
    const assigneesCaret = assigneesBtn.createSpan();
    setIcon(assigneesCaret, "chevron-down");

    let assigneesDdOpen = false;
    let assigneesDdEl: HTMLElement | null = null;

    const buildAssigneesDropdown = (assigneesList: { id: string; name: string }[]) => {
      assigneesDdEl = document.createElement("div");
      assigneesDdEl.className = "pm-proj-dd";

      /* Select/Deselect controls */
      const controls = assigneesDdEl.createEl("div", { cls: "pm-proj-dd-ctl" });

      /* ALL */
      controls.createEl("a", { text: "All" }).onclick = (e) => {
        e.preventDefault();
        this.filterAssignees = undefined;
        this.render();
      };

      /* PORTFOLIO (only if originalPaths present) */
      if (this.originalPaths && this.originalPaths.length) {
        controls.createSpan({ text: " | " });
        controls.createEl("a", { text: this.filterName ?? "Portfolio" }).onclick = (e) => {
          e.preventDefault();
          // Filter assignees to only those who have tasks in the current portfolio projects
          const portfolioAssignees = new Set<string>();
          this.cache.projects.forEach((proj) => {
            if (this.originalPaths!.includes(proj.file.path)) {
              (proj as any).tasks?.forEach((t: any) => {
                const raw = (t.assignee ?? t.props?.assignee ?? t.owner ?? t.props?.owner ?? "Unassigned").toString();
                raw.split(",").forEach((s: string) => {
                  const n = s.trim();
                  if (n && n !== "-") {
                    const cleaned = /^[-‑—–]+$/.test(n) ? "Unassigned" : n;
                    portfolioAssignees.add(cleaned.toLowerCase());
                  }
                });
              });
            }
          });
          this.filterAssignees = portfolioAssignees.size > 0 ? portfolioAssignees : undefined;
          this.render();
        };
      }

      /* NONE */
      controls.createSpan({ text: " | " });
      controls.createEl("a", { text: "None" }).onclick = (e) => {
        e.preventDefault();
        this.filterAssignees = new Set<string>();
        this.render();
      };

      /* Checkbox list */
      assigneesList.forEach((assignee) => {
        const wrap = assigneesDdEl!.createEl("div", { cls: "pm-proj-dd-item" });
        const cb = wrap.createEl("span", { cls: "pm-dd-check" });
        cb.style.cursor = "pointer";
        cb.style.marginRight = "8px";
        cb.style.display = "inline-block";
        cb.style.width = "16px";
        cb.style.height = "16px";
        
        const isChecked = !this.filterAssignees || this.filterAssignees.has(assignee.id);
        setIcon(cb, isChecked ? "check-circle" : "circle");
        
        // Store the assignee id on the element for easy access
        cb.setAttribute("data-assignee-id", assignee.id);
        cb.setAttribute("data-checked", isChecked.toString());
        
        wrap.createSpan({ text: assignee.name });
        
        wrap.onclick = (e) => {
          e.stopPropagation(); // Prevent dropdown from closing
          const currentChecked = cb.getAttribute("data-checked") === "true";
          const newChecked = !currentChecked;
          
          cb.setAttribute("data-checked", newChecked.toString());
          setIcon(cb, newChecked ? "check-circle" : "circle");
          
          /* gather all check icons to compute new filter */
          const checkIcons = Array.from(assigneesDdEl!.querySelectorAll(".pm-dd-check"));
          const selected = checkIcons
            .filter(icon => icon.getAttribute("data-checked") === "true")
            .map(icon => icon.getAttribute("data-assignee-id")!);

          this.filterAssignees = selected.length === assigneesList.length ? undefined : new Set(selected);
          this.render();
        };
      });

      document.body.appendChild(assigneesDdEl);

      /* Position dropdown and ensure it stays within the viewport */
      const r   = assigneesBtn.getBoundingClientRect();
      const pad = 4;                           // minimal gap from window edges

      let left = r.left;
      let top  = r.bottom + pad;               // default: just below button

      /* Measure after insertion */
      const ddW = assigneesDdEl.offsetWidth  || 240;
      const ddH = assigneesDdEl.offsetHeight || 260;

      /* Prevent horizontal overflow */
      if (left + ddW > window.innerWidth - pad) {
        left = Math.max(window.innerWidth - ddW - pad, pad);
      } else if (left < pad) {
        left = pad;
      }

      /* Prevent vertical overflow – if not enough space below, flip above;
         if still too tall, clamp to bottom edge */
      if (top + ddH > window.innerHeight - pad) {
        const above = r.top - ddH - pad;
        top = above >= pad ? above
                           : Math.max(window.innerHeight - ddH - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }

      assigneesDdEl.style.left = `${left}px`;
      assigneesDdEl.style.top  = `${top}px`;
    };

    const closeAssigneesDropdown = () => {
      assigneesDdEl?.remove();
      assigneesDdEl = null;
      assigneesDdOpen = false;
    };

    assigneesBtn.onclick = () => {
      if (assigneesDdOpen) {
        closeAssigneesDropdown();
        return;
      }
      assigneesDdOpen = true;

      /* Build assignees list from current cache */
      const assigneesMap = new Map<string, string>();
      this.cache.projects.forEach((proj) => {
        (proj as any).tasks?.forEach((t: any) => {
          const raw = (t.assignee ?? t.props?.assignee ?? t.owner ?? t.props?.owner ?? "Unassigned").toString();
          raw.split(",").forEach((s: string) => {
            const n = s.trim();
            if (n && n !== "-") {
              const cleaned = /^[-‑—–]+$/.test(n) ? "Unassigned" : n;
              assigneesMap.set(cleaned.toLowerCase(), cleaned);
            }
          });
        });
      });
      if (assigneesMap.size === 0) assigneesMap.set("unassigned", "Unassigned");
      
      const assigneesList = Array.from(assigneesMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)); // sort A-Z
      
      buildAssigneesDropdown(assigneesList);

      /* Close on outside click */
      const onDoc = (e: MouseEvent) => {
        if (assigneesDdEl && !assigneesDdEl.contains(e.target as Node) && e.target !== assigneesBtn) {
          closeAssigneesDropdown();
          document.removeEventListener("mousedown", onDoc);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", onDoc));
    };

    /* ── Epic and Story visibility toggles ─────────────────── */
    const epicIcon = topbar.createEl("span", { cls: "pm-toggle-icon" });
    epicIcon.style.marginLeft = "8px";
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
      epicTip.style.left = `${r.left}px`;
      epicTip.style.top = `${r.bottom + 6}px`;
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
      storyTip.style.left = `${r.left}px`;
      storyTip.style.top = `${r.bottom + 6}px`;
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

    /* ── Sub-tasks visibility toggle ─────────────────── */
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
      subTasksTip.style.left = `${r.left}px`;
      subTasksTip.style.top = `${r.bottom + 6}px`;
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
    /* Column widths: Assignee widest, then Tasks/Status/Project */
    const colgroup = table.createEl("colgroup");
    ["48%", "12%", "12%", "28%"].forEach((w) =>
      colgroup.createEl("col", { attr: { style: `width:${w}` } })
    );
    const thead = table.createEl("thead");
    /* Helper: attach a tooltip that clamps to window */
    const attachTip = (icon: HTMLElement, text: string) => {
      let tip: HTMLElement | null = null;
      icon.addEventListener("mouseenter", () => {
        tip = document.createElement("div");
        tip.classList.add("pm-dash-tooltip");
        tip.textContent = text;
        document.body.appendChild(tip);

        const r   = icon.getBoundingClientRect();
        const pad = 8;
        let left  = r.right + 6;
        let top   = r.top + (r.height - tip.offsetHeight) / 2;

        const w = tip.offsetWidth  || 140;
        const h = tip.offsetHeight || 40;

        if (left + w > window.innerWidth - pad) left = Math.max(r.left - w - 6, pad);
        if (top + h > window.innerHeight - pad) top  = window.innerHeight - h - pad;
        if (top < pad) top = pad;

        tip.style.left = `${left}px`;
        tip.style.top  = `${top}px`;
      });
      icon.addEventListener("mouseleave", () => { tip?.remove(); tip = null; });
    };
    const headerRow = thead.createEl("tr");

    const headers: [string, string][] = [
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
        ico.style.opacity = "0.5";          /* dim when inactive */
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

    /* Helper: custom tooltip for Status cells */
    const attachStatusPopup = (cell: HTMLElement, msg: string) => {
      let tip: HTMLElement | null = null;
      let blockTooltip = false;
      cell.addEventListener("mouseenter", (ev) => {
        if (blockTooltip) return;
        const mouse = ev as MouseEvent;
        tip = document.createElement("div");
        tip.className = "pm-dash-tooltip";
        tip.textContent = msg;
        document.body.appendChild(tip);

        const pad = 8;
        const w   = tip.offsetWidth  || 140;
        const h   = tip.offsetHeight || 40;

        /* default position: bottom‑right of pointer */
        let left = mouse.clientX + pad;
        let top  = mouse.clientY + pad;

        if (left + w > window.innerWidth - pad) left = mouse.clientX - w - pad;
        if (top  + h > window.innerHeight - pad) top  = mouse.clientY - h - pad;
        if (left < pad) left = pad;
        if (top  < pad) top  = pad;

        tip.style.left = `${left}px`;
        tip.style.top  = `${top}px`;
      });
      cell.addEventListener("mouseleave", () => { 
        tip?.remove(); 
        tip = null; 
        blockTooltip = false;
      });
      // Remove tooltip immediately on click and block until mouse leaves
      cell.addEventListener("click", () => {
        if (tip) {
          tip.remove();
          tip = null;
        }
        blockTooltip = true; // block until mouse leaves
      });
    };

    /* ── Group tasks by ASSIGNEE ─────────────────────────────────── */
    let projects: any[] = Array.from(this.cache.projects.values())
      .sort((a, b) => a.file.basename.localeCompare(b.file.basename)) // sort A-Z
      .filter(
        (p) => !this.filterPaths || this.filterPaths.has(p.file.path)
      );
    interface AssigneeGroup {
      id:    string;          // lower‑case id
      label: string;          // original casing
      tasks: any[];
      totalTasks: number;
      completedTasks: number;
      percentComplete: number;
      nextDue?: string;
      projects: Set<string>;  // distinct project names this assignee touches
    }
    const agMap = new Map<string, AssigneeGroup>();

    projects.forEach((proj: any) => {
      (proj as any).tasks?.forEach((t: any) => {
        /* Attach project metadata for later display */
        t.projectName = proj.file?.basename ?? proj.name ?? "Untitled";
        t.projectPath = proj.file?.path     ?? "";
        /* Support multiple assignees separated by commas */
        let rawAssignee: any =
          t.assignee ?? t.props?.assignee ?? t.owner ?? t.props?.owner ?? "Unassigned";

        let assignees: string[];
        if (Array.isArray(rawAssignee)) {
          assignees = rawAssignee.map((s: any) => String(s).trim());
        } else {
          assignees = String(rawAssignee)
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length && s !== "-");   // ignore placeholder dash
        }
        /* If nothing valid remains (or raw was just "-"), treat as unassigned */
        if (assignees.length === 0) assignees = ["Unassigned"];

        assignees.forEach((raw0) => {
          /* Treat any dash-only token as "Unassigned" */
          const raw = /^[-‑—–]+$/.test(raw0) ? "Unassigned" : raw0;   // covers -, –, —
          const id  = raw.toLowerCase();

          if (!agMap.has(id)) {
            agMap.set(id, {
              id,
              label: raw,
              tasks: [],
              totalTasks: 0,
              completedTasks: 0,
              percentComplete: 0,
              projects: new Set<string>(),
            });
          }
          const grp = agMap.get(id)!;
          grp.tasks.push(t);
          if (t.projectName) grp.projects.add(String(t.projectName));

          /* Count only sub-tasks (SB-) */
          const idUp = ((t.id ?? "") as string).toUpperCase();
          const isSubTask = idUp.startsWith("SB");
          if (isSubTask) {
            grp.totalTasks++;
            if (isTaskDone(t)) grp.completedTasks++;
          }

          const due = t.props?.due ?? t.props?.start;
          if (due && (!grp.nextDue || String(due) < grp.nextDue)) grp.nextDue = String(due);
        });
      });
    });

    /* finalize percentComplete */
    agMap.forEach((g) => {
      g.percentComplete = g.totalTasks === 0 ? 0 : g.completedTasks / g.totalTasks;
    });

    /* replace projects array with assignee groups */
    projects = Array.from(agMap.values()) as any[];
    
    /* Apply assignee filter */
    if (this.filterAssignees) {
      projects = projects.filter(p => this.filterAssignees!.has(p.id));
    }
    
    this.currentPaths = projects.map(p => p.id);
    this.totalGroups  = projects.length;

    // Sorting logic adapted for assignee groups
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
          case "assignee":
            return (a.label ?? "").localeCompare(b.label ?? "") * dir;
          case "tasks":
            const ratio = (p: typeof a) =>
              (p.completedTasks ?? 0) / Math.max(p.totalTasks ?? 1, 1);
            return (ratio(a) - ratio(b)) * dir;
          case "status":
            return (statusRank(a) - statusRank(b)) * dir;
          case "origin":
            // Sort by nextDue
            const dv = (d?: string) =>
              d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
            return (dv(a.nextDue) - dv(b.nextDue)) * dir;
          default:
            return 0;
        }
      });
    }
    // Auto‑collapse only on the very first render; afterwards respect user toggles
    if (this.firstRender) {
      this.collapsed = new Set(projects.map(p => p.id));
      this.firstRender = false;
    }
    // Refresh caret icon now that collapsed set is final
    setIcon(globalCaret, this.allCollapsed() ? "chevron-right" : "chevron-down");

    /* ── Project rows ─────────────────────────────── */
    this.visibleGroupIds = [];
    for (const project of projects) {
      const row = tbody.createEl("tr");

      /* Auto‑expand assignee if any task matches the current quick‑filter */
      const matchesFilter = this.filterText
        ? (project.tasks as any[]).some(t => {
            const hay = `${t.text ?? ""} ${(t.id ?? "")}`.toLowerCase();
            return hay.includes(this.filterText);
          })
        : false;

      /* Collapsed if user collapsed it AND (no filter or no match)   */
      const isCollapsed =
        this.collapsed.has(project.id) && (!this.filterText || !matchesFilter);

      // This group is visible in the table regardless of collapsed state
      this.visibleGroupIds.push(project.id);

      /* Name + caret */
      const nameCell = row.createEl("td", { cls: "pm-dash-name" });
      const caret = nameCell.createEl("span");
      setIcon(caret, isCollapsed ? "chevron-right" : "chevron-down");
      caret.style.marginRight = "4px";
      caret.style.cursor = "pointer";
      caret.onclick = (e) => {
        e.stopPropagation();
        this.toggle(project.id);
      };

      nameCell.createSpan({ text: project.label });

      /* Calculate task tally – fall back to pre‑computed cache fields */
      let totalTasks: number;
      let doneTasks:  number;
      if (Array.isArray((project as any).tasks)) {
        const projTasks: any[] = (project as any).tasks;
        const counted = projTasks.filter((tk) => {
          const idUp = ((tk.id ?? "") as string).toUpperCase();
          return idUp.startsWith("SB");      // include only sub-tasks (SB-)
        });
        totalTasks = counted.length;
        doneTasks  = counted.filter(isTaskDone).length;
      } else {
        totalTasks = (project as any).totalTasks ?? 0;
        doneTasks  = (project as any).completedTasks ?? 0;
      }

      /* Tasks ✓/total (+ red ! if total exceeds threshold from settings) */
      const tasksCell = row.createEl("td", {
        text: `${doneTasks} / ${totalTasks}`,
      });
      const overload = Number(this.settings.resourcesOverloadThreshold ?? 20);
      if (totalTasks > overload) {
        tasksCell.createEl("span", {
          text: " !",
          cls: "pm-overload",
        });
      }

      /* Status */
      const pctNum = Math.round((project as any).percentComplete * 100);
      const { label, cls } = projectStatus(
        project.nextDue,
        pctNum / 100
      );
      const stTd = row.createEl("td", { cls: "pm-status-cell" });
      // 1. Status badge (always shown)
      stTd.createEl("span", { cls: `pm-badge ${cls}`, text: label });
      attachStatusPopup(stTd, statusTooltip(project.nextDue, pctNum / 100));

      /* Project column left blank for group rows */
      row.createEl("td");

      /* If filter active and no task matches, hide the entire group row */
      if (this.filterText && !matchesFilter) continue;

      /* ── Task sub-rows ─────────────────────────── */
      if (!isCollapsed && Array.isArray((project as any).tasks)) {
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
              attr: { colspan: "4" }
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
              
              if (this.collapsedProjects.has(projectName)) {
                this.collapsedProjects.delete(projectName);
              } else {
                this.collapsedProjects.add(projectName);
              }
              
              this.render();
              
              // Restore scroll position with multiple attempts
              const restoreScroll = () => {
                const newTableContainer = this.container.querySelector('.pm-table-container');
                if (newTableContainer) {
                  newTableContainer.scrollTop = scrollTop;
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
          
          /* Skip tasks that don't match filter */
          if (this.filterText) {
            const hay = `${t.text ?? ""} ${(t.id ?? "")}`.toLowerCase();
            if (!hay.includes(this.filterText)) continue;
          }

          /* Skip tasks based on visibility settings */
          const taskIdUpper = ((t as any).id ?? "").toUpperCase();
          const isEpic = taskIdUpper.startsWith("E");
          const isStory = taskIdUpper.startsWith("S") && !taskIdUpper.startsWith("SB");
          const isSubTask = taskIdUpper.startsWith("SB");
          
          if (isEpic && !this.showEpics) continue;
          if (isStory && !this.showStories) continue;
          if (isSubTask && !this.showSubTasks) continue;

          const tRow = tbody.createEl("tr", { cls: "pm-task-row" });

          /* Task name (clickable link) */
          const tName = tRow.createEl("td", { cls: "pm-task-name" });

          const idTag = ((t as any).id ?? "").toUpperCase();
          const indentLevel =
            idTag.startsWith("E") ? 0 :
            (idTag.startsWith("S") && !idTag.startsWith("SB")) ? 1 : 2;
          tName.style.paddingLeft = `${20 + indentLevel * 12}px`;

          let done = isTaskDone(t);
          const tPct =
            typeof (t as any).percentComplete === "number"
              ? Math.round((t as any).percentComplete * 100)
              : done ? 100 : 0;

          if (done) {
            const chk = tName.createEl("span");
            setIcon(chk, "check-circle");
            chk.addClass("pm-task-check");
            chk.style.marginRight = "4px";
          } else {
            tName.createEl("span", { text: "• ", cls: "pm-task-bullet" });
          }

          const prefix = (() => {
            const id: string = (t as any).id ?? "";
            if (!id) return "";
            const match = id.match(/^(E|SB?|S)-?\d+/i);
            return match ? `${match[0].toUpperCase()} ` : "";
          })();

          const anchor = tName.createEl("a", {
            text: `${prefix}${t.text ?? "(untitled)"}`,
            href: (t as any).file?.path ?? "",
          });
          /* pencil icon to reassign (placed after the task link) */
          const editBtn = tName.createSpan({ cls: "pm-assignee-edit" });
          setIcon(editBtn, "user");
          attachTip(editBtn, "Reassign Assignee");
          editBtn.style.cssText =
            "margin-left:6px; cursor:pointer; position:relative; z-index:10;";
          const onEdit = (ev: MouseEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            /* DEBUG: confirm the pencil was clicked */

            this.showAssigneePicker(t, editBtn);
          };
          /* Use mousedown to catch event before anchor row intercepts; also bind click */
          editBtn.addEventListener("mousedown", onEdit);
          editBtn.addEventListener("click",      onEdit);

          /* ── Hover tooltip for task meta ─────────────────────────── */
          let hoverTip: HTMLElement | null = null;
          anchor.addEventListener("mouseenter", () => {
            const props = (t as any).props ?? {};
            const val = (k: string) => props[k] ?? props[k.toLowerCase()] ?? "—";
            const html = `
              <strong>${prefix}${t.text ?? "(untitled)"}</strong><br>
              <em>${val("description") || (t.description ?? "").toString().trim() || "—"}</em><br>
              <span>Start: ${val("start")}</span><br>
              <span>Due  : ${val("due") || val("end")}</span><br>
              <span>Assignee: ${val("assignee") || val("owner") || (t.assignee ?? t.owner ?? "—")}</span>
            `;
            hoverTip = document.createElement("div");
            hoverTip.className = "pm-dash-tooltip";
            hoverTip.innerHTML = html;
            document.body.appendChild(hoverTip);
            // Tooltip positioning with window clamping
            const r   = anchor.getBoundingClientRect();
            const pad = 8;                       // gap from window edges

            /* Default position: to the right of the anchor */
            let left = r.right + 8;
            let top  = r.top;

            /* Measure tooltip after it's in the DOM */
            const tipW = hoverTip.offsetWidth  || 220;  // fallback width
            const tipH = hoverTip.offsetHeight || 140;  // fallback height

            /* Horizontal overflow – flip to left side */
            if (left + tipW > window.innerWidth - pad) {
              left = Math.max(r.left - tipW - 8, pad);
            }

            /* Vertical overflow – clamp within viewport */
            if (top + tipH > window.innerHeight - pad) {
              top = Math.max(window.innerHeight - tipH - pad, pad);
            }

            hoverTip.style.left = `${left}px`;
            hoverTip.style.top  = `${top}px`;
          });
          anchor.addEventListener("mouseleave", () => {
            hoverTip?.remove();
            hoverTip = null;
          });
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

          /* Tasks column: tally sub-tasks for Epics and Stories, with completion toggle for SB tasks */
          (() => {
            const idUp = ((t as any).id ?? "").toUpperCase();
            const isEpic = idUp.startsWith("E");
            const isStory = idUp.startsWith("S") && !idUp.startsWith("SB");
            const isSB = idUp.startsWith("SB");
            let taskText = "—";
            
            if (isEpic || isStory) {
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
                        queue.push(cid);
                      }
                    }
                  });
                }
                return desc;
              };
              let childTasks: any[] = [];
              if (isStory) {
                childTasks = tasks.filter((candidate) => {
                  const deps = (candidate.depends ?? []).map((d: string) => d.toUpperCase());
                  if (!deps.includes(idUp)) return false;
                  const cid = ((candidate.id ?? "") as string).toUpperCase();
                  return cid.startsWith("SB");
                });
              } else if (isEpic) {
                childTasks = gatherDescendants(idUp);
              }
              if (childTasks.length > 0) {
                const doneCnt = childTasks.filter(isTaskDone).length;
                taskText = `${doneCnt} / ${childTasks.length}`;
              }
            }
            
            // Create Tasks column with clickable check/X icon for SB tasks
            const tasksCell = tRow.createEl("td");
            
            if (isSB) {
              // For SB tasks, add clickable completion toggle
              const isDone = isTaskDone(t);
              const toggleBtn = tasksCell.createEl("span");
              toggleBtn.style.cursor = "pointer";
              toggleBtn.style.marginRight = "4px";
              
              if (isDone) {
                setIcon(toggleBtn, "check-circle");
                let tooltip: HTMLElement | null = null;
                toggleBtn.addEventListener("mouseenter", () => {
                  tooltip = document.createElement("div");
                  tooltip.className = "pm-dash-tooltip";
                  tooltip.textContent = "Mark as incomplete";
                  document.body.appendChild(tooltip);
                  const rect = toggleBtn.getBoundingClientRect();
                  tooltip.style.left = `${rect.left}px`;
                  tooltip.style.top = `${rect.top - 30}px`;
                });
                const hideToggleTip = () => { tooltip?.remove(); tooltip = null; };
                toggleBtn.addEventListener("mouseleave", hideToggleTip);
                document.addEventListener("scroll", hideToggleTip, { capture: true, once: true });
                toggleBtn.onclick = async (e) => {
                  e.stopPropagation();
                  hideToggleTip();
                  await this.toggleTaskCompletion(t, false);
                  // Clean up any remaining popups after task completion
                  document.querySelectorAll(".pm-dash-tooltip").forEach(el => el.remove());
                  document.querySelectorAll(".pm-status-popup").forEach(el => el.remove());
                };
              } else {
                setIcon(toggleBtn, "circle");
                let tooltip: HTMLElement | null = null;
                toggleBtn.addEventListener("mouseenter", () => {
                  tooltip = document.createElement("div");
                  tooltip.className = "pm-dash-tooltip";
                  tooltip.textContent = "Mark as complete";
                  document.body.appendChild(tooltip);
                  const rect = toggleBtn.getBoundingClientRect();
                  tooltip.style.left = `${rect.left}px`;
                  tooltip.style.top = `${rect.top - 30}px`;
                });
                const hideToggleTip2 = () => { tooltip?.remove(); tooltip = null; };
                toggleBtn.addEventListener("mouseleave", hideToggleTip2);
                document.addEventListener("scroll", hideToggleTip2, { capture: true, once: true });
                toggleBtn.onclick = async (e) => {
                  e.stopPropagation();
                  hideToggleTip2();
                  await this.toggleTaskCompletion(t, true);
                  // Clean up any remaining popups after task completion
                  document.querySelectorAll(".pm-dash-tooltip").forEach(el => el.remove());
                  document.querySelectorAll(".pm-status-popup").forEach(el => el.remove());
                };
              }
              // No text for SB tasks, just the icon
            } else {
              // For non-SB tasks (Epics/Stories), just show the text
              tasksCell.setText(taskText);
            }
          })();

          /* Status + dates — mirror Timeline logic */
          const taskDueIso = ((t as any).props?.["due"] ?? "")
            .toString()
            .replace(/\u00A0/g, " ")
            .trim();
          const taskStartIso = ((t as any).props?.["start"] ?? "")
            .toString()
            .replace(/\u00A0/g, " ")
            .trim();
          const taskDue = taskDueIso || taskStartIso || undefined;
          const taskMtime =
            (t as any).file?.stat?.mtime ??
            (t as any).mtime ??
            (t as any).updated ??
            undefined;
          const pctForStatus = (done || tPct === 100) ? 1 : (tPct / 100);
          const { label: tLabel0, cls: tCls0 } = projectStatus(taskDue, pctForStatus);
          const tLabel = (tPct === 100) ? "Completed" : tLabel0;
          const tCls   = (tPct === 100) ? "complete"   : tCls0;
          const stCell = tRow.createEl("td");

          // Only render play/pause button and status dot logic for SB-tasks (like weekly view)
          if (t?.id?.toUpperCase().startsWith("SB")) {
            // Wrapper div for all status elements (badge, dot, button)
            const statusWrapper = stCell.createDiv({ cls: "pm-status-cell-wrapper" });

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
          // Close custom status tooltip if open
          document.querySelectorAll(".pm-dash-tooltip").forEach(el => el.remove());
          // Also close any pm-status-popup if open
          document.querySelectorAll(".pm-status-popup").forEach(el => el.remove());
          this.render();
        }
      }
    };
  }
} else {
  // For non-SB tasks, render only the default badge and status dot, no play/pause button.
  stCell.createEl("span", {
    cls:  `pm-badge ${tCls}`,
    text: tLabel,
  });
  // Add colored dot for status
  if (t.status === "in-progress") {
    stCell.createEl("span", { text: "●", cls: "pm-in-progress-dot" });
  } else if (t.status === "on-hold") {
    stCell.createEl("span", { text: "●", cls: "pm-on-hold-dot" });
  }
  attachStatusPopup(stCell, statusTooltip(taskDueIso || taskStartIso, pctForStatus));
}

          /* Project column (link to project note) */
          const projCell = tRow.createEl("td", { cls: "pm-text-muted" });
          if (t.projectPath) {
            const link = projCell.createEl("a", {
              text: (t.projectName ?? "—").toString(),
              href: t.projectPath,
            });
            link.style.cursor = "pointer";
            link.onclick = (e) => {
              e.preventDefault();
              this.app.workspace.openLinkText(t.projectPath, "", false);
            };
            let projHover: HTMLElement | null = null;
            link.addEventListener("mouseenter", () => {
              const tFile = this.app.vault.getFileByPath(t.projectPath);
              const fm: Record<string, any> =
                (tFile instanceof TFile
                  ? this.app.metadataCache.getFileCache(tFile)?.frontmatter
                  : undefined) ??
                this.app.metadataCache.getCache(t.projectPath)?.frontmatter ??
                {};
              const fmVal = (k: string) => {
                const norm  = (s: string) => s.replace(/[\s_]+/g, "").toLowerCase();
                const target = norm(k);
                for (const key in fm) {
                  if (norm(key) === target) return fm[key];
                }
                return "—";
              };
              let html = `<strong>${t.projectName}</strong>`;
              if (Object.keys(fm).length > 0) {
                html += `<br><em>${fmVal("description")}</em>
                         <br><span>Start: ${fmVal("start date")}</span>
                         <br><span>Due  : ${fmVal("end date") || fmVal("due date")}</span>`;
              }
              projHover = document.createElement("div");
              projHover.className = "pm-dash-tooltip";
              projHover.innerHTML = html;
              document.body.appendChild(projHover);
              // --- New window-clamping logic for tooltip positioning ---
              const r   = link.getBoundingClientRect();
              const pad = 8;                          // minimal gap from edges
              const tipW = projHover.offsetWidth  || 220;
              const tipH = projHover.offsetHeight || 120;

              /* Default position: to the right of the link */
              let left = r.right + pad;
              let top  = r.top;

              /* Horizontal overflow – flip to left side */
              if (left + tipW > window.innerWidth - pad) {
                left = Math.max(r.left - pad - tipW, pad);
              }

              /* Vertical overflow – clamp within viewport */
              if (top + tipH > window.innerHeight - pad) {
                top = Math.max(window.innerHeight - tipH - pad, pad);
              }
              if (top < pad) top = pad;

              projHover.style.left = `${left}px`;
              projHover.style.top  = `${top}px`;
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

    // Set caret icon based on currently visible groups' collapsed state
    const vis = this.visibleGroupIds;
    const visAllCollapsed = vis.length > 0 && vis.every(id => this.collapsed.has(id));
    setIcon(globalCaret, visAllCollapsed ? "chevron-right" : "chevron-down");
  }

  public focusSearch() {
    this.container
      .querySelector<HTMLInputElement>(".pm-search-input")
      ?.focus();
  }

  /* ── Inline reassignment picker ───────────────────────────── */

  /** Extract every unique assignee name found in current cache
      (fallback when registry has no people). */
  private gatherAssigneesFromTasks(): { id: string; name: string }[] {
    const map = new Map<string, string>();
    this.cache.projects.forEach((proj) => {
      (proj as any).tasks?.forEach((t: any) => {
        const raw = (t.assignee ?? t.props?.assignee ?? "").toString();
        raw.split(",").forEach((s: string) => {
          const n = s.trim();
          if (n && n !== "-") map.set(n.toLowerCase(), n);
        });
      });
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }

  /** Show dropdown of all people under the clicked element. */
  private showAssigneePicker(task: any, anchor: HTMLElement) {
    const old = document.querySelector(".pm-picker");
    if (old) old.remove();

    const picker = document.createElement("div");
    picker.className = "pm-picker";

    picker.createEl("div", { text: "Reassign Assignee", cls: "pm-picker-title" });

    const listWrap = picker.createEl("div", { cls: "pm-picker-list" });

    const currentRaw =
      (task.assignee ??
       task.props?.assignee ??
       task.owner ??
       task.props?.owner ??
       "Unassigned").toString();
    const currentAssignee = currentRaw.split(",")[0].trim() || "Unassigned";

    const footer  = picker.createEl("div", { cls: "pm-picker-footer" });
    const summary = footer.createEl("span", { text: `${currentAssignee} → —` });
    const btnWrap = footer.createEl("span");

    const btnOk = btnWrap.createSpan({ cls: "pm-btn" });
    setIcon(btnOk, "check");
    const btnCancel = btnWrap.createSpan({ cls: "pm-btn" });
    setIcon(btnCancel, "x");

    const seen = new Map<string, string>();
    registry.listPeople().forEach((p) => seen.set(p.id.toLowerCase(), p.name));
    this.gatherAssigneesFromTasks().forEach((p) => {
      if (!seen.has(p.id.toLowerCase())) seen.set(p.id.toLowerCase(), p.name);
    });
    const people = Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let selectedId:   string | null = null;   // lower‑case key
    let selectedName: string | null = null;   // preserve original casing
    people.forEach((p) => {
      const opt = listWrap.createEl("div", { text: p.name, cls: "pm-picker-item" });
      opt.onclick = () => {
        listWrap.querySelectorAll(".pm-picker-item.selected")
                .forEach((el) => el.removeClass("selected"));
        opt.addClass("selected");

        selectedId   = p.id;
        selectedName = p.name;
        summary.setText(`${currentAssignee} → ${p.name}`);
      };
    });

    btnOk.onclick = () => {
      if (selectedName && selectedName.toLowerCase() !== currentAssignee.toLowerCase()) {
        this.reassignTask(task, selectedName);
      }
      picker.remove();
    };
    btnCancel.onclick = () => picker.remove();

    const onDoc = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) {
        picker.remove();
        document.removeEventListener("mousedown", onDoc);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onDoc));

    document.body.appendChild(picker);

    const r       = anchor.getBoundingClientRect();
    const pad     = 8;
    const pickerW = picker.offsetWidth  || 220;   // fallback width
    const pickerH = picker.offsetHeight || 300;   // fallback height

    /* Default position: below anchor */
    let left = r.left;
    let top  = r.bottom + 6;

    /* Prevent horizontal overflow */
    if (left + pickerW > window.innerWidth - pad) {
      left = Math.max(window.innerWidth - pickerW - pad, pad);
    } else if (left < pad) {
      left = pad;
    }

    /* Prevent vertical overflow – if no room below, try above; if still no room,
       clamp to bottom edge minus padding */
    if (top + pickerH > window.innerHeight - pad) {
      const above = r.top - pickerH - 6;
      top = above >= pad ? above
                         : Math.max(window.innerHeight - pickerH - pad, pad);
    }

    picker.style.left = `${left}px`;
    picker.style.top  = `${top}px`;
  }

  /** Replace or add `assignee:: <new>` for the *specific* task block. */
  private async reassignTask(task: any, newId: string) {
    /* Resolve underlying TFile from task */
    let file: TFile | null = null;
    if (task.file instanceof TFile) {
      file = task.file;
    } else if (task.file?.path) {
      const f = this.app.vault.getFileByPath(task.file.path);
      if (f instanceof TFile) file = f;
    } else if (task.projectPath) {
      const f = this.app.vault.getFileByPath(task.projectPath);
      if (f instanceof TFile) file = f;
    }

    if (!file) { new Notice("File not found for task"); return; }

    // Read note and split into lines
    const note   = await this.app.vault.read(file);
    const idUpper = String(task.id ?? "").trim().toUpperCase();
    /* Always use assignee:: as the canonical field.
       When updating, we will overwrite either `assignee::` or `owner::`
       whichever is already present, otherwise append `assignee::`. */
    const field = "assignee";
    const lines  = note.split(/\r?\n/);

    /* ── Locate the task bullet ───────────────────────────────────── */

    // 0‑based index of the bullet line
    let start = -1;

    /* Dataview 0.5+ provides `.line` (0‑based).
       Older snapshots may expose `.lineNumber` (1‑based). */
    const dvLine = task.line ?? task.lineNumber;
    if (typeof dvLine === "number") {
      if (dvLine >= 0 && dvLine < lines.length) {
        // Treat as 0‑based position
        start = dvLine;
      } else if (dvLine - 1 >= 0 && dvLine - 1 < lines.length) {
        // Fallback: assume 1‑based and convert
        start = dvLine - 1;
      }
    }

    // Helper: bullet regexp and text snippet
    const bulletRE = /^\s*-\s*(?:\[[ xX]\]\s*)?/;
    const snippet  = String(task.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)
      .toLowerCase();

    // 2️⃣ Bullet line containing task text
    if (start === -1 && snippet) {
      start = lines.findIndex(
        (ln) => bulletRE.test(ln) && ln.toLowerCase().includes(snippet)
      );
    }

    // 3️⃣ Fallback: ID + snippet search
    if (start === -1) {
      const id = String(task.id ?? "").trim();
      start = lines.findIndex(
        (ln) =>
          (id && ln.includes(id)) ||
          (snippet && ln.toLowerCase().includes(snippet))
      );
    }

    /* If we found a line but it is a table row (contains pipes) – update table cell instead */
    if (start !== -1 && /\|/.test(lines[start])) {
      const rowIdx = start;

      let cells = lines[rowIdx].split("|").map((c) => c.trim());

      const hasLead  = /^\s*\|/.test(lines[rowIdx]);
      const hasTrail = /\|\s*$/.test(lines[rowIdx]);

      /* drop leading / trailing empty cell caused by outer pipes */
      if (hasLead  && cells.length && cells[0] === "")       cells = cells.slice(1);
      if (hasTrail && cells.length && cells[cells.length-1]==="") cells = cells.slice(0, -1);

      /* locate assignee / owner column */
      let col = cells.findIndex((c) => /^(assignee|owner)::/i.test(c));
      if (col === -1) col = 4;           // fallback "Assignee" column (0‑based after trim)

      cells[col] = cells[col].replace(
        /^(?:assignee|owner)::\s*[^|]*/i,
        `assignee:: ${newId}`
      );

      let newRow = cells.join(" | ");
      if (hasLead)  newRow = "| " + newRow;
      if (hasTrail) newRow = newRow + " |";

      lines[rowIdx] = newRow;
      await this.app.vault.modify(file, lines.join("\n"));
      new Notice(`Re‑assigned to ${newId}`);
      this.render();
      return;
    }

    /* ── Fallback: try table row (markdown pipe table) ─────────────── */
    if (start === -1) {
      const rowIdx = lines.findIndex((ln) =>
        ln.includes(`| ${idUpper}`) || ln.startsWith(`| ${idUpper}`)
      );
      if (rowIdx === -1) {
        new Notice("Could not locate task in file");
        return;
      }

      /* Split the row into cells, trim spaces */
      let cells = lines[rowIdx].split("|").map((c) => c.trim());

      const hasLead  = /^\s*\|/.test(lines[rowIdx]);
      const hasTrail = /\|\s*$/.test(lines[rowIdx]);

      /* drop leading / trailing empty cell caused by outer pipes */
      if (hasLead  && cells.length && cells[0] === "")       cells = cells.slice(1);
      if (hasTrail && cells.length && cells[cells.length-1]==="") cells = cells.slice(0, -1);

      /* Heuristic: find first cell that starts with assignee:: or owner:: */
      let col = cells.findIndex((c) => /^(assignee|owner)::/i.test(c));
      if (col === -1) {
        /* Fallback: assume "Assignee" column is the 5th cell (index 4 after trim) */
        col = 4;
      }

      /* Build new cell text */
      cells[col] = cells[col].replace(
        /^(?:assignee|owner)::\s*[^|]*/i,
        `assignee:: ${newId}`
      );

      /* Re‑join with pipes, preserving leading/trailing pipe if present */
      let newRow = cells.join(" | ");
      if (hasLead)  newRow = "| " + newRow;
      if (hasTrail) newRow = newRow + " |";

      lines[rowIdx] = newRow;
      await this.app.vault.modify(file, lines.join("\n"));
      new Notice(`Re‑assigned to ${newId}`);
      this.render();
      return;
    }

    /* ── Determine the end of the task block (until next list item) ─ */
    let end = start;
    while (
      end + 1 < lines.length &&
      !bulletRE.test(lines[end + 1]) &&
      lines[end + 1].trim() !== ""
    ) {
      end++;
    }

    // Extract block and indentation
    const block    = lines.slice(start, end + 1);
    /* ── Replace any existing assignee:: or owner:: line ─ */
    let replaced = false;
    for (let i = 0; i < block.length; i++) {
      if (/^(?:\s*)(assignee|owner)\s*::/i.test(block[i])) {
        block[i] = block[i].replace(
          /^(?:\s*)(assignee|owner)\s*::\s*([^|<\n\r]*)/i,
          (_, pKey) => `${pKey.replace(/owner/i, "assignee")}:: ${newId}`
        );
        replaced = true;
      }
    }
    if (replaced) {
      lines.splice(start, end - start + 1, ...block);
      await this.app.vault.modify(file, lines.join("\n"));
      new Notice(`Re‑assigned to ${newId}`);
      this.render();
      return;
    }
    const indent   = block[0].match(/^\s*/)?.[0] ?? "";
    const newLine  = `${indent}  ${field}:: ${newId}`;

    // Replace existing assignee/owner line or append
    const idx = block.findIndex((ln) => new RegExp(`^\\s*${field}\\s*::`, "i").test(ln));
    if (idx !== -1) block[idx] = newLine;
    else            block.push(newLine);

    // Splice updated block back into note
    lines.splice(start, end - start + 1, ...block);
    await this.app.vault.modify(file, lines.join("\n"));

    new Notice(`Re‑assigned to ${newId}`);
    this.render();                      // refresh view
  }

  private async toggleTaskCompletion(task: any, done: boolean) {
    const file = task.file;
    if (!file) return;

    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const taskText = (task.text ?? "").toString();
    const checkboxRegex = /\[[ xX\/-]\]/;

    let lineIdx = typeof task.line === "number" ? task.line : -1;

    if (lineIdx >= 0 && lines[lineIdx] && checkboxRegex.test(lines[lineIdx])) {
      // Use this line
    } else {
      // Search for the first line with a checkbox and matching task text
      lineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(taskText) && checkboxRegex.test(lines[i])) {
          lineIdx = i;
          break;
        }
      }
    }

    if (lineIdx >= 0) {
      const match = lines[lineIdx].match(/\[[ xX\/-]\]/);
      if (match) {
        const box = match[0];
        let replacement = box;
        if (done) {
          // Mark as complete
          if (box === "[ ]" || box === "[/]" || box === "[-]") {
            replacement = "[x]";
          }
        } else {
          // Mark as incomplete
          if (box === "[x]" || box === "[X]") {
            replacement = "[ ]";
          }
        }
        lines[lineIdx] = lines[lineIdx].replace(/\[[ xX\/-]\]/, replacement);
        await this.app.vault.modify(file, lines.join("\n"));
        this.render();
      }
    }
  }
}