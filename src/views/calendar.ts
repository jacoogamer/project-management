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

// Extended task interface for calendar view functions
interface ExtendedTaskItem extends TaskItem {
  done?: boolean | string;
  percentComplete?: number;
  raw?: string;
  priority?: string;
  start?: string;
  due?: string;
  projectName?: string;
  projectPath?: string;
  assignee?: string;
  owner?: string;
}

// Calendar day interface
interface CalendarDay {
  date: string;
  dueTasks: ExtendedTaskItem[];
  startingTasks: ExtendedTaskItem[];
  isToday: boolean;
  isCurrentMonth: boolean;
}

// Load calendar-specific stylesheet
import "../../styles/styles-calendar.css";

/** Helper: format a date or return an em-dash if undefined */
function formatDate(d: string | number | Date | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

/** Detect whether a task is completed */
function isTaskCompleted(t: ExtendedTaskItem): boolean {
  /* explicit flags from parsers */
  if (t.done === true || t.checked === true) return true;
  if (typeof t.done === "string" && t.done.toLowerCase() === "completed") return true;

  /* explicit status strings */
  if (typeof t.status === "string") {
    const s = t.status.toLowerCase();
    if (["completed", "complete", "finished", "done"].includes(s)) return true;
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

/** Get task priority level */
function getTaskPriority(task: ExtendedTaskItem): 'high' | 'medium' | 'low' | 'none' {
  // Check explicit priority fields
  if (task.priority) {
    const p = task.priority.toString().toLowerCase();
    if (['high', 'h', '1', 'p1'].includes(p)) return 'high';
    if (['medium', 'med', 'm', '2', 'p2'].includes(p)) return 'medium';
    if (['low', 'l', '3', 'p3'].includes(p)) return 'low';
  }
  
  // Check props for priority
  if (task.props?.priority) {
    const p = task.props.priority.toString().toLowerCase();
    if (['high', 'h', '1', 'p1'].includes(p)) return 'high';
    if (['medium', 'med', 'm', '2', 'p2'].includes(p)) return 'medium';
    if (['low', 'l', '3', 'p3'].includes(p)) return 'low';
  }
  
  // Check for priority in tags or text
  const text = (task.text || task.raw || "").toLowerCase();
  if (text.includes('#high') || text.includes('#priority')) return 'high';
  if (text.includes('#medium') || text.includes('#med')) return 'medium';
  if (text.includes('#low')) return 'low';
  
  return 'none';
}

/** Check if task is due on a specific date */
function isTaskDueOnDate(task: ExtendedTaskItem, targetDate: string): boolean {
  if (!task.due && !task.props?.due) return false;
  
  const dueDate = task.due || task.props?.due;
  const target = moment(targetDate).startOf('day');
  const due = moment(dueDate).startOf('day');
  
  return due.isSame(target);
}

/** Check if task starts on a specific date */
function isTaskStartingOnDate(task: ExtendedTaskItem, targetDate: string): boolean {
  if (!task.start && !task.props?.start) return false;
  
  const startDate = task.start || task.props?.start;
  const target = moment(targetDate).startOf('day');
  const start = moment(startDate).startOf('day');
  
  return start.isSame(target);
}

/** Get days until due */
function getDaysUntilDue(task: ExtendedTaskItem, testDate?: string): number {
  const today = testDate ? moment(testDate).startOf('day') : moment().startOf('day');
  
  if (task.due) {
    const dueDate = moment(task.due).startOf('day');
    return dueDate.diff(today, 'days');
  }
  
  if (task.props?.due) {
    const dueDate = moment(task.props.due).startOf('day');
    return dueDate.diff(today, 'days');
  }
  
  return 999; // No due date
}

export const VIEW_TYPE_PM_CALENDAR = "pm-calendar-view";

export class CalendarView extends ItemView {
  /** icon shown on the view tab */
  public icon = "calendar-days";
  /** Optional set of project file paths to display */
  private filterPaths?: Set<string>;
  /** Optional name of the portfolio that opened this calendar */
  private filterName?: string;
  /** The initial project paths passed in from Portfolio (null = no portfolio) */
  private originalPaths: string[] | null = null;
  /** Project filter dropdown state */
  private filterDropdownOpen = false;
  /** Optional assignees to filter by */
  private filterAssignees: string[] | null = null;
  private originalAssignees: string[] | null = null;
  /** Assignee filter dropdown state */
  private assigneeDropdownOpen = false;
  private currentDate: string = moment().format('YYYY-MM-DD');
  private collapsed = new Set<string>();
  private firstRender = true;
  private lastScrollTop = 0;

  private cache: ProjectCache;
  private settings: PmSettings;
  private container!: HTMLElement;
  private detachFn: (() => void) | null = null;

  private filterText = "";                 // live text in the quick-filter box
  private showEpics = true;                // show/hide epics
  private showStories = true;              // show/hide stories
  private showSubTasks = true;             // show/hide sub-tasks

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

  getViewType(): string {
    return VIEW_TYPE_PM_CALENDAR;
  }

  getDisplayText(): string {
    return this.filterName ? `Calendar: ${this.filterName}` : "Calendar";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen() {
    this.container = this.contentEl;
    this.render();
    this.detachFn = this.cache.onChange(() => {
      this.cleanupPopups();
      this.render();
    });
  }

  async onClose() {
    this.detachFn?.();
    
    // Clean up any open popups/dropdowns
    this.cleanupPopups();
  }

  /** Collect all tasks for the current view period */
  private collectTasksForPeriod(): ExtendedTaskItem[] {
    const allTasks: ExtendedTaskItem[] = [];
    
    this.cache.projects.forEach((project: ProjectEntry) => {
      // Skip if project is filtered out
      if (this.filterPaths && !this.filterPaths.has(project.file.path)) {
        return;
      }

      // Add project metadata to tasks
      (project.tasks ?? []).forEach((task: TaskItem) => {
        const extendedTask = task as ExtendedTaskItem;
        extendedTask.projectName = project.file.basename;
        extendedTask.projectPath = project.file.path;
        allTasks.push(extendedTask);
      });
    });
    
    // Filter to only incomplete tasks
    let incompleteTasks = allTasks.filter(task => !isTaskCompleted(task));
    
    // Apply assignee filter
    if (this.filterAssignees && this.filterAssignees.length > 0) {
      incompleteTasks = incompleteTasks.filter(task => {
        const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
        return this.filterAssignees!.includes(assignee);
      });
    }
    
    return incompleteTasks;
  }

  /** Generate calendar days for the current month */
  private generateCalendarDays(): CalendarDay[] {
    const days: CalendarDay[] = [];
    const current = moment(this.currentDate);
    const startOfMonth = current.clone().startOf('month');
    const endOfMonth = current.clone().endOf('month');
    const startOfCalendar = startOfMonth.clone().startOf('isoWeek');
    const endOfCalendar = endOfMonth.clone().endOf('isoWeek');
    
    const today = moment().startOf('day');
    
    let day = startOfCalendar.clone();
    while (day.isSameOrBefore(endOfCalendar)) {
      const dateStr = day.format('YYYY-MM-DD');
      const { dueTasks, startingTasks } = this.getTasksForDate(dateStr);
      
      days.push({
        date: dateStr,
        dueTasks: dueTasks,
        startingTasks: startingTasks,
        isToday: day.isSame(today),
        isCurrentMonth: day.isSame(current, 'month')
      });
      
      day.add(1, 'day');
    }
    
    return days;
  }

  /** Clean up any open popups/dropdowns */
  private cleanupPopups() {
    // Remove day expansion popups
    const expansions = document.querySelectorAll('.pm-day-expansion');
    expansions.forEach(expansion => expansion.remove());
    
    // Remove project and assignee filter dropdowns
    const dropdowns = document.querySelectorAll('.pm-proj-dd');
    dropdowns.forEach(dropdown => dropdown.remove());
    
    // Reset dropdown states
    this.filterDropdownOpen = false;
    this.assigneeDropdownOpen = false;
  }

  /** Update project filter & re-render */
  public updateFilter(paths: string[] | null) {
    if (paths === null) {
      // Show ALL projects
      this.filterPaths = undefined;
    } else if (Array.isArray(paths)) {
      // Show NONE if empty array, else selected set
      this.filterPaths = paths.length ? new Set(paths) : new Set<string>();
    }
    this.render();
  }

  /** Update assignee filter & re-render */
  public updateAssigneeFilter(assignees: string[] | null) {
    if (assignees === null) {
      // Show ALL assignees
      this.filterAssignees = null;
    } else if (Array.isArray(assignees)) {
      // Show NONE if empty array, else selected set
      this.filterAssignees = assignees.length ? assignees : [];
    }
    this.render();
  }



  /** Get tasks for a specific date */
  private getTasksForDate(dateStr: string): { dueTasks: ExtendedTaskItem[], startingTasks: ExtendedTaskItem[] } {
    const allTasks = this.collectTasksForPeriod();
    const dueTasks = allTasks.filter(task => isTaskDueOnDate(task, dateStr));
    const startingTasks = allTasks.filter(task => isTaskStartingOnDate(task, dateStr));
    
    return { dueTasks, startingTasks };
  }

  /** Render the calendar view */
  private render() {
    this.container.empty();
    
    // Create main calendar container with flex layout
    const calendarView = this.container.createEl("div", { cls: "pm-calendar-view" });
    
    // Save scroll position from content container if it exists
    const existingContent = this.container.querySelector('.pm-calendar-content');
    if (existingContent) {
      this.lastScrollTop = existingContent.scrollTop;
    }

    // Header with navigation and controls
    const header = calendarView.createEl("div", { cls: "pm-calendar-header" });
    
    // Navigation controls
    const navControls = header.createEl("div", { cls: "pm-calendar-nav" });
    
    // Previous month button
    const prevBtn = navControls.createEl("button", { cls: "pm-calendar-nav-btn" });
    setIcon(prevBtn, "chevron-left");
    prevBtn.onclick = () => {
      this.cleanupPopups();
      this.currentDate = moment(this.currentDate).subtract(1, 'month').format('YYYY-MM-DD');
      this.render();
    };

    // Current month display
    const periodDisplay = navControls.createEl("div", { cls: "pm-calendar-period" });
    periodDisplay.textContent = moment(this.currentDate).format('MMMM YYYY');

    // Next month button
    const nextBtn = navControls.createEl("button", { cls: "pm-calendar-nav-btn" });
    setIcon(nextBtn, "chevron-right");
    nextBtn.onclick = () => {
      this.cleanupPopups();
      this.currentDate = moment(this.currentDate).add(1, 'month').format('YYYY-MM-DD');
      this.render();
    };

    // Today button
    const todayBtn = navControls.createEl("button", { cls: "pm-calendar-today-btn" });
    todayBtn.textContent = "Today";
    todayBtn.onclick = () => {
      this.cleanupPopups();
      this.currentDate = moment().format('YYYY-MM-DD');
      this.render();
    };

    // Project filter button
    const projBtn = navControls.createEl("button", { cls: "pm-proj-btn" });
    projBtn.createSpan({ text: "Projects " });
    const caret = projBtn.createSpan();
    setIcon(caret, "chevron-down");

    // Dropdown state variables (like dashboard)
    let ddOpen = false;
    let ddEl: HTMLElement | null = null;
    let assigneeDdOpen = false;
    let assigneeDdEl: HTMLElement | null = null;

    const closeDropdown = () => {
      ddEl?.remove();
      ddEl = null;
      ddOpen = false;
      setIcon(caret, "chevron-down");
    };

    const closeAssigneeDropdown = () => {
      assigneeDdEl?.remove();
      assigneeDdEl = null;
      assigneeDdOpen = false;
      setIcon(assigneeCaret, "chevron-down");
    };

    const buildProjectDropdown = (projectList: any[]) => {
      ddEl = document.createElement("div");
      ddEl.className = "pm-proj-dd";

      /* Select/Deselect controls */
      const controls = ddEl.createEl("div", { cls: "pm-proj-dd-ctl" });

             /* ALL */
       controls.createEl("a", { text: "All" }).onclick = (e) => {
         e.preventDefault();
         this.updateFilter(null);
         /* Update checkboxes without closing dropdown */
         const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
         checkIcons.forEach(icon => {
           icon.setAttribute("data-checked", "true");
           setIcon(icon, "check-circle");
         });
       };

       /* PORTFOLIO (only if originalPaths present) */
       if (this.originalPaths && this.originalPaths.length) {
         controls.createSpan({ text: " | " });
         controls.createEl("a", { text: this.filterName ?? "Portfolio" }).onclick = (e) => {
           e.preventDefault();
           this.updateFilter([...this.originalPaths!]);
           /* Update checkboxes without closing dropdown */
           const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
           checkIcons.forEach(icon => {
             const projectPath = icon.getAttribute("data-project-path");
             const isChecked = this.originalPaths!.includes(projectPath!);
             icon.setAttribute("data-checked", isChecked.toString());
             setIcon(icon, isChecked ? "check-circle" : "circle");
           });
         };
       }

       /* NONE */
       controls.createSpan({ text: " | " });
       controls.createEl("a", { text: "None" }).onclick = (e) => {
         e.preventDefault();
         this.updateFilter([]);
         /* Update checkboxes without closing dropdown */
         const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
         checkIcons.forEach(icon => {
           icon.setAttribute("data-checked", "false");
           setIcon(icon, "circle");
         });
       };

       // Checkbox list
       projectList.forEach((p: any) => {
         const wrap = ddEl!.createEl("div", { cls: "pm-proj-dd-item" });
         const cb = wrap.createEl("span", { cls: "pm-dd-check" });
         wrap.createSpan({ text: ` ${p.file.basename}` });

         const isChecked = !this.filterPaths || this.filterPaths.has(p.file.path);
         setIcon(cb, isChecked ? "check-circle" : "circle");
         
         cb.setAttribute("data-project-path", p.file.path);
         cb.setAttribute("data-checked", isChecked.toString());
         wrap.onclick = () => {
           const currentChecked = cb.getAttribute("data-checked") === "true";
           const newChecked = !currentChecked;
           
           cb.setAttribute("data-checked", newChecked.toString());
           setIcon(cb, newChecked ? "check-circle" : "circle");
           
           const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check"));
           const selected = checkIcons
             .filter(icon => icon.getAttribute("data-checked") === "true")
             .map(icon => icon.getAttribute("data-project-path")!);

           const newFilter = selected.length === projectList.length ? null : selected;
           this.updateFilter(newFilter);
         };
       });

      document.body.appendChild(ddEl);
      
      // Position dropdown
      const r = projBtn.getBoundingClientRect();
      const pad = 4;
      let left = r.left;
      let top = r.bottom + pad;

      const ddW = ddEl.offsetWidth || 240;
      const ddH = ddEl.offsetHeight || 260;

      if (left + ddW > window.innerWidth - pad) {
        left = Math.max(window.innerWidth - ddW - pad, pad);
      }
      if (left < pad) {
        left = pad;
      }

      if (top + ddH > window.innerHeight - pad) {
        top = Math.max(r.top - ddH - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }

      ddEl.style.left = `${left}px`;
      ddEl.style.top = `${top}px`;


    };

    const buildAssigneeDropdown = (assigneeList: string[]) => {
      assigneeDdEl = document.createElement("div");
      assigneeDdEl.className = "pm-proj-dd";

      /* Select/Deselect controls */
      const controls = assigneeDdEl.createEl("div", { cls: "pm-proj-dd-ctl" });

             /* ALL */
       controls.createEl("a", { text: "All" }).onclick = (e) => {
         e.preventDefault();
         this.updateAssigneeFilter(null);
         /* Update checkboxes without closing dropdown */
         const checkIcons = Array.from(assigneeDdEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
         checkIcons.forEach(icon => {
           icon.setAttribute("data-checked", "true");
           setIcon(icon, "check-circle");
         });
       };

       // Ensure we have an initial baseline like projects' originalPaths,
       // so the middle option is available immediately.
       if (!this.originalAssignees) {
         if (!this.filterAssignees) {
           // No filter applied ⇒ baseline is all assignees
           this.originalAssignees = [...assigneeList];
         } else if (this.filterAssignees.length > 0) {
           // Baseline is the currently selected set
           this.originalAssignees = [...this.filterAssignees];
         } else {
           // Explicit none selected
           this.originalAssignees = [];
         }
       }

       /* ASSIGNEES (only if originalAssignees present) */
       if (this.originalAssignees && this.originalAssignees.length >= 0) {
         controls.createSpan({ text: " | " });
         controls.createEl("a", { text: this.filterName ?? "Portfolio" }).onclick = (e) => {
           e.preventDefault();
           this.updateAssigneeFilter([...this.originalAssignees!]);
           /* Update checkboxes without closing dropdown */
           const checkIcons = Array.from(assigneeDdEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
           checkIcons.forEach(icon => {
             const assignee = icon.getAttribute("data-assignee");
             const isChecked = this.originalAssignees!.includes(assignee!);
             icon.setAttribute("data-checked", isChecked.toString());
             setIcon(icon, isChecked ? "check-circle" : "circle");
           });
         };
       }

       /* NONE */
       controls.createSpan({ text: " | " });
       controls.createEl("a", { text: "None" }).onclick = (e) => {
         e.preventDefault();
         this.updateAssigneeFilter([]);
         /* Update checkboxes without closing dropdown */
         const checkIcons = Array.from(assigneeDdEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
         checkIcons.forEach(icon => {
           icon.setAttribute("data-checked", "false");
           setIcon(icon, "circle");
         });
       };

       // If no assignees found, show a message
       if (assigneeList.length === 0) {
         const noAssignees = assigneeDdEl!.createEl("div", { cls: "pm-proj-dd-item" });
         noAssignees.createSpan({ text: "No assignees found" });
         noAssignees.style.fontStyle = "italic";
         noAssignees.style.color = "var(--text-muted)";
       } else {
         // Checkbox list
         assigneeList.forEach((assignee: string) => {
           const wrap = assigneeDdEl!.createEl("div", { cls: "pm-proj-dd-item" });
           const cb = wrap.createEl("span", { cls: "pm-dd-check" });
           wrap.createSpan({ text: ` ${assignee}` });

           const isChecked = !this.filterAssignees || this.filterAssignees.includes(assignee);
           setIcon(cb, isChecked ? "check-circle" : "circle");
           
           cb.setAttribute("data-assignee", assignee);
           cb.setAttribute("data-checked", isChecked.toString());
           wrap.onclick = () => {
             const currentChecked = cb.getAttribute("data-checked") === "true";
             const newChecked = !currentChecked;
             
             cb.setAttribute("data-checked", newChecked.toString());
             setIcon(cb, newChecked ? "check-circle" : "circle");
             
             const checkIcons = Array.from(assigneeDdEl!.querySelectorAll(".pm-dd-check"));
             const selected = checkIcons
               .filter(icon => icon.getAttribute("data-checked") === "true")
               .map(icon => icon.getAttribute("data-assignee")!);

             const newFilter = selected.length === assigneeList.length ? null : selected;
             this.updateAssigneeFilter(newFilter);
           };
         });
       }

      document.body.appendChild(assigneeDdEl);
      
      // Position dropdown
      const r = assigneeBtn.getBoundingClientRect();
      const pad = 4;
      let left = r.left;
      let top = r.bottom + pad;

      const ddW = assigneeDdEl.offsetWidth || 240;
      const ddH = assigneeDdEl.offsetHeight || 260;

      if (left + ddW > window.innerWidth - pad) {
        left = Math.max(window.innerWidth - ddW - pad, pad);
      }
      if (left < pad) {
        left = pad;
      }

      if (top + ddH > window.innerHeight - pad) {
        top = Math.max(r.top - ddH - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }

      assigneeDdEl.style.left = `${left}px`;
      assigneeDdEl.style.top = `${top}px`;

    };

    projBtn.onclick = () => {
      if (ddOpen) {
        closeDropdown();
        return;
      }
      ddOpen = true;
      setIcon(caret, "chevron-up");
      
      // Build project list
      const projectList = Array.from(this.cache.projects.values()).sort((a, b) => 
        a.file.basename.localeCompare(b.file.basename)
      );
      
      buildProjectDropdown(projectList);
      
      // Close on outside click
      const onDoc = (e: MouseEvent) => {
        if (ddEl && !ddEl.contains(e.target as Node) && e.target !== projBtn) {
          closeDropdown();
          document.removeEventListener("mousedown", onDoc);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", onDoc));
    };

    // Assignee filter button
    const assigneeBtn = navControls.createEl("button", { cls: "pm-proj-btn" });
    assigneeBtn.createSpan({ text: "Assignees " });
    const assigneeCaret = assigneeBtn.createSpan();
    setIcon(assigneeCaret, "chevron-down");

    assigneeBtn.onclick = () => {
      if (assigneeDdOpen) {
        closeAssigneeDropdown();
        return;
      }
      assigneeDdOpen = true;
      setIcon(assigneeCaret, "chevron-up");
      
      // Build assignee list from ALL projects (not just filtered ones)
      const assigneeSet = new Set<string>();
      this.cache.projects.forEach(project => {
        // Don't apply project filter when building assignee list
        if (project.tasks) {
          project.tasks.forEach(task => {
            const extTask = task as ExtendedTaskItem;
            const assignee = (extTask.assignee ?? extTask.props?.assignee ?? extTask.owner ?? extTask.props?.owner ?? "Unassigned").toString().trim();
            assigneeSet.add(assignee);
          });
        }
      });
      const assigneeList = Array.from(assigneeSet).sort();
      
      buildAssigneeDropdown(assigneeList);
      
      // Close on outside click
      const onDoc = (e: MouseEvent) => {
        if (assigneeDdEl && !assigneeDdEl.contains(e.target as Node) && e.target !== assigneeBtn) {
          closeAssigneeDropdown();
          document.removeEventListener("mousedown", onDoc);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", onDoc));
    };

    // Calendar content container (scrollable)
    const calendarContent = calendarView.createEl("div", { cls: "pm-calendar-content" });
    
    // Calendar grid
    const calendarGrid = calendarContent.createEl("div", { cls: "pm-calendar-grid" });
    this.renderMonthView(calendarGrid);

    // Restore scroll position
    if (this.lastScrollTop > 0) {
      setTimeout(() => {
        calendarContent.scrollTop = this.lastScrollTop;
      }, 0);
    }
  }

  /** Render month view */
  private renderMonthView(container: HTMLElement) {
    // Day headers
    const dayHeaders = container.createEl("div", { cls: "pm-calendar-day-headers" });
    
    // Week number header
    const weekHeader = dayHeaders.createEl("div", { cls: "pm-calendar-week-header" });
    weekHeader.textContent = "W";
    
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    dayNames.forEach(dayName => {
      const header = dayHeaders.createEl("div", { cls: "pm-calendar-day-header" });
      header.textContent = dayName;
    });

    // Calendar days with week numbers
    const daysGrid = container.createEl("div", { cls: "pm-calendar-days-grid" });
    const days = this.generateCalendarDays();
    
    // Group days by week
    const weeks: CalendarDay[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    
    weeks.forEach(week => {
      // Add week number cell
      const weekNumber = daysGrid.createEl("div", { cls: "pm-calendar-week-number" });
      const mondayOfWeek = week[0]; // First day is Monday
      const weekNum = moment(mondayOfWeek.date).isoWeek();
      weekNumber.textContent = weekNum.toString();
      weekNumber.title = `ISO Week ${weekNum}`;
      
      // Add day cells for this week
      week.forEach(day => {
        this.renderDayCell(daysGrid, day);
      });
    });
  }



  /** Render a single day cell */
  private renderDayCell(container: HTMLElement, day: CalendarDay) {
    const totalTasks = day.dueTasks.length + day.startingTasks.length;
    
    // Create a wrapper div for the day cell and preview
    const dayWrapper = container.createEl("div", { cls: "pm-calendar-day-wrapper" });
    
    const dayCell = dayWrapper.createEl("div", { 
      cls: `pm-calendar-day ${day.isToday ? 'pm-calendar-day-today' : ''} ${!day.isCurrentMonth ? 'pm-calendar-day-other-month' : ''} ${totalTasks > 0 ? 'pm-calendar-day-has-tasks' : ''}`
    });
    
    // Day number
    const dayNumber = dayCell.createEl("div", { cls: "pm-calendar-day-number" });
    dayNumber.textContent = moment(day.date).format('D');
    
    // Task count with color coding
    if (totalTasks > 0) {
      const taskCount = dayCell.createEl("div", { cls: "pm-calendar-task-count" });
      taskCount.textContent = totalTasks.toString();
      
      // Add color coding based on task count
      if (totalTasks >= 10) {
        taskCount.classList.add("pm-task-count-high");
      } else if (totalTasks >= 5) {
        taskCount.classList.add("pm-task-count-medium");
      } else {
        taskCount.classList.add("pm-task-count-low");
      }
    }
    
    // Task indicators (due tasks and starting tasks)
    if (totalTasks > 0) {
      const taskIndicators = dayCell.createEl("div", { cls: "pm-calendar-task-indicators" });
      
      // Due tasks indicator
      if (day.dueTasks.length > 0) {
        const dueIndicator = taskIndicators.createEl("div", { cls: "pm-calendar-due-indicator" });
        dueIndicator.textContent = `${day.dueTasks.length} due`;
        dueIndicator.title = `${day.dueTasks.length} task${day.dueTasks.length === 1 ? '' : 's'} due`;
      }
      
      // Starting tasks indicator
      if (day.startingTasks.length > 0) {
        const startIndicator = taskIndicators.createEl("div", { cls: "pm-calendar-start-indicator" });
        startIndicator.textContent = `${day.startingTasks.length} start`;
        startIndicator.title = `${day.startingTasks.length} task${day.startingTasks.length === 1 ? '' : 's'} starting`;
      }
    }
    
    // Click handler for day expansion
    dayCell.onclick = () => {
      // Close any existing day expansions before opening new one
      const existingExpansions = document.querySelectorAll('.pm-day-expansion');
      existingExpansions.forEach(expansion => expansion.remove());
      
      this.showDayExpansion(dayCell, day);
    };
    
    // Remove hover handlers - no hover preview needed
  }

  /** Show day expansion with task details */
  private showDayExpansion(dayCell: HTMLElement, day: CalendarDay) {
    // Remove existing expansion
    const existingExpansion = this.container.querySelector('.pm-day-expansion');
    if (existingExpansion) {
      existingExpansion.remove();
    }
    
    const expansion = document.createElement('div');
    expansion.className = 'pm-day-expansion';
    
    const header = expansion.createEl('div', { cls: 'pm-day-expansion-header' });
    header.textContent = moment(day.date).format('dddd, MMMM D, YYYY');
    
    const closeBtn = header.createEl('button', { cls: 'pm-day-expansion-close' });
    setIcon(closeBtn, 'x');
    closeBtn.onclick = () => expansion.remove();
    
    const totalTasks = day.dueTasks.length + day.startingTasks.length;
    if (totalTasks === 0) {
      const emptyMsg = expansion.createEl('div', { cls: 'pm-day-expansion-empty' });
      emptyMsg.textContent = 'No tasks on this day';
    } else {
      const taskList = expansion.createEl('div', { cls: 'pm-day-expansion-tasks' });
      
      // Due Tasks Section
      if (day.dueTasks.length > 0) {
        const dueSection = taskList.createEl('div', { cls: 'pm-task-section pm-task-section-due' });
        dueSection.createEl('h3', { text: `📅 Tasks Due (${day.dueTasks.length})` });
        
        // Group due tasks by priority
        const dueTasks = day.dueTasks;
        const highDue = dueTasks.filter(t => getTaskPriority(t) === 'high');
        const medDue = dueTasks.filter(t => getTaskPriority(t) === 'medium');
        const lowDue = dueTasks.filter(t => getTaskPriority(t) === 'low');
        const noneDue = dueTasks.filter(t => getTaskPriority(t) === 'none');
        
        if (highDue.length > 0) {
          const highSection = dueSection.createEl('div', { cls: 'pm-task-subsection' });
          highSection.createEl('h4', { text: '🔴 High Priority' });
          highDue.forEach(task => this.renderTaskItem(highSection, task, 'due'));
        }
        if (medDue.length > 0) {
          const medSection = dueSection.createEl('div', { cls: 'pm-task-subsection' });
          medSection.createEl('h4', { text: '🟡 Medium Priority' });
          medDue.forEach(task => this.renderTaskItem(medSection, task, 'due'));
        }
        if (lowDue.length > 0) {
          const lowSection = dueSection.createEl('div', { cls: 'pm-task-subsection' });
          lowSection.createEl('h4', { text: '🟢 Low Priority' });
          lowDue.forEach(task => this.renderTaskItem(lowSection, task, 'due'));
        }
        if (noneDue.length > 0) {
          const noneSection = dueSection.createEl('div', { cls: 'pm-task-subsection' });
          noneSection.createEl('h4', { text: '⚪ No Priority' });
          noneDue.forEach(task => this.renderTaskItem(noneSection, task, 'due'));
        }
      }
      
      // Starting Tasks Section
      if (day.startingTasks.length > 0) {
        const startSection = taskList.createEl('div', { cls: 'pm-task-section pm-task-section-start' });
        startSection.createEl('h3', { text: `🚀 Tasks Starting (${day.startingTasks.length})` });
        
        // Group starting tasks by priority
        const startTasks = day.startingTasks;
        const highStart = startTasks.filter(t => getTaskPriority(t) === 'high');
        const medStart = startTasks.filter(t => getTaskPriority(t) === 'medium');
        const lowStart = startTasks.filter(t => getTaskPriority(t) === 'low');
        const noneStart = startTasks.filter(t => getTaskPriority(t) === 'none');
        
        if (highStart.length > 0) {
          const highSection = startSection.createEl('div', { cls: 'pm-task-subsection' });
          highSection.createEl('h4', { text: '🔴 High Priority' });
          highStart.forEach(task => this.renderTaskItem(highSection, task, 'start'));
        }
        if (medStart.length > 0) {
          const medSection = startSection.createEl('div', { cls: 'pm-task-subsection' });
          medSection.createEl('h4', { text: '🟡 Medium Priority' });
          medStart.forEach(task => this.renderTaskItem(medSection, task, 'start'));
        }
        if (lowStart.length > 0) {
          const lowSection = startSection.createEl('div', { cls: 'pm-task-subsection' });
          lowSection.createEl('h4', { text: '🟢 Low Priority' });
          lowStart.forEach(task => this.renderTaskItem(lowSection, task, 'start'));
        }
        if (noneStart.length > 0) {
          const noneSection = startSection.createEl('div', { cls: 'pm-task-subsection' });
          noneSection.createEl('h4', { text: '⚪ No Priority' });
          noneStart.forEach(task => this.renderTaskItem(noneSection, task, 'start'));
        }
      }
    }
    
    // Position expansion near the day cell with viewport awareness
    const rect = dayCell.getBoundingClientRect();
    expansion.style.position = 'absolute';
    expansion.style.zIndex = '99999';
    
    // First, add to DOM to measure its size
    document.body.appendChild(expansion);
    const expansionRect = expansion.getBoundingClientRect();
    
    // Calculate optimal position
    let left = rect.left;
    let top = rect.bottom + 5;
    
    // Check if expansion would go off the right edge
    if (left + expansionRect.width > window.innerWidth - 20) {
      left = Math.max(20, window.innerWidth - expansionRect.width - 20);
    }
    
    // Check if expansion would go off the bottom edge
    if (top + expansionRect.height > window.innerHeight - 20) {
      // Position above the day cell instead
      top = Math.max(20, rect.top - expansionRect.height - 5);
    }
    
    // Check if expansion would go off the left edge
    if (left < 20) {
      left = 20;
    }
    
    // Check if expansion would go off the top edge (when positioned above)
    if (top < 20) {
      // Position below again but adjust top position
      top = Math.max(20, window.innerHeight - expansionRect.height - 20);
    }
    
    expansion.style.left = `${left}px`;
    expansion.style.top = `${top}px`;
  }



  /** Render a single task item in the expansion */
  private renderTaskItem(container: HTMLElement, task: ExtendedTaskItem, type: 'due' | 'start') {
    const taskItem = container.createEl('div', { cls: `pm-task-item pm-task-item-${type}` });
    
    const taskText = taskItem.createEl('div', { cls: 'pm-task-text' });
    taskText.textContent = task.text || 'Untitled Task';
    
    const taskMeta = taskItem.createEl('div', { cls: 'pm-task-meta' });
    
    if (task.projectName) {
      const projectSpan = taskMeta.createEl('span', { cls: 'pm-task-project' });
      projectSpan.textContent = task.projectName;
    }
    
    if (task.assignee) {
      const assigneeSpan = taskMeta.createEl('span', { cls: 'pm-task-assignee' });
      assigneeSpan.textContent = `👤 ${task.assignee}`;
    }
    
    // Show the relevant date
    const dateSpan = taskMeta.createEl('span', { cls: 'pm-task-date' });
    if (type === 'due' && task.due) {
      dateSpan.textContent = `📅 Due: ${moment(task.due).format('MMM D')}`;
    } else if (type === 'start' && task.start) {
      dateSpan.textContent = `🚀 Start: ${moment(task.start).format('MMM D')}`;
    }
  }
}
