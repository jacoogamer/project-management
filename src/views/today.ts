import {
  ItemView,
  WorkspaceLeaf,
  setIcon,
  Notice,
} from "obsidian";
import { TFile } from "obsidian";
/* Moment.js is available globally in Obsidian */
declare const moment: any;
import { ProjectCache, TaskItem, ProjectEntry } from "../services/cache";
import { PmSettings } from "../../settings";

// Extended task interface for today view functions
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

// Load today-specific stylesheet
import "../../styles/styles-today.css";

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

/** Check if task is due today or overdue */
function isTaskDueToday(task: ExtendedTaskItem, testDate?: string): boolean {
  // Use test date if provided, otherwise use current date
  const today = testDate ? moment(testDate).startOf('day') : moment().startOf('day');
  
  // Check due date
  if (task.due) {
    const dueDate = moment(task.due).startOf('day');
    return dueDate.isSameOrBefore(today);
  }
  
  // Check due date in props
  if (task.props?.due) {
    const dueDate = moment(task.props.due).startOf('day');
    return dueDate.isSameOrBefore(today);
  }
  
  return false;
}

/** Check if task should be started (start date is today or in the past) */
function shouldTaskBeStarted(task: ExtendedTaskItem, testDate?: string): boolean {
  // Use test date if provided, otherwise use current date
  const today = testDate ? moment(testDate).startOf('day') : moment().startOf('day');
  
  // Check start date
  if (task.start) {
    const startDate = moment(task.start).startOf('day');
    return startDate.isSameOrBefore(today);
  }
  
  // Check start date in props
  if (task.props?.start) {
    const startDate = moment(task.props.start).startOf('day');
    return startDate.isSameOrBefore(today);
  }
  
  return false;
}

/** Get days until start (negative if start date has passed) */
function getDaysUntilStart(task: ExtendedTaskItem, testDate?: string): number {
  // Use test date if provided, otherwise use current date
  const today = testDate ? moment(testDate).startOf('day') : moment().startOf('day');
  
  // Check start date
  if (task.start) {
    const startDate = moment(task.start).startOf('day');
    return startDate.diff(today, 'days');
  }
  
  // Check start date in props
  if (task.props?.start) {
    const startDate = moment(task.props.start).startOf('day');
    return startDate.diff(today, 'days');
  }
  
  return 999; // No start date
}

/** Check if task is overdue */
function isTaskOverdue(task: ExtendedTaskItem, testDate?: string): boolean {
  // Use test date if provided, otherwise use current date
  const today = testDate ? moment(testDate).startOf('day') : moment().startOf('day');
  
  // Check due date
  if (task.due) {
    const dueDate = moment(task.due).startOf('day');
    return dueDate.isBefore(today);
  }
  
  // Check due date in props
  if (task.props?.due) {
    const dueDate = moment(task.props.due).startOf('day');
    return dueDate.isBefore(today);
  }
  
  return false;
}

/** Get days until due (negative if overdue) */
function getDaysUntilDue(task: ExtendedTaskItem, testDate?: string): number {
  // Use test date if provided, otherwise use current date
  const today = testDate ? moment(testDate).startOf('day') : moment().startOf('day');
  
  // Check due date
  if (task.due) {
    const dueDate = moment(task.due).startOf('day');
    return dueDate.diff(today, 'days');
  }
  
  // Check due date in props
  if (task.props?.due) {
    const dueDate = moment(task.props.due).startOf('day');
    return dueDate.diff(today, 'days');
  }
  
  return 999; // No due date
}

export const VIEW_TYPE_PM_TODAY = "pm-today-view";

export class TodayView extends ItemView {
  private cache: ProjectCache;
  private settings: PmSettings;
  private container!: HTMLElement;
  private detachFn: (() => void) | null = null;
  private showSubtasksOnly: boolean = true;
  private showCompleted: boolean = false;
  private showOverdueOnly: boolean = false;
  private lastScrollTop: number = 0;
  private collapsedSections: Set<string> = new Set();
  private selectedDate: string = moment().format('YYYY-MM-DD'); // Use current date as default
  /** Optional set of project file paths to display */
  private filterPaths?: Set<string>;

  constructor(
    leaf: WorkspaceLeaf,
    cache: ProjectCache,
    settings: PmSettings
  ) {
    super(leaf);
    this.cache = cache;
    this.settings = settings;
  }

  getViewType(): string {
    return VIEW_TYPE_PM_TODAY;
  }

  getDisplayText(): string {
    return "Today";
  }

  getIcon(): string {
    return "calendar";
  }

  async onOpen() {
    this.container = this.contentEl;
    this.render();
    this.detachFn = this.cache.onChange(() => this.render());
  }

  async onClose() {
    this.detachFn?.();
  }

  /** Collect all tasks with intelligent recommendations */
  private collectTodayTasks(): ExtendedTaskItem[] {
    const allTasks: ExtendedTaskItem[] = [];
    
    this.cache.projects.forEach((project: ProjectEntry) => {
      // Add project metadata to tasks
      (project.tasks ?? []).forEach((task: TaskItem) => {
        const extendedTask = task as ExtendedTaskItem;
        extendedTask.projectName = project.file.basename;
        extendedTask.projectPath = project.file.path;
        allTasks.push(extendedTask);
      });
    });
    
    // Filter to only incomplete tasks
    const incompleteTasks = allTasks.filter(task => !isTaskCompleted(task));
    
    // Sort by intelligent priority scoring
    const sortedTasks = incompleteTasks.sort((a, b) => {
      const aScore = this.calculateTaskScore(a);
      const bScore = this.calculateTaskScore(b);
      return bScore - aScore; // Higher score first
    });
    
    return sortedTasks;
  }

  /** Calculate intelligent priority score for a task */
  private calculateTaskScore(task: ExtendedTaskItem): number {
    let score = 0;
    
    // Priority multiplier
    const priorityMultiplier = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0.5 };
    const priority = getTaskPriority(task);
    score += priorityMultiplier[priority] * 100;
    
    // Due date urgency
    const daysUntilDue = getDaysUntilDue(task);
    if (daysUntilDue < 0) {
      // Overdue tasks get high score
      score += Math.abs(daysUntilDue) * 50 + 200;
    } else if (daysUntilDue === 0) {
      // Due today
      score += 150;
    } else if (daysUntilDue <= 2) {
      // Due in next 2 days
      score += 100;
    } else if (daysUntilDue <= 5) {
      // Due this week
      score += 50;
    } else if (daysUntilDue <= 14) {
      // Due in next 2 weeks
      score += 25;
    }
    
    // Status-based scoring
    if (task.status) {
      const status = task.status.toLowerCase();
      if (status === 'in-progress' || status === 'doing') {
        score += 75; // Active tasks get bonus
      } else if (status === 'review' || status === 'testing') {
        score += 50; // Review tasks get bonus
      } else if (status === 'blocked' || status === 'on-hold') {
        score -= 25; // Blocked tasks get penalty
      }
    }
    
    // Task type scoring
    const taskType = this.getTaskType(task);
    if (taskType === 'epic') {
      score += 30; // Epics are important
    } else if (taskType === 'story') {
      score += 20; // Stories are important
    }
    
    // Assignee scoring (if assigned to current user or unassigned)
    const assignee = task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner;
    if (!assignee || assignee === 'Unassigned') {
      score += 15; // Unassigned tasks need attention
    }
    
    return score;
  }

  /** Get task type for categorization */
  private getTaskType(task: ExtendedTaskItem): 'epic' | 'story' | 'subtask' | 'other' {
    const id = (task.id ?? "").toUpperCase();
    if (id.startsWith("E")) return 'epic';
    if (id.startsWith("S") && !id.startsWith("SB")) return 'story';
    if (id.startsWith("SB")) return 'subtask';
    return 'other';
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

  /** Get task status for color coding */
  private getTaskStatus(task: ExtendedTaskItem): 'not-started' | 'in-progress' | 'completed' | 'on-hold' {
    // Check if task is completed
    if (isTaskCompleted(task)) {
      return 'completed';
    }
    
    // Check explicit status field
    if (task.status) {
      const status = task.status.toLowerCase();
      if (['on-hold', 'on hold', 'blocked', 'paused', 'waiting', 'hold'].includes(status)) {
        return 'on-hold';
      }
      if (['in-progress', 'doing', 'active', 'started', 'working'].includes(status)) {
        return 'in-progress';
      }
      if (['not-started', 'todo', 'pending', 'new', 'open'].includes(status)) {
        return 'not-started';
      }
    }
    
    // Check props for status
    if (task.props?.status) {
      const status = task.props.status.toLowerCase();
      if (['on-hold', 'on hold', 'blocked', 'paused', 'waiting', 'hold'].includes(status)) {
        return 'on-hold';
      }
      if (['in-progress', 'doing', 'active', 'started', 'working'].includes(status)) {
        return 'in-progress';
      }
      if (['not-started', 'todo', 'pending', 'new', 'open'].includes(status)) {
        return 'not-started';
      }
    }
    
    // Default to not-started if no explicit status
    return 'not-started';
  }

  private render() {
    // Save current scroll position
    this.lastScrollTop = this.container.scrollTop || 0;
    
    this.container.empty();
    this.container.addClass("pm-today-view");

    /* ── Header ───────────────────────── */
    const header = this.container.createEl("div", { cls: "pm-today-header" });
    const title = header.createEl("h2", { text: "All Projects & Assignees" });
    const subtitle = header.createEl("div", { 
      cls: "pm-today-subtitle",
      text: "Tasks due or starting from 2 weeks ago to 2 weeks ahead, plus tasks without dates"
    });
    
    // Date row with formatted date and date picker
    const dateRow = header.createEl("div", { cls: "pm-today-date-row" });
    const date = dateRow.createEl("div", { 
      cls: "pm-today-date",
      text: moment(this.selectedDate).format('dddd, MMMM Do YYYY')
    });
    
    const datePicker = dateRow.createEl("input", { 
      cls: "pm-today-date-picker",
      type: "date"
    }) as HTMLInputElement;
    datePicker.value = this.selectedDate;
    
    // Add date picker change handler
    datePicker.onchange = () => {
      this.selectedDate = datePicker.value;
      this.render();
    };
    
    // Filter controls
    const filterControls = header.createEl("div", { cls: "pm-today-filters" });
    
    // Projects dropdown
    const projBtn = filterControls.createEl("button", { cls: "pm-today-filter-btn pm-proj-btn" });
    projBtn.createSpan({ text: "Projects " });
    const caret = projBtn.createSpan();
    setIcon(caret, "chevron-down");

    let ddOpen = false;
    let ddEl: HTMLElement | null = null;

    const buildDropdown = (projectList: ProjectEntry[]) => {
      ddEl = document.createElement("div");
      ddEl.className = "pm-proj-dd";

      // Select/Deselect controls
      const controls = ddEl.createEl("div", { cls: "pm-proj-dd-ctl" });
      
      // ALL
      controls.createEl("a", { text: "All" }).onclick = (e) => {
        e.preventDefault();
        this.updateFilter(null);
        const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
        checkIcons.forEach(icon => {
          icon.setAttribute("data-checked", "true");
          setIcon(icon, "check-circle");
        });
      };

      // NONE
      controls.createSpan({ text: " | " });
      controls.createEl("a", { text: "None" }).onclick = (e) => {
        e.preventDefault();
        this.updateFilter([]);
        const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
        checkIcons.forEach(icon => {
          icon.setAttribute("data-checked", "false");
          setIcon(icon, "circle");
        });
      };

      // Checkbox list
      projectList.forEach((p: ProjectEntry) => {
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
        const above = r.top - ddH - pad;
        top = above >= pad ? above : Math.max(window.innerHeight - ddH - pad, pad);
      }
      if (top < pad) {
        top = pad;
      }

      ddEl.style.left = `${left}px`;
      ddEl.style.top = `${top}px`;
      ddEl.classList.add("pm-dropdown-positioned");
    };

    const closeDropdown = () => {
      ddEl?.remove();
      ddEl = null;
      ddOpen = false;
      setIcon(caret, "chevron-down");
    };

    projBtn.onclick = () => {
      if (ddOpen) {
        closeDropdown();
        return;
      }
      ddOpen = true;
      setIcon(caret, "chevron-up");

      const projectList = Array.from(this.cache.projects.values())
        .sort((a, b) => a.file.basename.localeCompare(b.file.basename));
      buildDropdown(projectList);

      const onDoc = (e: MouseEvent) => {
        if (ddEl && !ddEl.contains(e.target as Node) && e.target !== projBtn) {
          closeDropdown();
          document.removeEventListener("mousedown", onDoc);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", onDoc));
    };
    
    const subtaskToggle = filterControls.createEl("button", { 
      cls: `pm-today-filter-btn ${this.showSubtasksOnly ? 'active' : ''}`,
      text: this.showSubtasksOnly ? "Show Epics and Stories" : "Show Subtasks Only"
    });
    
    const completedToggle = filterControls.createEl("button", { 
      cls: `pm-today-filter-btn ${this.showCompleted ? 'active' : ''}`,
      text: this.showCompleted ? "Hide Completed" : "Show Completed"
    });
    
    const overdueToggle = filterControls.createEl("button", { 
      cls: `pm-today-filter-btn ${this.showOverdueOnly ? 'active' : ''}`,
      text: this.showOverdueOnly ? "Show All" : "Show Overdue"
    });
    
    subtaskToggle.onclick = () => {
      this.showSubtasksOnly = !this.showSubtasksOnly;
      this.render();
    };
    
    completedToggle.onclick = () => {
      this.showCompleted = !this.showCompleted;
      this.render();
    };
    
    overdueToggle.onclick = () => {
      this.showOverdueOnly = !this.showOverdueOnly;
      this.render();
    };

    /* ── Collect tasks within 2-week window from all projects ───────────────────────── */
    const allTasks: any[] = [];

    
    let projectIndex = 0;
    this.cache.projects.forEach((project: any, projectKey: string) => {
      projectIndex++;

      // Apply project filter
      if (this.filterPaths && !this.filterPaths.has(project.file.path)) {
        return;
      }
      
      (project.tasks ?? []).forEach((task: any, taskIndex: number) => {
        const isCompleted = isTaskCompleted(task);
        
        // Skip completed tasks unless we're showing them
        if (isCompleted && !this.showCompleted) {

          return;
        }
        
        // Skip non-overdue tasks if we're only showing overdue
        if (this.showOverdueOnly) {
          const daysUntilDue = getDaysUntilDue(task, this.selectedDate);
          const daysUntilStart = getDaysUntilStart(task, this.selectedDate);
          const isCompleted = isTaskCompleted(task);
          
          // Include tasks that are:
          // 1. Past due date (daysUntilDue < 0), OR
          // 2. Past start date but not started (daysUntilStart < 0 and not completed)
          const isOverdue = daysUntilDue < 0;
          const shouldHaveStarted = daysUntilStart < 0 && !isCompleted;
          
          if (!isOverdue && !shouldHaveStarted) {
            return;
          }
        }
        
        // Check if this is a subtask
        const taskType = this.getTaskType(task);
        const isSubtask = taskType === 'subtask';
        
        // Skip if we're filtering for subtasks only and this isn't a subtask
        if (this.showSubtasksOnly && !isSubtask) {

          return;
        }
        
        const daysUntilDue = getDaysUntilDue(task, this.selectedDate);
        const daysUntilStart = getDaysUntilStart(task, this.selectedDate);
        
        // In overdue mode, include ALL overdue tasks regardless of 2-week window
        if (this.showOverdueOnly) {
          // Already filtered for overdue above, so include all overdue tasks
          task.projectName = project.file.basename;
          task.projectPath = project.file.path;
          allTasks.push(task);

        } else {
          // Normal mode: Include tasks that are:
          // 1. Due within 2 weeks ago to 2 weeks in the future, OR
          // 2. Should be started within 2 weeks ago to 2 weeks in the future, OR
          // 3. Have no due date AND no start date
          const isDueInWindow = daysUntilDue >= -14 && daysUntilDue <= 14;
          const isStartInWindow = daysUntilStart >= -14 && daysUntilStart <= 14;
          const hasNoDates = daysUntilDue === 999 && daysUntilStart === 999;
          
          if (isDueInWindow || isStartInWindow || hasNoDates) {
            task.projectName = project.file.basename;
            task.projectPath = project.file.path;
            allTasks.push(task);

          }
        }
      });
    });
    

    
    if (allTasks.length === 0) {
      this.container.createEl("div", {
        cls: "pm-today-empty",
        text: "🎉 No tasks to work on today! All caught up."
      });
      return;
    }

    /* ── Task sections ───────────────────────── */
    const sections = this.container.createEl("div", { cls: "pm-today-sections" });

    // Group tasks by assignee
    const assigneeGroups = new Map<string, any[]>();
    
    allTasks.forEach(task => {
      const assignee = task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned";
      if (!assigneeGroups.has(assignee)) {
        assigneeGroups.set(assignee, []);
      }
      assigneeGroups.get(assignee)!.push(task);
    });
    


    // Sort assignees alphabetically
    const sortedAssignees = Array.from(assigneeGroups.keys()).sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return 1;
      return a.localeCompare(b);
    });

    // Render assignee sections
    sortedAssignees.forEach(assignee => {
      const assigneeTasks = assigneeGroups.get(assignee)!;
      const sectionClass = assignee === "Unassigned" ? "unassigned" : "assignee";
      const emoji = assignee === "Unassigned" ? "❓" : "👤";
      this.renderTaskSection(sections, `${emoji} ${assignee}`, assigneeTasks, sectionClass);
    });
    
    // Restore scroll position after rendering
    if (this.lastScrollTop > 0) {
      setTimeout(() => {
        this.container.scrollTop = this.lastScrollTop;
      }, 0);
    }
  }

  private renderTaskSection(container: HTMLElement, title: string, tasks: any[], sectionClass: string) {

    
    const section = container.createEl("div", { cls: `pm-today-section ${sectionClass}` });
    
    const sectionHeader = section.createEl("div", { cls: "pm-today-section-header collapsible" });
    
    // Add collapse/expand icon
    const collapseIcon = sectionHeader.createEl("span", { cls: "pm-today-collapse-icon" });
    
    const sectionTitle = sectionHeader.createEl("h3", { text: title });
    const taskCount = sectionHeader.createEl("span", { 
      cls: "pm-today-count",
      text: `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`
    });

    const taskList = section.createEl("div", { cls: "pm-today-task-list" });
    
    // Check if this section should be collapsed based on previous state
    const shouldBeCollapsed = this.collapsedSections.has(title);
    if (shouldBeCollapsed) {
      section.addClass("collapsed");
      setIcon(collapseIcon, "chevron-right");
                taskList.classList.add("pm-task-list-hidden");
          taskList.classList.remove("pm-task-list-visible");
    } else {
      setIcon(collapseIcon, "chevron-down");
    }
    
    // Add click handler to toggle collapse
    sectionHeader.onclick = () => {
      const isCollapsed = section.hasClass("collapsed");
      if (isCollapsed) {
        section.removeClass("collapsed");
        setIcon(collapseIcon, "chevron-down");
        taskList.classList.add("pm-task-list-visible");
        taskList.classList.remove("pm-task-list-hidden");
        this.collapsedSections.delete(title);
      } else {
        section.addClass("collapsed");
        setIcon(collapseIcon, "chevron-right");
        taskList.classList.add("pm-task-list-hidden");
        taskList.classList.remove("pm-task-list-visible");
        this.collapsedSections.add(title);
      }
    };
    
    tasks.forEach((task, index) => {

      this.renderTask(taskList, task);
    });
  }

  private renderTask(container: HTMLElement, task: any) {
    // Determine status for color coding
    const status = this.getTaskStatus(task);
    const taskEl = container.createEl("div", { cls: `pm-today-task status-${status}` });
    
    // Task header
    const taskHeader = taskEl.createEl("div", { cls: "pm-today-task-header" });
    
    // Status indicator
    const statusEl = taskHeader.createEl("div", { 
      cls: `pm-today-status-indicator status-${status}`,
      title: `Status: ${status.replace('-', ' ')}`
    });
    
    // On-hold indicator
    if (status === 'on-hold') {
      const onHoldIndicator = taskHeader.createEl("div", { 
        cls: "pm-today-on-hold-indicator",
        title: "Task is on hold"
      });
      setIcon(onHoldIndicator, "pause");
    }
    
    // Priority indicator
    const priority = getTaskPriority(task);
    if (priority !== 'none') {
      const priorityEl = taskHeader.createEl("span", { 
        cls: `pm-today-priority pm-priority-${priority}`,
        text: priority.charAt(0).toUpperCase() + priority.slice(1)
      });
    }
    
    // Task title
    const taskTitle = taskHeader.createEl("div", { 
      cls: "pm-today-task-title",
      text: task.text || task.title || "Untitled Task"
    });
    
    // Start date (now first)
    const startDate = task.start || task.props?.start;
    if (startDate) {
      const daysUntilStart = getDaysUntilStart(task, this.selectedDate);
      const shouldStart = shouldTaskBeStarted(task, this.selectedDate);
      
      // Check if task is actually in progress
      const taskStatus = this.getTaskStatus(task);
      const isInProgress = taskStatus === 'in-progress';
      const isOnHold = taskStatus === 'on-hold';
      const isCompleted = taskStatus === 'completed';
      
      // Determine color class based on days until start, but prioritize "started" status
      let colorClass = '';
      if (isInProgress) {
        // If task is started, don't apply timing-based colors
        colorClass = '';
      } else if (daysUntilStart < 0) {
        colorClass = 'overdue'; // Already passed
      } else if (daysUntilStart >= 7) {
        colorClass = 'distant'; // 7+ days = green
      } else if (daysUntilStart >= 3) {
        colorClass = 'soon'; // 3-6 days = yellow
      } else {
        colorClass = 'urgent'; // 0-2 days = red
      }
      

      
      // Generate appropriate text based on timing and status
      let startText = '';
      
      if (isCompleted) {
        // Completed tasks always show "Completed" regardless of timing
        startText = '✅ Completed';
      } else if (isOnHold) {
        // On hold tasks always show "On hold" regardless of timing
        startText = '⏸️ On hold';
      } else if (shouldStart) {
        if (isInProgress) {
          if (daysUntilStart === 0) {
            startText = '✅ Started today';
          } else if (daysUntilStart === -1) {
            startText = '✅ Started yesterday';
          } else if (daysUntilStart < 0) {
            startText = `✅ Started (${Math.abs(daysUntilStart)} days ago)`;
          } else if (daysUntilStart === 1) {
            startText = '✅ Started tomorrow';
          } else {
            startText = `✅ Started (in ${daysUntilStart} days)`;
          }
        } else {
          if (daysUntilStart === 0) {
            startText = '🚀 Should start today';
          } else if (daysUntilStart === -1) {
            startText = '🚀 Should have started yesterday';
          } else if (daysUntilStart < 0) {
            startText = `🚀 Should be started (${Math.abs(daysUntilStart)} days ago)`;
          } else if (daysUntilStart === 1) {
            startText = '🚀 Should start tomorrow';
          } else {
            startText = `🚀 Should start (in ${daysUntilStart} days)`;
          }
        }
      } else {
        if (daysUntilStart === 0) {
          startText = 'Start today';
        } else if (daysUntilStart === 1) {
          startText = 'Start tomorrow';
        } else {
          startText = `Start in ${daysUntilStart} days`;
        }
      }
      
      // Determine status class for styling
      let statusClass = '';
      if (isCompleted) {
        statusClass = 'completed';
      } else if (isOnHold) {
        statusClass = 'on-hold';
      } else if (shouldStart) {
        statusClass = isInProgress ? 'started' : 'should-start';
      }
      
      const startEl = taskHeader.createEl("div", { 
        cls: `pm-today-start ${statusClass} ${colorClass}`,
        text: startText
      });
    }
    
    // Due date (now second)
    const dueDate = task.due || task.props?.due;
    if (dueDate) {
      const daysUntilDue = getDaysUntilDue(task, this.selectedDate);
      const taskStatus = this.getTaskStatus(task);
      const isCompleted = taskStatus === 'completed';
      
      // Determine color class based on days until due
      let colorClass = '';
      if (isCompleted) {
        colorClass = 'completed'; // Completed tasks get completed styling
      } else if (daysUntilDue < 0) {
        colorClass = 'overdue'; // Already overdue
      } else if (daysUntilDue === 0) {
        colorClass = 'due-today'; // Due today
      } else if (daysUntilDue >= 7) {
        colorClass = 'distant'; // 7+ days = green
      } else if (daysUntilDue >= 3) {
        colorClass = 'soon'; // 3-6 days = yellow
      } else {
        colorClass = 'urgent'; // 1-2 days = red
      }
      
      // Generate appropriate due date text
      let dueText = '';
      if (isCompleted) {
        dueText = "✅ Completed";
      } else if (daysUntilDue === -1) {
        dueText = "Due yesterday";
      } else if (daysUntilDue < 0) {
        dueText = `${Math.abs(daysUntilDue)} days overdue`;
      } else if (daysUntilDue === 0) {
        dueText = "Due today";
      } else if (daysUntilDue === 1) {
        dueText = "Due tomorrow";
      } else {
        dueText = `Due in ${daysUntilDue} days`;
      }
      
      const dueEl = taskHeader.createEl("div", { 
        cls: `pm-today-due ${colorClass}`,
        text: dueText
      });
    }
    
    // Task details
    const taskDetails = taskEl.createEl("div", { cls: "pm-today-task-details" });
    
    // Project with task type icon
    if (task.projectName) {
      const projectEl = taskDetails.createEl("div", { 
        cls: "pm-today-project"
      });
      
      // Add task type icon
      const taskType = this.getTaskType(task);
      const iconEl = projectEl.createEl("span", { cls: "pm-today-task-type-icon" });
      
      switch (taskType) {
        case 'epic':
          setIcon(iconEl, "crown");
          break;
        case 'story':
          setIcon(iconEl, "file-text");
          break;
        case 'subtask':
          setIcon(iconEl, "list");
          break;
        default:
          setIcon(iconEl, "file");
          break;
      }
      
      projectEl.createEl("span", { text: ` ${task.projectName}` });
    }
    
    // Assignee
    const assignee = task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner;
    if (assignee) {
      const assigneeEl = taskDetails.createEl("div", { 
        cls: "pm-today-assignee",
        text: `👤 ${assignee}`
      });
    }
    
    // Task ID
    if (task.id) {
      const idEl = taskDetails.createEl("div", { 
        cls: "pm-today-id",
        text: `#${task.id}`
      });
    }
    
    // Status
    if (task.status) {
      const statusEl = taskDetails.createEl("div", { 
        cls: "pm-today-status",
        text: `📊 ${task.status}`
      });
    }
  }
}
