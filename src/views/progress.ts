import {
  ItemView,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type { ViewStateResult } from "obsidian";
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";

// Load dashboard-specific stylesheet
import "../../styles/styles-progress.css";

/** Helper: format a date or return an em-dash if undefined */
function formatDate(d: string | number | Date | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

/** Helper: determine status badge label and CSS class
 *  If overrideOnTrack is true, and pct < 1 and not overdue, returns "On track"
 */
function projectStatus(
  nextDue?: string,
  pct = 0,
  overrideOnTrack: boolean = false
): { label: string; cls: string } {
  if (pct >= 1) return { label: "Completed", cls: "complete" };
  if (!nextDue) {
    // If overrideOnTrack is set, still allow "On track" if in progress
    if (overrideOnTrack) return { label: "On track", cls: "on-track" };
    return { label: "No date", cls: "no-date" };
  }

  const today   = new Date();
  const due     = new Date(nextDue);
  const msInDay = 86_400_000;
  const diff    = (due.getTime() - today.getTime()) / msInDay;

  if (diff < 0)  return { label: "Off track", cls: "off-track" }; // red
  // If overrideOnTrack, and not overdue, force "On track"
  if (overrideOnTrack) return { label: "On track", cls: "on-track" };
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
function isTaskDone(t: any): boolean {
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
 * Order tasks for the dashboard so that
 *   • Each Epic (E‑n) is followed by all Stories (S‑n) sharing the same number
 *   • Each Story (S‑n) is followed by SB‑tasks (SB‑n) sharing the same number
 *   • If no numeric match exists, fall back to “depends” links
 *   • Any remaining tasks keep their original relative order
 */
function orderTasksDash(tasks: any[]): any[] {
  const done = new Set<any>();
  const out: any[] = [];

  /* Extract the numeric “core” of an ID: E‑1 → 1, S‑2.3 → 2.3, SB‑007 → 007 */
  const core = (id: string = ""): string =>
    id.replace(/^[A-Za-z]+-?/, "").trim().toLowerCase();

  /* Quick look‑ups by epic and story properties */
  const storiesByEpic = new Map<string, any[]>();
  const subsByStory = new Map<string, any[]>();

  tasks.forEach((t) => {
    const id = (t.id ?? "").toString();
    
    if (/^s\b/i.test(id) && !/^sb\b/i.test(id)) {
      // Group stories by their epic property
      const epicRef = (t.props?.epic ?? "").toString().trim().toLowerCase();
      if (epicRef) {
        (storiesByEpic.get(epicRef) ?? storiesByEpic.set(epicRef, []).get(epicRef)!).push(t);
      }
    } else if (/^sb\b/i.test(id)) {
      // Group subtasks by their story property
      const storyRef = (t.props?.story ?? "").toString().trim().toLowerCase();
      if (storyRef) {
        (subsByStory.get(storyRef) ?? subsByStory.set(storyRef, []).get(storyRef)!).push(t);
      }
    }
  });

  /* Push a task and, if Epic/Story, its children */
  const pushCascade = (t: any) => {
    if (done.has(t)) return;
    done.add(t);
    out.push(t);

    const id = (t.id ?? "").toString().toLowerCase();

    if (/^e\b/i.test(id)) {
      /* Push Stories that belong to this epic */
      const stories = storiesByEpic.get(id) ?? [];
      stories.forEach(pushCascade);
    }

    if (/^s\b/i.test(id) && !/^sb\b/i.test(id)) {
      /* Push SB‑tasks that belong to this story */
      const subtasks = subsByStory.get(id) ?? [];
      subtasks.forEach(pushCascade);
    }
  };

  /* Pass 1: Epics first (and their cascades) */
  tasks.forEach((t) => {
    if (/^e\b/i.test((t.id ?? "").toString())) pushCascade(t);
  });

  /* Pass 2: Stories not already output */
  tasks.forEach((t) => {
    const id = (t.id ?? "").toString();
    if (done.has(t)) return;
    if (/^s\b/i.test(id) && !/^sb\b/i.test(id)) pushCascade(t);
  });

  /* Pass 3: Remaining tasks in original order */
  tasks.forEach((t) => {
    if (!done.has(t)) {
      done.add(t);
      out.push(t);
    }
  });

  return out;
}

export const VIEW_TYPE_PM_PROGRESS = "pm-progress-view";

export class ProjectProgressView extends ItemView {
  /** icon shown on the view tab */
  public icon = "bar-chart-2";   // bar‑chart icon signals "progress"
  /** Optional set of project file paths to display (injected by Portfolio view) */
  private filterPaths?: Set<string>;
  /** Optional name of the portfolio that opened this dashboard */
  private filterName?: string;
  private sortField: string | null = "project";
  private sortAsc = true;
  private collapsed = new Set<string>();
  private firstRender = true;
  private showEpics = true;                // show/hide epics
  private showStories = true;              // show/hide stories
  private showSubTasks = true;             // show/hide sub-tasks
  private filterAssignees?: Set<string>;   // filtered assignees (undefined = all)
  private originalPaths: string[] | null = null;  // The initial project paths passed in from Portfolio
  private filterText = "";                 // live text in the quick-filter box

  private cache: ProjectCache;
  private settings: PmSettings;
  private container!: HTMLElement;
  private detachFn: (() => void) | null = null;

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
  async setState(state: any, result: ViewStateResult): Promise<void> {
    if (state?.filterProjects && Array.isArray(state.filterProjects)) {
      this.filterPaths = new Set(state.filterProjects as string[]);
      this.originalPaths = [...state.filterProjects];  // Store original paths for Portfolio filter
    } else {
      this.filterPaths = undefined;
      this.originalPaths = null;
    }
    if (typeof state?.filterName === "string" && state.filterName.trim() !== "") {
      this.filterName = state.filterName.trim();
    } else {
      this.filterName = undefined;
    }
    this.render();
  }

  /** Allow Portfolio view to refresh the filter at runtime */
  public updateFilter(paths: string[] | null, name?: string) {
    if (paths === null) {
      this.filterPaths = undefined;
    } else {
      this.filterPaths = new Set(paths);
      // Update originalPaths if we're setting a specific filter
      if (paths.length > 0 && name) {
        this.originalPaths = [...paths];
      }
    }
    this.filterName  = name;
    this.render();
  }

  getViewType(): string {
    return VIEW_TYPE_PM_PROGRESS;
  }
  getDisplayText(): string {
    return this.filterName
      ? `Progress – ${this.filterName}`
      : "Progress";
  }

  async onOpen() {
    this.container = this.contentEl;
    this.render();
    this.detachFn = this.cache.onChange(() => this.render());
  }
  async onClose() {
    this.detachFn?.();
  }

  /** Returns true if every project row is collapsed */
  private allCollapsed(): boolean {
    return this.collapsed.size === this.cache.projects.size && this.cache.projects.size > 0;
  }

  /** Collapse or expand all projects at once */
  private toggleAll() {
    if (this.allCollapsed()) {
      this.collapsed.clear();                 // expand everything
    } else {
      this.collapsed = new Set(
        [...this.cache.projects.values()].map(p => p.file.path)
      );                                       // collapse everything
    }
    this.render();
  }

  /** Toggle fold / unfold for one project and re-render */
  private toggle(path: string) {
    if (this.collapsed.has(path)) this.collapsed.delete(path);
    else this.collapsed.add(path);
    this.render();
  }

  private render() {
    // Remove any lingering tooltips from previous interactions
    document.querySelectorAll('.pm-dash-tooltip').forEach((el) => el.remove());
    this.container.empty();
    this.container.addClass("pm-progress-view");

    /* ── Fold/Unfold top bar ───────────────────────── */
    const topbar = this.container.createEl("div", { cls: "pm-dash-topbar" });
    const globalCaret = topbar.createEl("span");
    setIcon(globalCaret, this.allCollapsed() ? "chevron-right" : "chevron-down");
    globalCaret.style.cursor = "pointer";
    globalCaret.onclick = () => this.toggleAll();
    topbar.createEl("span", { text: "Projects" });

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
        
        wrap.onclick = () => {
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
    /* Column widths: Project widest, Tasks & Status thinner */
    const colgroup = table.createEl("colgroup");
    ["56%", "12%", "6%", "6%", "10%", "10%"].forEach((w) =>
      colgroup.createEl("col", { attr: { style: `width:${w}` } })
    );
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");

    const headers: [string, string][] = [
      ["project", "Project"],
      ["progress", "Progress"],
      ["tasks", "Tasks"],
      ["status", "Status"],
      ["nextDue", "Next Due"],
      ["lastUpdated", "Last Updated"],
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
        ico.style.opacity = "0.5";        /* dim when inactive */
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
      cell.addEventListener("mouseenter", (ev) => {
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
      cell.addEventListener("mouseleave", () => { tip?.remove(); tip = null; });
    };

    /* ── Sort projects ─────────────────────────────── */
    let projects = Array.from(this.cache.projects.values()).filter(
      (p) => !this.filterPaths || this.filterPaths.has(p.file.path)
    );

    /* Apply assignee filter */
    if (this.filterAssignees) {
      projects = projects.filter(p => {
        // Check if any task in this project has an assignee that matches the filter
        return (p as any).tasks?.some((t: any) => {
          const raw = (t.assignee ?? t.props?.assignee ?? t.owner ?? t.props?.owner ?? "Unassigned").toString();
          const assignees = raw.split(",").map((s: string) => s.trim().toLowerCase());
          return assignees.some((assignee: string) => this.filterAssignees!.has(assignee));
        });
      });
    }

    // Auto‑collapse only on the very first render; afterwards respect user toggles
    if (this.firstRender) {
      this.collapsed = new Set(projects.map(p => p.file.path));
      this.firstRender = false;
    }
    
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

    /* ── Project rows ─────────────────────────────── */
    for (const project of projects) {
      /* ── Evaluate filters *before* rendering this project ── */
      const matchesFilter = this.filterText
        ? (project.tasks as any[]).some(t => {
            const hay = `${t.text ?? ""} ${(t.id ?? "")}`.toLowerCase();
            return hay.includes(this.filterText);
          })
        : true;                                   // no quick‑filter ⇒ match

      /* Auto‑expand only when a quick‑filter is active *and* this project matches it */
      const autoExpand = this.filterText && matchesFilter;

      const row = tbody.createEl("tr", { cls: "pm-project-row" });
      const isCollapsed = this.collapsed.has(project.file.path) && !autoExpand;

      /* Name + caret */
      const nameCell = row.createEl("td", { cls: "pm-dash-name" });
      const caret = nameCell.createEl("span");
      setIcon(caret, isCollapsed ? "chevron-right" : "chevron-down");
      caret.style.marginRight = "4px";
      caret.style.cursor = "pointer";
      caret.onclick = (e) => {
        e.stopPropagation();
        this.toggle(project.file.path);
      };

      const projLink = nameCell.createEl("a", {
        text: project.file.basename,
        href: project.file.path,
      });
      projLink.style.cursor = "pointer";

      projLink.onclick = (e) => {
        e.preventDefault();
        this.app.workspace.openLinkText(project.file.path, "", false);
      };

      /* ── Hover tooltip with project front‑matter ────────────────────── */
      let projHover: HTMLElement | null = null;

      projLink.addEventListener("mouseenter", () => {
        /* Get latest front‑matter */
        const cache = this.app.metadataCache.getFileCache(project.file);
        const fm: Record<string, any> = cache?.frontmatter ?? {};

        const val = (k: string) =>
          fm[k] ?? fm[k.replace(/ /g, "").toLowerCase()] ?? "—";

        const html = `
          <strong>${project.file.basename}</strong><br>
          <em>${val("Description")}</em><br>
          <span>Start: ${val("Start Date")}</span><br>
          <span>Due  : ${val("End Date") || val("Due Date")}</span>
        `;

        projHover = document.createElement("div");
        projHover.className = "pm-dash-tooltip";
        projHover.innerHTML = html;
        document.body.appendChild(projHover);

        const r = projLink.getBoundingClientRect();
        projHover.style.left = `${r.right + 8}px`;
        projHover.style.top  = `${r.top}px`;
      });

      projLink.addEventListener("mouseleave", () => {
        projHover?.remove();
        projHover = null;
      });

      /* Tally only SB‑sub‑tasks at the project level */
      let totalTasks: number;
      let doneTasks:  number;
      if (Array.isArray((project as any).tasks)) {
        const projTasks: any[] = (project as any).tasks.filter((t: any) => {
          const id = ((t.id ?? "") as string).toUpperCase();
          return id.startsWith("SB");
        });
        totalTasks = projTasks.length;
        doneTasks  = projTasks.filter(isTaskDone).length;
      } else {
        totalTasks = (project as any).totalTasks ?? 0;        // legacy cache fields
        doneTasks  = (project as any).completedTasks ?? 0;
      }

      /* Progress bar — derive from task tally */
      const progCell = row.createEl("td");

      const pctNum =
        totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

      const outer = progCell.createEl("div", {
        cls: `pm-progress ${progressClass(pctNum)}`,
      });
      outer.createEl("div", {
        cls: `pm-progress-inner ${progressClass(pctNum)}`,
        attr: { style: `width:${pctNum}%` },
      });
      progCell.createEl("span", {       // ← add label below bar
        cls: "pm-progress-percent",
        text: `${pctNum}%`,
      });

      /* Tasks ✓/total */
      row.createEl("td", {
        text: `${doneTasks} / ${totalTasks}`,
      });

      /* Status */
      const { label, cls } = projectStatus(
        project.nextDue,
        pctNum / 100      // 1 ⇒ “Completed”
      );
      const stTd = row.createEl("td");
      stTd.createEl("span", { cls: `pm-badge ${cls}`, text: label });
      attachStatusPopup(stTd, statusTooltip(project.nextDue, pctNum / 100));

      /* Dates */
      row.createEl("td", { text: formatDate(project.nextDue) });
      row.createEl("td", { text: formatDate(project.file.stat?.mtime) });

      /* ── Task sub-rows ─────────────────────────── */
      if (!isCollapsed && Array.isArray((project as any).tasks)) {
        /* Sort tasks: Epics (E-) first, then Stories (S-), then Sub‑tasks (SB‑/others) */
        const tasks: any[] = orderTasksDash((project as any).tasks as any[]);
        /* Track which Epic and Story headers we've already inserted */
        const renderedEpics   = new Set<string>();
        const renderedStories = new Set<string>();
        for (const t of tasks) {
          /* ── Skip tasks based on visibility settings ─────────────────── */
          const idU = ((t as any).id ?? "").toUpperCase();
          const isEpic = idU.startsWith("E");
          const isStory = idU.startsWith("S") && !idU.startsWith("SB");
          const isSubTask = idU.startsWith("SB");
          
          if (isEpic && !this.showEpics) continue;
          if (isStory && !this.showStories) continue;
          if (isSubTask && !this.showSubTasks) continue;

          /* Skip tasks that don't match filter */
          if (this.filterText) {
            const hay = `${t.text ?? ""} ${(t.id ?? "")}`.toLowerCase();
            if (!hay.includes(this.filterText)) continue;
          }

          /* ── Group headings (insert once per Epic / Story) ─────────────────── */

          if (isEpic && !renderedEpics.has(idU)) {
            renderedEpics.add(idU);
            const epicHead  = tbody.createEl("tr", { cls: "pm-epic-header" });
            const epicCell  = epicHead.createEl("td", { attr: { colspan: 6 } });
            epicCell.style.paddingLeft = "20px";

            /* Anchor link (same behaviour as task rows) */
            const epicLink = epicCell.createEl("a", {
              text: `${idU}  ${t.text ?? "(untitled)"}`,
              href: (t as any).file?.path ?? "",
            });
            epicLink.style.cursor = "pointer";
            epicLink.onclick = (e) => {
              e.preventDefault();
              const filePath = (t as any).file?.path;
              if (filePath) this.app.workspace.openLinkText(filePath, "", false);
            };

            /* Tooltip – reuse same logic as task anchor */
            let epicTip: HTMLElement | null = null;
            epicLink.addEventListener("mouseenter", () => {
              const props = (t as any).props ?? {};
              const val = (k: string) => props[k] ?? props[k.toLowerCase()] ?? "—";

              const html = `
                <strong>${idU}  ${(t.text ?? "(untitled)")}</strong><br>
                <em>${val("description") || (t.description ?? "").toString().trim() || "—"}</em><br>
                <span>Start: ${val("start")}</span><br>
                <span>Due  : ${val("due") || val("end")}</span><br>
                <span>Assignee: ${val("assignee") || val("owner") || (t.assignee ?? t.owner ?? "—")}</span>
              `;

              epicTip = document.createElement("div");
              epicTip.className = "pm-dash-tooltip";
              epicTip.innerHTML = html;
              document.body.appendChild(epicTip);

              const r   = epicLink.getBoundingClientRect();
              const pad = 8;
              let left  = r.right + 8;
              let top   = r.top;

              const tipW = epicTip.offsetWidth  || 220;
              const tipH = epicTip.offsetHeight || 140;

              if (left + tipW > window.innerWidth - pad) left = Math.max(r.left - tipW - 8, pad);
              if (top  + tipH > window.innerHeight - pad) top  = Math.max(window.innerHeight - tipH - pad, pad);

              epicTip.style.left = `${left}px`;
              epicTip.style.top  = `${top}px`;
            });
            epicLink.addEventListener("mouseleave", () => {
              epicTip?.remove();
              epicTip = null;
            });
          }

          if (isStory && !renderedStories.has(idU)) {
            renderedStories.add(idU);
            const storyHead = tbody.createEl("tr", { cls: "pm-story-header" });
            const storyCell = storyHead.createEl("td", { attr: { colspan: 6 } });
            storyCell.style.paddingLeft = "32px";

            /* Anchor link (same behaviour as task rows) */
            const storyLink = storyCell.createEl("a", {
              text: `${idU}  ${t.text ?? "(untitled)"}`,
              href: (t as any).file?.path ?? "",
            });
            storyLink.style.cursor = "pointer";
            storyLink.onclick = (e) => {
              e.preventDefault();
              const filePath = (t as any).file?.path;
              if (filePath) this.app.workspace.openLinkText(filePath, "", false);
            };

            /* Tooltip – identical to task anchor */
            let storyTip: HTMLElement | null = null;
            storyLink.addEventListener("mouseenter", () => {
              const props = (t as any).props ?? {};
              const val = (k: string) => props[k] ?? props[k.toLowerCase()] ?? "—";

              const html = `
                <strong>${idU}  ${(t.text ?? "(untitled)")}</strong><br>
                <em>${val("description") || (t.description ?? "").toString().trim() || "—"}</em><br>
                <span>Start: ${val("start")}</span><br>
                <span>Due  : ${val("due") || val("end")}</span><br>
                <span>Assignee: ${val("assignee") || val("owner") || (t.assignee ?? t.owner ?? "—")}</span>
              `;

              storyTip = document.createElement("div");
              storyTip.className = "pm-dash-tooltip";
              storyTip.innerHTML = html;
              document.body.appendChild(storyTip);

              const r   = storyLink.getBoundingClientRect();
              const pad = 8;
              let left  = r.right + 8;
              let top   = r.top;

              const tipW = storyTip.offsetWidth  || 220;
              const tipH = storyTip.offsetHeight || 140;

              if (left + tipW > window.innerWidth - pad) left = Math.max(r.left - tipW - 8, pad);
              if (top  + tipH > window.innerHeight - pad) top  = Math.max(window.innerHeight - tipH - pad, pad);

              storyTip.style.left = `${left}px`;
              storyTip.style.top  = `${top}px`;
            });
            storyLink.addEventListener("mouseleave", () => {
              storyTip?.remove();
              storyTip = null;
            });
          }
          /* After inserting its group header, skip rendering a duplicate detail row
             for this Epic or Story itself. */
          if (isEpic || isStory) continue;
          /* ───────────────────────────────────────────────────────── */

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

          /* Bullet or check icon depending on completion */
          if (done) {
            const chk = tName.createEl("span");
            setIcon(chk, "check-circle");
            chk.addClass("pm-task-check");
            chk.style.marginRight = "4px";
          } else {
            tName.createEl("span", { text: "• ", cls: "pm-task-bullet" });
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
          });

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

            const r   = anchor.getBoundingClientRect();
            const pad = 8;                               // minimum gap from edges

            /* Default position: to the right of the task anchor */
            let left = r.right + 8;
            let top  = r.top;

            /* Measure tooltip after it’s in the DOM */
            const tipW = hoverTip.offsetWidth  || 220;    // fallback width
            const tipH = hoverTip.offsetHeight || 140;    // fallback height

            /* Prevent horizontal overflow – if not enough room on the right,
               flip to the left of the anchor */
            if (left + tipW > window.innerWidth - pad) {
              left = Math.max(r.left - tipW - 8, pad);
            }

            /* Prevent vertical overflow – clamp inside viewport */
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

          /* Task progress */
          const tProg = tRow.createEl("td");
          const pctRaw = (t.percentComplete ?? 0) as number;
          let   tPct   = done ? 100 : Math.round(pctRaw * 100);

          /* ── Story roll‑up: derive Story progress as average of child‑task progress ── */
          {
            const idU = ((t as any).id ?? "").toUpperCase();
            const isStory = idU.startsWith("S") && !idU.startsWith("SB");
            if (isStory) {
              /* Gather SB‑children using *exactly* the same rule as the
                 `orderTasksDash › pushWithSubs` helper (depends → Story.id) */
              const childTasks = tasks.filter((sb) => {
                const sid = ((sb as any).id ?? "").toUpperCase();
                if (!sid.startsWith("SB")) return false;

                const deps = (sb.depends ?? []).map((d: string) => d.toUpperCase());
                return deps.includes(idU);     // linked via “depends”
              });

              if (childTasks.length > 0) {
                /* Derive Story progress = average of child‑task progress */
                const pctSum = childTasks.reduce((sum, st) => {
                  if (isTaskDone(st)) return sum + 100;

                  let pcRaw = st.percentComplete ?? 0;
                  if (pcRaw <= 1) pcRaw *= 100;   // convert 0‒1 → 0‒100
                  return sum + Math.min(pcRaw, 100);
                }, 0);

                tPct = Math.round(pctSum / childTasks.length);
                done = tPct >= 100;               // mark Story complete at 100 %
              }
            }
          }

          const tOuter = tProg.createEl("div", {
            cls: `pm-progress ${progressClass(tPct)}`,
          });
          tOuter.createEl("div", {
            cls: `pm-progress-inner ${progressClass(tPct)}`,
            attr: { style: `width:${tPct}%` },
          });
          tProg.createEl("span", {          // ← add label
            cls: "pm-progress-percent",
            text: `${tPct}%`,
          });

          /* Tasks column: tally sub-tasks for Epics and Stories */
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
                /* All descendant tasks (recursive) → keep only SB‑sub‑tasks */
                childTasks = gatherDescendants(idUp).filter((cand) => {
                  const cid = ((cand.id ?? "") as string).toUpperCase();
                  return cid.startsWith("SB");
                });
              }

              if (childTasks.length > 0) {
                const doneCnt = childTasks.filter(isTaskDone).length;
                taskText = `${doneCnt} / ${childTasks.length}`;
              }
            }
            // Create Tasks column with clickable check/X icon
            const tasksCell = tRow.createEl("td");
            
            // For SB tasks, add clickable completion toggle
            const taskIdUp = ((t as any).id ?? "").toUpperCase();
            const isSB = taskIdUp.startsWith("SB");
            
            if (isSB) {
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

          /* prefer due::, fall back to start:: */
          const taskDue = taskDueIso || taskStartIso || undefined;

          /* last‑modified: note file mtime if present */
          const taskMtime =
            (t as any).file?.stat?.mtime ??
            (t as any).mtime ??
            (t as any).updated ??
            undefined;

          // --- Use t.status property provided by the cache
          let taskStatusVal: "not-started" | "in-progress" | "on-hold" | "done" = "not-started";
          if (typeof t.status === "string") {
            const s = t.status.toLowerCase();
            if (s === "done" || s === "complete" || s === "completed") {
              taskStatusVal = "done";
            } else if (s === "in-progress") {
              taskStatusVal = "in-progress";
            } else if (s === "on-hold") {
              taskStatusVal = "on-hold";
            }
          }

          // --- Status badge logic for all tasks (Epics/Stories/SB-etc)
          const idUpForStatus = ((t as any).id ?? "").toUpperCase();
          const isEpicRow = idUpForStatus.startsWith("E");
          const isStoryRow = idUpForStatus.startsWith("S") && !idUpForStatus.startsWith("SB");
          const isSBRow = idUpForStatus.startsWith("SB");
          const pctForStatus = (done || tPct === 100) ? 1 : (tPct / 100);

          // --- Override status if "in progress" and not overdue
          let overrideOnTrack = false;
          if (
            (isSBRow || isEpicRow || isStoryRow) &&
            t.status === "in-progress" &&
            pctForStatus < 1
          ) {
            overrideOnTrack = true;
          }

          const { label: tLabel0, cls: tCls0 } = projectStatus(taskDue, pctForStatus, overrideOnTrack);
          const tLabel = (tPct === 100) ? "Completed" : tLabel0;
          const tCls   = (tPct === 100) ? "complete"   : tCls0;

          const statusCell = tRow.createEl("td");
          statusCell.style.whiteSpace = "nowrap";
          // Always render badge for all tasks
          const badgeEl = statusCell.createEl("span", { cls: `pm-badge ${tCls}`, text: tLabel });
          // Insert in-progress or on-hold dot immediately after badge if task is in-progress or on-hold (using t.status)
          if (t.status === "in-progress") {
            statusCell.createEl("span", { text: "●", cls: "pm-in-progress-dot" });
          } else if (t.status === "on-hold") {
            statusCell.createEl("span", { text: "●", cls: "pm-on-hold-dot" });
          }
          attachStatusPopup(badgeEl, statusTooltip(taskDueIso || taskStartIso, pctForStatus));

          // --- For SB-sub-tasks, append play/pause icon for in-progress toggle
          if (isSBRow) {
            // Only show icon if not done
            if (taskStatusVal === "not-started" || taskStatusVal === "in-progress" || taskStatusVal === "on-hold") {
              const iconBtn = statusCell.createEl("span");
              iconBtn.style.cursor = "pointer";
              iconBtn.style.marginLeft = "6px";
              iconBtn.style.verticalAlign = "middle";
              // Add status button classes for styling
              iconBtn.addClass("pm-status-btn");
              // Ensure t.status is one of the canonical status strings
              // (already normalized above as taskStatusVal)
              // Add class for current status ("not-started", "in-progress", "on-hold")
              iconBtn.addClass(taskStatusVal);
              // Icon and tooltip for each state
              if (taskStatusVal === "not-started") {
                setIcon(iconBtn, "play");
                let tooltip: HTMLElement | null = null;
                iconBtn.addEventListener("mouseenter", () => {
                  tooltip = document.createElement("div");
                  tooltip.className = "pm-dash-tooltip";
                  tooltip.textContent = "Mark as in progress";
                  document.body.appendChild(tooltip);
                  const rect = iconBtn.getBoundingClientRect();
                  tooltip.style.left = `${rect.left}px`;
                  tooltip.style.top = `${rect.top - 30}px`;
                });
                const hideStatusTip1 = () => { tooltip?.remove(); tooltip = null; };
                iconBtn.addEventListener("mouseleave", hideStatusTip1);
                document.addEventListener("scroll", hideStatusTip1, { capture: true, once: true });
              } else if (taskStatusVal === "in-progress") {
                setIcon(iconBtn, "pause");
                let tooltip: HTMLElement | null = null;
                iconBtn.addEventListener("mouseenter", () => {
                  tooltip = document.createElement("div");
                  tooltip.className = "pm-dash-tooltip";
                  tooltip.textContent = "Mark as on hold";
                  document.body.appendChild(tooltip);
                  const rect = iconBtn.getBoundingClientRect();
                  tooltip.style.left = `${rect.left}px`;
                  tooltip.style.top = `${rect.top - 30}px`;
                });
                const hideStatusTip2 = () => { tooltip?.remove(); tooltip = null; };
                iconBtn.addEventListener("mouseleave", hideStatusTip2);
                document.addEventListener("scroll", hideStatusTip2, { capture: true, once: true });
              } else if (taskStatusVal === "on-hold") {
                setIcon(iconBtn, "play");
                let tooltip: HTMLElement | null = null;
                iconBtn.addEventListener("mouseenter", () => {
                  tooltip = document.createElement("div");
                  tooltip.className = "pm-dash-tooltip";
                  tooltip.textContent = "Mark as in progress";
                  document.body.appendChild(tooltip);
                  const rect = iconBtn.getBoundingClientRect();
                  tooltip.style.left = `${rect.left}px`;
                  tooltip.style.top = `${rect.top - 30}px`;
                });
                const hideStatusTip3 = () => { tooltip?.remove(); tooltip = null; };
                iconBtn.addEventListener("mouseleave", hideStatusTip3);
                document.addEventListener("scroll", hideStatusTip3, { capture: true, once: true });
              }
              iconBtn.onclick = async (ev) => {
                ev.stopPropagation();
                const file = (t as any).file;
                if (file) {
                  const content = await this.app.vault.read(file);
                  const lines = content.split(/\r?\n/);
                  // Regex for any markdown checkbox: [ ], [x], [X], [/], [-]
                  const checkboxRegex = /\[[ xX\/-]\]/;
                  // Use task line number if available, else search for the line
                  let found = false;
                  let lineIdx = typeof t.line === "number" ? t.line : -1;
                  // Defensive: check if the line at t.line matches checkbox
                  if (
                    lineIdx >= 0 &&
                    lines[lineIdx] &&
                    checkboxRegex.test(lines[lineIdx])
                  ) {
                    // Use this line
                  } else {
                    // Search for the first line with a checkbox and matching task text
                    lineIdx = -1;
                    const taskText = (t.text ?? "").toString();
                    for (let i = 0; i < lines.length; i++) {
                      if (lines[i].includes(taskText) && checkboxRegex.test(lines[i])) {
                        lineIdx = i;
                        break;
                      }
                    }
                  }
                  if (lineIdx >= 0) {
                    // Determine the current checkbox value
                    const match = lines[lineIdx].match(/\[[ xX\/-]\]/);
                    if (match) {
                      const box = match[0];
                      let replacement = box;
                      if (box === "[ ]") {
                        replacement = "[/]";
                      } else if (box === "[/]") {
                        replacement = "[-]";
                      } else if (box === "[-]") {
                        replacement = "[/]";
                      }
                      lines[lineIdx] = lines[lineIdx].replace(/\[[ xX\/-]\]/, replacement);
                      found = true;
                    }
                  }
                  if (found) {
                    const updated = lines.join("\n");
                    await this.app.vault.modify(file, updated);
                    // Ensure immediate visual badge update after toggling
                    this.render();
                    // Close the status popup if open
                    const popup = iconBtn.closest(".pm-status-popup");
                    if (popup) popup.remove();
                  }
                }
              };
            }
          }

          tRow.createEl("td", { text: formatDate(taskDue) });
          tRow.createEl("td", { text: formatDate(taskMtime) });
        }
      }
    }

    if (this.cache.projects.size === 0) {
      this.container.createEl("p", {
        text: `No project notes found (front-matter \`${this.settings.projectFlagProperty}: true\`).`,
      });
    }
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

  public focusSearch() {
    this.container
      .querySelector<HTMLInputElement>(".pm-search-input")
      ?.focus();
  }
}