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
import { ProjectCache } from "../services/cache";
import { PmSettings } from "../../settings";
import { Chart, registerables } from 'chart.js';

// Register Chart.js components
Chart.register(...registerables);

// Load dashboard-specific stylesheet
import "../../styles/styles-dashboard.css";

/** Helper: format a date or return an em-dash if undefined */
function formatDate(d: string | number | Date | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
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

/** Get task status for categorization */
function getTaskStatus(t: any): 'completed' | 'in-progress' | 'not-started' | 'on-hold' {
  if (isTaskDone(t)) return 'completed';
  
  if (typeof t.status === "string") {
    const s = t.status.toLowerCase();
    if (s === "in-progress") return 'in-progress';
    if (s === "on-hold") return 'on-hold';
  }
  
  return 'not-started';
}

/** Get task type for categorization */
function getTaskType(t: any): 'epic' | 'story' | 'subtask' | 'other' {
  const id = (t.id ?? "").toUpperCase();
  if (id.startsWith("E")) return 'epic';
  if (id.startsWith("S") && !id.startsWith("SB")) return 'story';
  if (id.startsWith("SB")) return 'subtask';
  return 'other';
}

export const VIEW_TYPE_PM_DASHBOARD = "pm-dashboard-view";

export class DashboardView extends ItemView {
  /** icon shown on the view tab */
  public icon = "bar-chart-3";
  /** Optional set of project file paths to display (injected by Portfolio view) */
  private filterPaths?: Set<string>;
  /** Optional name of the portfolio that opened this dashboard */
  private filterName?: string;
  /** The initial project paths passed in from Portfolio (null = no portfolio) */
  private originalPaths: string[] | null = null;
  /** Optional set of assignees to filter by */
  private filterAssignees?: Set<string>;
  /** Optional name of the assignee filter that opened this dashboard */
  private filterAssigneeName?: string;
  /** The initial assignees passed in (null = no assignee filter) */
  private originalAssignees: string[] | null = null;
  /** Currently focused chart type (for drill-down view) */
  private focusedChart?: 'status' | 'type' | 'assignee' | 'assignee-status' | 'project';
  /** Toggle for mini charts: true = bar charts, false = pie charts */
  private miniChartsAsBars: boolean = false;

  private cache: ProjectCache;
  private settings: PmSettings;
  private container!: HTMLElement;
  private detachFn: (() => void) | null = null;
  private charts: Map<string, any> = new Map(); // Store chart instances

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
    if (
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
    // Mirror projects: support initial assignee filter passed via state
    if (
      Array.isArray(state.filterAssignees) &&
      state.filterAssignees.length > 0
    ) {
      this.filterAssignees   = new Set(state.filterAssignees as string[]);
      this.originalAssignees = [...state.filterAssignees];
    } else {
      this.filterAssignees   = undefined;
      this.originalAssignees = null;
    }
    if (typeof state?.filterAssigneeName === "string" && state.filterAssigneeName.trim() !== "") {
      this.filterAssigneeName = state.filterAssigneeName.trim();
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

  /** Update assignee filter & re-render.
      Pass `null` => show ALL assignees.                         */
  public updateAssigneeFilter(assignees: string[] | null, name = "") {
    if (assignees === null) {
      /* Show ALL assignees */
      this.filterAssignees = undefined;
      // Don't clear filterAssigneeName - preserve it like projects filter
    } else if (Array.isArray(assignees)) {
      /* Show NONE if empty array, else selected set */
      this.filterAssignees = assignees.length ? new Set(assignees) : new Set<string>();
      
      // Set originalAssignees if this is the first time we're setting a filter
      if (!this.originalAssignees && assignees.length > 0) {
        this.originalAssignees = [...assignees];
      }
    }
    // Set the name if provided, otherwise keep existing
    if (name) {
      this.filterAssigneeName = name;
    }
    this.render();
  }

  /** Focus on a specific chart type for drill-down view */
  public focusChart(chartType: 'status' | 'type' | 'assignee' | 'assignee-status' | 'project' | null) {
    this.focusedChart = chartType || undefined;
    this.render();
  }

  getViewType(): string {
    return VIEW_TYPE_PM_DASHBOARD;
  }
  getDisplayText(): string {
    return this.filterName
      ? `Dashboard – ${this.filterName}`
      : "Dashboard";
  }

  getIcon(): string {
    return "bar-chart-3";
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

    // Apply initial assignee state if provided
    if (Array.isArray(st.filterAssignees) && st.filterAssignees.length) {
      this.filterAssignees   = new Set(st.filterAssignees);
      this.originalAssignees = [...st.filterAssignees];
    } else {
      this.filterAssignees   = undefined;
      this.originalAssignees = null;
    }
    if (typeof st.filterAssigneeName === "string") {
      this.filterAssigneeName = st.filterAssigneeName.trim();
    }

    this.render();
    this.detachFn = this.cache.onChange(() => this.render());
  }
  async onClose() {
    this.detachFn?.();
    // Clean up charts
    this.charts.forEach(chart => chart.destroy());
    this.charts.clear();
  }

  /** Collect all tasks from filtered projects */
  private collectTasks(): any[] {
    const allTasks: any[] = [];
    
    this.cache.projects.forEach((project: any) => {
      // Apply project filter
      if (this.filterPaths && !this.filterPaths.has(project.file.path)) {
        return;
      }
      
      // Add project metadata to tasks
      (project.tasks ?? []).forEach((task: any) => {
        task.projectName = project.file.basename;
        task.projectPath = project.file.path;
        allTasks.push(task);
      });
    });
    
    // Apply assignee filter if set
    if (this.filterAssignees && this.filterAssignees.size > 0) {
      return allTasks.filter(task => {
        const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
        return this.filterAssignees!.has(assignee);
      });
    }
    
    return allTasks;
  }

  /** Create chart data for task status distribution */
  private createStatusChartData(tasks: any[]) {
    const statusCounts = {
      'completed': 0,
      'in-progress': 0,
      'not-started': 0,
      'on-hold': 0
    };
    
    tasks.forEach(task => {
      const status = getTaskStatus(task);
      statusCounts[status]++;
    });
    
    return {
      labels: ['Completed', 'In Progress', 'Not Started', 'On Hold'],
      datasets: [{
        data: [statusCounts.completed, statusCounts['in-progress'], statusCounts['not-started'], statusCounts['on-hold']],
        backgroundColor: [
          '#27ae60', // green for completed
          '#f39c12', // orange for in-progress  
          '#e74c3c', // red for not-started
          '#3498db'  // blue for on-hold
        ],
        borderWidth: 2,
        borderColor: 'var(--background-secondary)'
      }]
    };
  }

  /** Create chart data for task type distribution */
  private createTypeChartData(tasks: any[]) {
    const typeCounts = {
      'epic': 0,
      'story': 0,
      'subtask': 0,
      'other': 0
    };
    
    tasks.forEach(task => {
      const type = getTaskType(task);
      typeCounts[type]++;
    });
    
    return {
      labels: ['Epics', 'Stories', 'Subtasks', 'Other'],
      datasets: [{
        data: [typeCounts.epic, typeCounts.story, typeCounts.subtask, typeCounts.other],
        backgroundColor: [
          '#8e44ad', // darker purple for epics
          '#d68910', // darker orange for stories
          '#16a085', // darker teal for subtasks
          '#2c3e50'  // darker gray for other
        ],
        borderWidth: 2,
        borderColor: 'var(--background-secondary)'
      }]
    };
  }

  /** Create chart data for assignee distribution */
  private createAssigneeChartData(tasks: any[]) {
    const assigneeCounts = new Map<string, number>();
    
    tasks.forEach(task => {
      const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
      assigneeCounts.set(assignee, (assigneeCounts.get(assignee) || 0) + 1);
    });
    
    // Sort by count descending - show all assignees
    const sortedAssignees = Array.from(assigneeCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    
    // Generate enough colors for all assignees
    const baseColors = [
      '#c0392b', '#2980b9', '#27ae60', '#d68910',
      '#8e44ad', '#16a085', '#d35400', '#2c3e50'
    ];
    
    // Extend colors if we have more than 8 assignees
    const colors = [...baseColors];
    const additionalColors = [
      '#e67e22', '#9b59b6', '#1abc9c', '#f1c40f',
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
      '#8e44ad', '#16a085', '#d35400', '#2c3e50',
      '#795548', '#607d8b', '#ff5722', '#9c27b0',
      '#673ab7', '#3f51b5', '#2196f3', '#00bcd4'
    ];
    
    let colorIndex = 0;
    while (colors.length < sortedAssignees.length) {
      colors.push(additionalColors[colorIndex % additionalColors.length]);
      colorIndex++;
    }
    
    return {
      labels: sortedAssignees.map(([assignee]) => assignee),
      datasets: [{
        data: sortedAssignees.map(([, count]) => count),
        backgroundColor: colors.slice(0, sortedAssignees.length),
        borderWidth: 2,
        borderColor: 'var(--background-secondary)'
      }]
    };
  }

  /** Create chart data for assignee per project distribution (stacked bar chart) */
  private createAssigneeProjectChartData(tasks: any[]) {
    const projectAssigneeCounts = new Map<string, Map<string, number>>();
    const allAssignees = new Set<string>();
    
    // Initialize projects and collect all assignees
    tasks.forEach(task => {
      const projectName = task.projectName || "Unknown Project";
      const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
      
      allAssignees.add(assignee);
      
      if (!projectAssigneeCounts.has(projectName)) {
        projectAssigneeCounts.set(projectName, new Map());
      }
    });
    
    // Initialize all assignees for all projects with zero counts
    projectAssigneeCounts.forEach((assigneeMap) => {
      allAssignees.forEach(assignee => {
        if (!assigneeMap.has(assignee)) {
          assigneeMap.set(assignee, 0);
        }
      });
    });
    
    // Count tasks by assignee for each project
    tasks.forEach(task => {
      const projectName = task.projectName || "Unknown Project";
      const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
      
      const assigneeMap = projectAssigneeCounts.get(projectName)!;
      assigneeMap.set(assignee, (assigneeMap.get(assignee) || 0) + 1);
    });
    
    // Sort projects by total task count
    const sortedProjects = Array.from(projectAssigneeCounts.entries())
      .sort((a, b) => {
        const totalA = Array.from(a[1].values()).reduce((sum, count) => sum + count, 0);
        const totalB = Array.from(b[1].values()).reduce((sum, count) => sum + count, 0);
        return totalB - totalA;
      });
    
    // Sort assignees by total task count
    const assigneeTotals = new Map<string, number>();
    allAssignees.forEach(assignee => {
      let total = 0;
      projectAssigneeCounts.forEach(assigneeMap => {
        total += assigneeMap.get(assignee) || 0;
      });
      assigneeTotals.set(assignee, total);
    });
    
    const sortedAssignees = Array.from(allAssignees).sort((a, b) => 
      (assigneeTotals.get(b) || 0) - (assigneeTotals.get(a) || 0)
    );
    
    // Generate colors for assignees
    const baseColors = [
      '#e74c3c', '#f39c12', '#27ae60', '#3498db',
      '#8e44ad', '#16a085', '#d35400', '#2c3e50'
    ];
    
    const additionalColors = [
      '#e67e22', '#9b59b6', '#1abc9c', '#f1c40f',
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
      '#795548', '#607d8b', '#ff5722', '#9c27b0'
    ];
    
    const colors = [...baseColors];
    let colorIndex = 0;
    while (colors.length < sortedAssignees.length) {
      colors.push(additionalColors[colorIndex % additionalColors.length]);
      colorIndex++;
    }
    
    const datasets = sortedAssignees.map((assignee, index) => ({
      label: assignee,
      data: sortedProjects.map(([, assigneeMap]) => assigneeMap.get(assignee) || 0),
      backgroundColor: colors[index],
      borderWidth: 1,
      borderColor: 'var(--background-secondary)'
    }));
    
    return {
      labels: sortedProjects.map(([projectName]) => projectName),
      datasets: datasets
    };
  }

  /** Create chart data for project status distribution (stacked bar chart) */
  private createProjectStatusChartData(tasks: any[]) {
    const projectStatusCounts = new Map<string, { 'completed': number, 'in-progress': number, 'not-started': number, 'on-hold': number }>();
    
    // Initialize all projects with zero counts
    tasks.forEach(task => {
      const projectName = task.projectName || "Unknown Project";
      if (!projectStatusCounts.has(projectName)) {
        projectStatusCounts.set(projectName, {
          'completed': 0,
          'in-progress': 0,
          'not-started': 0,
          'on-hold': 0
        });
      }
    });
    
    // Count tasks by status for each project
    tasks.forEach(task => {
      const projectName = task.projectName || "Unknown Project";
      const status = getTaskStatus(task);
      const counts = projectStatusCounts.get(projectName)!;
      counts[status]++;
    });
    
    // Sort projects by total task count (descending)
    const sortedProjects = Array.from(projectStatusCounts.entries())
      .sort((a, b) => {
        const totalA = a[1]['completed'] + a[1]['in-progress'] + a[1]['not-started'] + a[1]['on-hold'];
        const totalB = b[1]['completed'] + b[1]['in-progress'] + b[1]['not-started'] + b[1]['on-hold'];
        return totalB - totalA;
      });
    
    return {
      labels: sortedProjects.map(([projectName]) => projectName),
      datasets: [
        {
          label: 'Completed',
          data: sortedProjects.map(([, counts]) => counts['completed']),
          backgroundColor: '#27ae60', // green
          borderWidth: 1,
          borderColor: 'var(--background-secondary)'
        },
        {
          label: 'In Progress',
          data: sortedProjects.map(([, counts]) => counts['in-progress']),
          backgroundColor: '#f39c12', // orange
          borderWidth: 1,
          borderColor: 'var(--background-secondary)'
        },
        {
          label: 'Not Started',
          data: sortedProjects.map(([, counts]) => counts['not-started']),
          backgroundColor: '#e74c3c', // red
          borderWidth: 1,
          borderColor: 'var(--background-secondary)'
        },
        {
          label: 'On Hold',
          data: sortedProjects.map(([, counts]) => counts['on-hold']),
          backgroundColor: '#3498db', // blue
          borderWidth: 1,
          borderColor: 'var(--background-secondary)'
        }
      ]
    };
  }

  /** Create chart data for assignee status distribution (stacked bar chart) */
  private createAssigneeStatusChartData(tasks: any[]) {
    const assigneeStatusCounts = new Map<string, { 'completed': number, 'in-progress': number, 'not-started': number, 'on-hold': number }>();
    
    // Initialize all assignees with zero counts
    tasks.forEach(task => {
      const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
      if (!assigneeStatusCounts.has(assignee)) {
        assigneeStatusCounts.set(assignee, {
          'completed': 0,
          'in-progress': 0,
          'not-started': 0,
          'on-hold': 0
        });
      }
    });
    
    // Count tasks by status for each assignee
    tasks.forEach(task => {
      const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
      const status = getTaskStatus(task);
      const counts = assigneeStatusCounts.get(assignee)!;
      counts[status]++;
    });
    
    // Sort assignees by total task count (descending)
    const sortedAssignees = Array.from(assigneeStatusCounts.entries())
      .sort((a, b) => {
        const totalA = a[1]['completed'] + a[1]['in-progress'] + a[1]['not-started'] + a[1]['on-hold'];
        const totalB = b[1]['completed'] + b[1]['in-progress'] + b[1]['not-started'] + b[1]['on-hold'];
        return totalB - totalA;
      });
    
    return {
      labels: sortedAssignees.map(([assignee]) => assignee),
      datasets: [
        {
          label: 'Completed',
          data: sortedAssignees.map(([, counts]) => counts['completed']),
          backgroundColor: '#27ae60', // green
          borderWidth: 1,
          borderColor: 'var(--background-secondary)'
        },
        {
          label: 'In Progress',
          data: sortedAssignees.map(([, counts]) => counts['in-progress']),
          backgroundColor: '#f39c12', // orange
          borderWidth: 1,
          borderColor: 'var(--background-secondary)'
        },
        {
          label: 'Not Started',
          data: sortedAssignees.map(([, counts]) => counts['not-started']),
          backgroundColor: '#e74c3c', // red
          borderWidth: 1,
          borderColor: 'var(--background-secondary)'
        },
        {
          label: 'On Hold',
          data: sortedAssignees.map(([, counts]) => counts['on-hold']),
          backgroundColor: '#3498db', // blue
          borderWidth: 1,
          borderColor: 'var(--background-secondary)'
        }
      ]
    };
  }

  /** Create chart data for project distribution */
  private createProjectChartData(tasks: any[]) {
    const projectCounts = new Map<string, number>();
    
    tasks.forEach(task => {
      const project = task.projectName || "Unknown Project";
      const taskType = getTaskType(task);
      
      // Only count epics, stories, and subtasks (not individual tasks)
      if (taskType === 'epic' || taskType === 'story' || taskType === 'subtask') {
        projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
      }
    });
    
    // Sort by count descending and show all projects
    const sortedProjects = Array.from(projectCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    
    // Generate more colors if needed
    const baseColors = [
      '#c0392b', '#2980b9', '#27ae60', '#d68910',
      '#8e44ad', '#16a085', '#d35400', '#2c3e50'
    ];
    
    // Extend colors if we have more than 8 projects
    const colors = [...baseColors];
    const additionalColors = [
      '#e67e22', '#9b59b6', '#1abc9c', '#f1c40f',
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
      '#8e44ad', '#16a085', '#d35400', '#2c3e50'
    ];
    
    let colorIndex = 0;
    while (colors.length < sortedProjects.length) {
      colors.push(additionalColors[colorIndex % additionalColors.length]);
      colorIndex++;
    }
    
    return {
      labels: sortedProjects.map(([project]) => project),
      datasets: [{
        data: sortedProjects.map(([, count]) => count),
        backgroundColor: colors.slice(0, sortedProjects.length),
        borderWidth: 2,
        borderColor: 'var(--background-secondary)'
      }]
    };
  }

  /** Render project breakdown summary for focused view */
  private renderProjectBreakdown(container: HTMLElement, tasks: any[], chartType: string) {
    const projectStats = new Map<string, any>();
    
    // Initialize project stats
    tasks.forEach(task => {
      const projectName = task.projectName || "Unknown Project";
      if (!projectStats.has(projectName)) {
        projectStats.set(projectName, {
          total: 0,
          completed: 0,
          'in-progress': 0,
          'not-started': 0,
          'on-hold': 0,
          epic: 0,
          story: 0,
          subtask: 0,
          other: 0
        });
      }
    });
    
    // Count stats per project
    tasks.forEach(task => {
      const projectName = task.projectName || "Unknown Project";
      const stats = projectStats.get(projectName)!;
      const status = getTaskStatus(task);
      const type = getTaskType(task);
      
      stats.total++;
      stats[status]++;
      stats[type]++;
    });
    
    // Sort projects by total task count
    const sortedProjects = Array.from(projectStats.entries())
      .sort((a, b) => b[1].total - a[1].total);
    
    const summaryContainer = container.createEl("div", { cls: "pm-project-breakdown" });
    
    sortedProjects.forEach(([projectName, stats]) => {
      const projectCard = summaryContainer.createEl("div", { cls: "pm-project-card" });
      
      // Project header
      const header = projectCard.createEl("div", { cls: "pm-project-header" });
      header.createEl("h4", { text: projectName });
      header.createEl("span", { text: `${stats.total} tasks`, cls: "pm-project-total" });
      
      // Stats grid
      const statsGrid = projectCard.createEl("div", { cls: "pm-project-stats" });
      
      if (chartType === 'status' || chartType === 'assignee-status') {
        const completedEl = statsGrid.createEl("div", { cls: "pm-stat-item completed" });
        completedEl.createEl("strong", { text: "Completed: " });
        completedEl.createEl("span", { text: `${stats.completed}` });
        
        const inProgressEl = statsGrid.createEl("div", { cls: "pm-stat-item in-progress" });
        inProgressEl.createEl("strong", { text: "In Progress: " });
        inProgressEl.createEl("span", { text: `${stats['in-progress']}` });
        
        const notStartedEl = statsGrid.createEl("div", { cls: "pm-stat-item not-started" });
        notStartedEl.createEl("strong", { text: "Not Started: " });
        notStartedEl.createEl("span", { text: `${stats['not-started']}` });
        
        const onHoldEl = statsGrid.createEl("div", { cls: "pm-stat-item on-hold" });
        onHoldEl.createEl("strong", { text: "On Hold: " });
        onHoldEl.createEl("span", { text: `${stats['on-hold']}` });
      } else if (chartType === 'type') {
        const epicEl = statsGrid.createEl("div", { cls: "pm-stat-item epic" });
        epicEl.createEl("strong", { text: "Epics: " });
        epicEl.createEl("span", { text: `${stats.epic}` });
        
        const storyEl = statsGrid.createEl("div", { cls: "pm-stat-item story" });
        storyEl.createEl("strong", { text: "Stories: " });
        storyEl.createEl("span", { text: `${stats.story}` });
        
        const subtaskEl = statsGrid.createEl("div", { cls: "pm-stat-item subtask" });
        subtaskEl.createEl("strong", { text: "Subtasks: " });
        subtaskEl.createEl("span", { text: `${stats.subtask}` });
        
        const otherEl = statsGrid.createEl("div", { cls: "pm-stat-item other" });
        otherEl.createEl("strong", { text: "Other: " });
        otherEl.createEl("span", { text: `${stats.other}` });
      } else {
        // For assignee and project charts, show both status and type
        const completedEl = statsGrid.createEl("div", { cls: "pm-stat-item completed" });
        completedEl.createEl("strong", { text: "Completed: " });
        completedEl.createEl("span", { text: `${stats.completed}` });
        
        const inProgressEl = statsGrid.createEl("div", { cls: "pm-stat-item in-progress" });
        inProgressEl.createEl("strong", { text: "In Progress: " });
        inProgressEl.createEl("span", { text: `${stats['in-progress']}` });
        
        const epicEl = statsGrid.createEl("div", { cls: "pm-stat-item epic" });
        epicEl.createEl("strong", { text: "Epics: " });
        epicEl.createEl("span", { text: `${stats.epic}` });
        
        const storyEl = statsGrid.createEl("div", { cls: "pm-stat-item story" });
        storyEl.createEl("strong", { text: "Stories: " });
        storyEl.createEl("span", { text: `${stats.story}` });
      }
      
      // Completion rate
      const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
      const rateEl = projectCard.createEl("div", { cls: "pm-completion-rate" });
      rateEl.createEl("strong", { text: "Completion Rate: " });
      rateEl.createEl("span", { text: `${completionRate}%` });
    });
  }

  /** Render assignee breakdown charts for focused view */
  private renderAssigneeBreakdown(container: HTMLElement, tasks: any[], chartType: string) {
    const assigneeStats = new Map<string, any>();
    
    // Initialize assignee stats
    tasks.forEach(task => {
      const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
      if (!assigneeStats.has(assignee)) {
        assigneeStats.set(assignee, {
          total: 0,
          completed: 0,
          'in-progress': 0,
          'not-started': 0,
          'on-hold': 0,
          epic: 0,
          story: 0,
          subtask: 0,
          other: 0
        });
      }
    });
    
    // Count stats per assignee
    tasks.forEach(task => {
      const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
      const stats = assigneeStats.get(assignee)!;
      const status = getTaskStatus(task);
      const type = getTaskType(task);
      
      stats.total++;
      stats[status]++;
      stats[type]++;
    });
    
    // Sort assignees by total task count
    const sortedAssignees = Array.from(assigneeStats.entries())
      .sort((a, b) => b[1].total - a[1].total);
    
    // Add toggle button for chart type
    const toggleContainer = container.createEl("div", { cls: "pm-mini-chart-toggle" });
    const toggleBtn = toggleContainer.createEl("button", { cls: "pm-chart-toggle-btn" });
    const toggleIcon = toggleBtn.createSpan();
    setIcon(toggleIcon, this.miniChartsAsBars ? "pie-chart" : "bar-chart-3");
    toggleBtn.createSpan({ text: this.miniChartsAsBars ? " Switch to Pie Charts" : " Switch to Bar Charts" });
    toggleBtn.onclick = () => {
      this.miniChartsAsBars = !this.miniChartsAsBars;
      this.render(); // Re-render to update all charts
    };
    
    // Create mini charts for each assignee
    const chartsContainer = container.createEl("div", { cls: "pm-assignee-charts" });
    
    sortedAssignees.forEach(([assignee, stats], index) => {
      const chartCard = chartsContainer.createEl("div", { cls: "pm-mini-chart-card" });
      
      // Assignee header
      const header = chartCard.createEl("div", { cls: "pm-assignee-header" });
      header.createEl("h5", { text: assignee });
      header.createEl("span", { text: `${stats.total} tasks`, cls: "pm-assignee-total" });
      
      // Create mini chart data based on focus type
      let chartData: any = null;
      if (chartType === 'status' || chartType === 'assignee-status') {
        chartData = {
          labels: ['Completed', 'In Progress', 'Not Started', 'On Hold'],
          datasets: [{
            data: [stats.completed, stats['in-progress'], stats['not-started'], stats['on-hold']],
            backgroundColor: ['#27ae60', '#f39c12', '#e74c3c', '#3498db'],
            borderWidth: 1,
            borderColor: 'var(--background-secondary)'
          }]
        };
      } else if (chartType === 'type') {
        chartData = {
          labels: ['Epics', 'Stories', 'Subtasks', 'Other'],
          datasets: [{
            data: [stats.epic, stats.story, stats.subtask, stats.other],
            backgroundColor: ['#8e44ad', '#d68910', '#16a085', '#2c3e50'],
            borderWidth: 1,
            borderColor: 'var(--background-secondary)'
          }]
        };
      } else {
        // For assignee and project charts, show status distribution
        chartData = {
          labels: ['Completed', 'In Progress', 'Not Started', 'On Hold'],
          datasets: [{
            data: [stats.completed, stats['in-progress'], stats['not-started'], stats['on-hold']],
            backgroundColor: ['#27ae60', '#f39c12', '#e74c3c', '#3498db'],
            borderWidth: 1,
            borderColor: 'var(--background-secondary)'
          }]
        };
      }
      
      // Create mini canvas
      const miniCanvas = chartCard.createEl("canvas", { cls: "pm-mini-chart-canvas" });
      miniCanvas.id = `assignee-mini-chart-${index}`;
      
      // Use bar chart or pie chart based on toggle
      if (this.miniChartsAsBars) {
        this.createBarChart(miniCanvas, chartData, "", true);
      } else {
        this.createPieChart(miniCanvas, chartData, "", true);
      }
    });
  }

  /** Create a bar chart */
  private createBarChart(canvas: HTMLCanvasElement, data: any, title: string, isMiniChart: boolean = false) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Destroy existing chart if it exists
    const existingChart = this.charts.get(canvas.id);
    if (existingChart) {
      existingChart.destroy();
    }
    
    // Check if dark mode is active
    const isDarkMode = document.body.classList.contains('theme-dark');
    const textColor = isDarkMode ? '#ffffff' : '#000000';
    const tooltipTextColor = '#ffffff'; // Always white for tooltips (they have dark backgrounds)
    const bgColor = isDarkMode ? '#2d3748' : '#1f2937'; // Dark background for tooltips in both modes
    const borderColor = isDarkMode ? '#4a5568' : '#374151';
    
    // Create new chart
    const chart = new Chart(ctx, {
      type: 'bar',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        color: textColor, // Global text color
        scales: {
          x: {
            stacked: !isMiniChart, // Only stack for main charts, not mini charts
            ticks: {
              color: textColor,
              font: {
                size: isMiniChart ? 8 : 11
              }
            },
            grid: {
              color: isDarkMode ? '#4a5568' : '#e5e7eb'
            }
          },
          y: {
            stacked: !isMiniChart, // Only stack for main charts, not mini charts
            ticks: {
              color: textColor,
              font: {
                size: isMiniChart ? 8 : 11
              }
            },
            grid: {
              color: isDarkMode ? '#4a5568' : '#e5e7eb'
            }
          }
        },
        plugins: {
          legend: {
            display: !isMiniChart, // Hide legend for mini charts
            position: 'bottom',
            labels: {
              color: textColor,
              font: {
                size: 12
              }
            }
          },
          title: {
            display: title.length > 0,
            text: title,
            color: textColor,
            font: {
              size: isMiniChart ? 12 : 16,
              weight: 'bold'
            }
          },
          tooltip: {
            backgroundColor: bgColor,
            titleColor: tooltipTextColor,
            bodyColor: tooltipTextColor,
            borderColor: borderColor,
            borderWidth: 1,
            titleFont: {
              size: isMiniChart ? 10 : 14,
              weight: 'bold'
            },
            bodyFont: {
              size: isMiniChart ? 10 : 12
            },
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                return `${label}: ${value}`;
              }
            }
          }
        }
      }
    });
    
    this.charts.set(canvas.id, chart);
    return chart;
  }

  /** Create a pie chart */
  private createPieChart(canvas: HTMLCanvasElement, data: any, title: string, isMiniChart: boolean = false) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Destroy existing chart if it exists
    const existingChart = this.charts.get(canvas.id);
    if (existingChart) {
      existingChart.destroy();
    }
    
    // Check if dark mode is active
    const isDarkMode = document.body.classList.contains('theme-dark');
    const textColor = isDarkMode ? '#ffffff' : '#000000';
    const tooltipTextColor = '#ffffff'; // Always white for tooltips (they have dark backgrounds)
    const bgColor = isDarkMode ? '#2d3748' : '#1f2937'; // Dark background for tooltips in both modes
    const borderColor = isDarkMode ? '#4a5568' : '#374151';
    
    // Create new chart
    const chart = new Chart(ctx, {
      type: 'pie',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        color: textColor, // Global text color
        plugins: {
          legend: {
            display: !isMiniChart, // Hide legend for mini charts
            position: 'bottom',
            labels: {
              color: textColor,
              font: {
                size: isMiniChart ? 8 : 12
              }
            }
          },
          title: {
            display: title.length > 0,
            text: title,
            color: textColor,
            font: {
              size: isMiniChart ? 12 : 16,
              weight: 'bold'
            }
          },
          tooltip: {
            backgroundColor: bgColor,
            titleColor: tooltipTextColor,
            bodyColor: tooltipTextColor,
            borderColor: borderColor,
            borderWidth: 1,
            titleFont: {
              size: isMiniChart ? 10 : 14,
              weight: 'bold'
            },
            bodyFont: {
              size: isMiniChart ? 10 : 12
            },
            callbacks: {
              label: (context) => {
                const label = context.label || '';
                const value = context.parsed;
                const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
    
    this.charts.set(canvas.id, chart);
    return chart;
  }

  private render() {
    this.container.empty();
    this.container.addClass("pm-dashboard-view");

    /* ── Top bar ───────────────────────── */
    const topbar = this.container.createEl("div", { cls: "pm-dash-topbar" });
    topbar.createEl("span", { text: "Dashboard" });

    /* ── Projects dropdown (checkbox list) ─────────────────── */
    const projBtn = topbar.createEl("button", { cls: "pm-proj-btn" });
    /* Label */
    projBtn.createSpan({ text: "Projects " });
    /* Lucide chevron-down icon */
    const caret = projBtn.createSpan();
    setIcon(caret, "chevron-down");

    /* ── Assignees dropdown (checkbox list) ─────────────────── */
    const assigneeBtn = topbar.createEl("button", { cls: "pm-proj-btn" });
    /* Label */
    const assigneeBtnText = this.filterAssigneeName ?? "Assignees";
    assigneeBtn.createSpan({ text: assigneeBtnText + " " });
    /* Lucide chevron-down icon */
    const assigneeCaret = assigneeBtn.createSpan();
    setIcon(assigneeCaret, "chevron-down");

    let ddOpen = false;
    let ddEl: HTMLElement | null = null;
    let assigneeDdOpen = false;
    let assigneeDdEl: HTMLElement | null = null;

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
          this.updateFilter([...this.originalPaths!], this.filterName ?? "");
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
        /* Preserve portfolio name so the middle option stays visible */
        this.updateFilter([], this.filterName ?? "");
        /* Update checkboxes without closing dropdown */
        const checkIcons = Array.from(ddEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
        checkIcons.forEach(icon => {
          icon.setAttribute("data-checked", "false");
          setIcon(icon, "circle");
        });
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

          /* Pass through existing filterName so it doesn't get cleared */
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
      setIcon(caret, "chevron-down");
    };

    const closeAssigneeDropdown = () => {
      assigneeDdEl?.remove();
      assigneeDdEl = null;
      assigneeDdOpen = false;
      setIcon(assigneeCaret, "chevron-down");
    };

    projBtn.onclick = () => {
      if (ddOpen) {
        closeDropdown();
        return;
      }
      ddOpen = true;
      setIcon(caret, "chevron-up");

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

    /* ── Assignees dropdown functionality ─────────────────── */
    const buildAssigneeDropdown = (assigneeList: string[]) => {
      assigneeDdEl = document.createElement("div");
      assigneeDdEl.className = "pm-proj-dd";

      /* Select/Deselect controls */
      const controls = assigneeDdEl.createEl("div", { cls: "pm-proj-dd-ctl" });

      // Ensure we have an initial baseline like projects' originalPaths,
      // so the middle option is available immediately.
      if (!this.originalAssignees) {
        if (!this.filterAssignees) {
          // No filter applied ⇒ baseline is all assignees
          this.originalAssignees = [...assigneeList];
        } else if (this.filterAssignees.size > 0) {
          // Baseline is the currently selected set
          this.originalAssignees = Array.from(this.filterAssignees);
        } else {
          // Explicit none selected
          this.originalAssignees = [];
        }
      }

      /* ALL */
      controls.createEl("a", { text: "All" }).onclick = (e) => {
        e.preventDefault();
        /* Keep current assignee name so middle option remains visible */
        this.updateAssigneeFilter(null);
        /* Update checkboxes without closing dropdown */
        const checkIcons = Array.from(assigneeDdEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
        checkIcons.forEach(icon => {
          icon.setAttribute("data-checked", "true");
          setIcon(icon, "check-circle");
        });
      };

      /* ASSIGNEES (only if originalAssignees present) */
      if (this.originalAssignees && this.originalAssignees.length >= 0) {
        controls.createSpan({ text: " | " });
        controls.createEl("a", { text: this.filterAssigneeName ?? this.filterName ?? "Portfolio" }).onclick = (e) => {
          e.preventDefault();
          this.updateAssigneeFilter([...this.originalAssignees!], this.filterAssigneeName ?? "");
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
        /* Preserve assignee name so the middle option stays visible */
        this.updateAssigneeFilter([]);
        /* Update checkboxes without closing dropdown */
        const checkIcons = Array.from(assigneeDdEl!.querySelectorAll(".pm-dd-check")) as HTMLElement[];
        checkIcons.forEach(icon => {
          icon.setAttribute("data-checked", "false");
          setIcon(icon, "circle");
        });
      };

      /* Checkbox list */
      assigneeList.forEach((assignee: string) => {
        const wrap = assigneeDdEl!.createEl("div", { cls: "pm-proj-dd-item" });
        const cb = wrap.createEl("span", { cls: "pm-dd-check" });
        cb.style.cursor = "pointer";
        cb.style.marginRight = "8px";
        cb.style.display = "inline-block";
        cb.style.width = "16px";
        cb.style.height = "16px";
        wrap.createSpan({ text: ` ${assignee}` });

        const isChecked = !this.filterAssignees || this.filterAssignees.has(assignee);
        setIcon(cb, isChecked ? "check-circle" : "circle");
        
        // Store the assignee on the element for easy access
        cb.setAttribute("data-assignee", assignee);
        cb.setAttribute("data-checked", isChecked.toString());
        wrap.onclick = () => {
          const currentChecked = cb.getAttribute("data-checked") === "true";
          const newChecked = !currentChecked;
          
          cb.setAttribute("data-checked", newChecked.toString());
          setIcon(cb, newChecked ? "check-circle" : "circle");
          
          /* gather all check icons to compute new filter */
          const checkIcons = Array.from(assigneeDdEl!.querySelectorAll(".pm-dd-check"));
          const selected = checkIcons
            .filter(icon => icon.getAttribute("data-checked") === "true")
            .map(icon => icon.getAttribute("data-assignee")!);

          const newFilter =
            selected.length === assigneeList.length ? null : selected;

          this.updateAssigneeFilter(newFilter, this.filterAssigneeName ?? "");
        };
      });

      document.body.appendChild(assigneeDdEl);
      /* Position below the button, but prevent overflow */
      const r   = assigneeBtn.getBoundingClientRect();
      const pad = 4;                         // minimal margin from window edge

      let left = r.left;
      let top  = r.bottom + pad;             // default: below button

      /* Measure after insertion */
      const ddW = assigneeDdEl.offsetWidth  || 240;
      const ddH = assigneeDdEl.offsetHeight || 260;

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

      assigneeDdEl.style.left = `${left}px`;
      assigneeDdEl.style.top  = `${top}px`;
    };

    assigneeBtn.onclick = () => {
      if (assigneeDdOpen) {
        closeAssigneeDropdown();
        return;
      }
      assigneeDdOpen = true;
      setIcon(assigneeCaret, "chevron-up");

      /* Build assignee list from all tasks (before filtering) */
      const allTasks: any[] = [];
      this.cache.projects.forEach((project: any) => {
        // Apply project filter only
        if (this.filterPaths && !this.filterPaths.has(project.file.path)) {
          return;
        }
        
        // Add project metadata to tasks
        (project.tasks ?? []).forEach((task: any) => {
          task.projectName = project.file.basename;
          task.projectPath = project.file.path;
          allTasks.push(task);
        });
      });
      
      const assigneeSet = new Set<string>();
      allTasks.forEach(task => {
        const assignee = (task.assignee ?? task.props?.assignee ?? task.owner ?? task.props?.owner ?? "Unassigned").toString().trim();
        assigneeSet.add(assignee);
      });
      const assigneeList = Array.from(assigneeSet).sort();

      buildAssigneeDropdown(assigneeList);

      /* Close on outside click */
      const onDoc = (e: MouseEvent) => {
        if (assigneeDdEl && !assigneeDdEl.contains(e.target as Node) && e.target !== assigneeBtn) {
          closeAssigneeDropdown();
          document.removeEventListener("mousedown", onDoc);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", onDoc));
    };

    /* ── Collect data ───────────────────────── */
    const tasks = this.collectTasks();
    
    if (tasks.length === 0) {
      this.container.createEl("p", {
        text: "No tasks found. Try adjusting the project filter.",
        cls: "pm-no-data"
      });
      return;
    }

    /* ── Dashboard content container ───────────────────────── */
    const dashboardContent = this.container.createEl("div", { cls: "pm-dashboard-content" });
    
    /* ── Dashboard grid ───────────────────────── */
    const dashboardGrid = dashboardContent.createEl("div", { cls: "pm-dashboard-grid" });

    /* ── Handle focused chart view ───────────────────────── */
    if (this.focusedChart) {
      // Create layout for focused view
      dashboardGrid.style.gridTemplateColumns = "1fr 1fr";
      
      // Add back button in header
      const backBtn = dashboardContent.createEl("button", { cls: "pm-chart-back-btn" });
      const backIcon = backBtn.createSpan();
      setIcon(backIcon, "arrow-left");
      backBtn.createSpan({ text: " Back to All Charts" });
      backBtn.onclick = () => this.focusChart(null);
      backBtn.style.marginBottom = "20px";
      
      let focusedTitle = "";
      let focusedData: any = null;
      
      switch (this.focusedChart) {
        case 'status':
          focusedTitle = "Task Status Distribution";
          focusedData = this.createStatusChartData(tasks);
          break;
        case 'type':
          focusedTitle = "Task Type Distribution";
          focusedData = this.createTypeChartData(tasks);
          break;
        case 'assignee':
          focusedTitle = "Assignee Distribution";
          focusedData = this.createAssigneeChartData(tasks);
          break;
        case 'assignee-status':
          focusedTitle = "Assignee Status Distribution";
          focusedData = this.createAssigneeStatusChartData(tasks);
          break;
        case 'project':
          focusedTitle = "Project Distribution";
          focusedData = this.createProjectChartData(tasks);
          break;
      }
      
      // Main chart section
      const mainChartCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
      mainChartCard.createEl("h3", { text: focusedTitle });
      const focusedCanvas = mainChartCard.createEl("canvas", { cls: "pm-chart-canvas" });
      focusedCanvas.id = "focused-chart";
      
      // Use bar chart for assignee-status, pie chart for others
      if (this.focusedChart === 'assignee-status') {
        this.createBarChart(focusedCanvas, focusedData, focusedTitle);
      } else {
        this.createPieChart(focusedCanvas, focusedData, focusedTitle);
      }
      
      // Project summary breakdown section
      const projectSummaryCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
      projectSummaryCard.createEl("h3", { text: "Breakdown by Project" });
      this.renderProjectBreakdown(projectSummaryCard, tasks, this.focusedChart);
      
      // Project Status Bar Chart section (full width) - only for project distribution zoom
      if (this.focusedChart === 'project') {
        const projectStatusCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
        projectStatusCard.style.gridColumn = "1 / -1";
        projectStatusCard.createEl("h3", { text: "Project Status Distribution" });
        const projectStatusCanvas = projectStatusCard.createEl("canvas", { cls: "pm-chart-canvas" });
        projectStatusCanvas.id = "project-status-chart";
        const projectStatusData = this.createProjectStatusChartData(tasks);
        this.createBarChart(projectStatusCanvas, projectStatusData, "Tasks by Status per Project");
      }

      // Assignee per Project Bar Chart section (full width) - only for assignee distribution zoom
      if (this.focusedChart === 'assignee') {
        const assigneeProjectCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
        assigneeProjectCard.style.gridColumn = "1 / -1";
        assigneeProjectCard.createEl("h3", { text: "Assignee Distribution per Project" });
        const assigneeProjectCanvas = assigneeProjectCard.createEl("canvas", { cls: "pm-chart-canvas" });
        assigneeProjectCanvas.id = "assignee-project-chart";
        const assigneeProjectData = this.createAssigneeProjectChartData(tasks);
        this.createBarChart(assigneeProjectCanvas, assigneeProjectData, "Tasks by Assignee per Project");
      }

      // Assignee charts section (full width)
      const assigneeChartsCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
      assigneeChartsCard.style.gridColumn = "1 / -1";
      this.renderAssigneeBreakdown(assigneeChartsCard, tasks, this.focusedChart);
      
      return; // Exit early, don't show other charts
    }

    /* ── Task Status Chart ───────────────────────── */
    const statusCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
    const statusHeader = statusCard.createEl("div", { cls: "pm-chart-header" });
    statusHeader.createEl("h3", { text: "Task Status Distribution" });
    const statusZoomBtn = statusHeader.createEl("button", { cls: "pm-chart-zoom-btn" });
    const statusZoomIcon = statusZoomBtn.createSpan();
    setIcon(statusZoomIcon, "search");
    statusZoomBtn.onclick = () => this.focusChart('status');
    
    const statusCanvas = statusCard.createEl("canvas", { 
      cls: "pm-chart-canvas"
    });
    statusCanvas.id = "status-chart";
    
    const statusData = this.createStatusChartData(tasks);
    this.createPieChart(statusCanvas, statusData, "Task Status");

    /* ── Task Type Chart ───────────────────────── */
    const typeCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
    const typeHeader = typeCard.createEl("div", { cls: "pm-chart-header" });
    typeHeader.createEl("h3", { text: "Task Type Distribution" });
    const typeZoomBtn = typeHeader.createEl("button", { cls: "pm-chart-zoom-btn" });
    const typeZoomIcon = typeZoomBtn.createSpan();
    setIcon(typeZoomIcon, "search");
    typeZoomBtn.onclick = () => this.focusChart('type');
    
    const typeCanvas = typeCard.createEl("canvas", { 
      cls: "pm-chart-canvas"
    });
    typeCanvas.id = "type-chart";
    
    const typeData = this.createTypeChartData(tasks);
    this.createPieChart(typeCanvas, typeData, "Task Types");

    /* ── Assignee Chart ───────────────────────── */
    const assigneeCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
    const assigneeHeader = assigneeCard.createEl("div", { cls: "pm-chart-header" });
    assigneeHeader.createEl("h3", { text: "Assignee Distribution" });
    const assigneeZoomBtn = assigneeHeader.createEl("button", { cls: "pm-chart-zoom-btn" });
    const assigneeZoomIcon = assigneeZoomBtn.createSpan();
    setIcon(assigneeZoomIcon, "search");
    assigneeZoomBtn.onclick = () => this.focusChart('assignee');
    
    const assigneeCanvas = assigneeCard.createEl("canvas", { 
      cls: "pm-chart-canvas"
    });
    assigneeCanvas.id = "assignee-chart";
    
    const assigneeData = this.createAssigneeChartData(tasks);
    this.createPieChart(assigneeCanvas, assigneeData, "Tasks per Assignee");

    /* ── Project Chart ───────────────────────── */
    const projectCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
    const projectHeader = projectCard.createEl("div", { cls: "pm-chart-header" });
    projectHeader.createEl("h3", { text: "Project Distribution" });
    const projectZoomBtn = projectHeader.createEl("button", { cls: "pm-chart-zoom-btn" });
    const projectZoomIcon = projectZoomBtn.createSpan();
    setIcon(projectZoomIcon, "search");
    projectZoomBtn.onclick = () => this.focusChart('project');
    
    const projectCanvas = projectCard.createEl("canvas", { 
      cls: "pm-chart-canvas"
    });
    projectCanvas.id = "project-chart";
    
    const projectData = this.createProjectChartData(tasks);
    this.createPieChart(projectCanvas, projectData, "Tasks per Project");

    /* ── Assignee Status Chart ───────────────────────── */
    const assigneeStatusCard = dashboardGrid.createEl("div", { cls: "pm-chart-card" });
    const assigneeStatusHeader = assigneeStatusCard.createEl("div", { cls: "pm-chart-header" });
    assigneeStatusHeader.createEl("h3", { text: "Assignee Status Distribution" });
    const assigneeStatusZoomBtn = assigneeStatusHeader.createEl("button", { cls: "pm-chart-zoom-btn" });
    const assigneeStatusZoomIcon = assigneeStatusZoomBtn.createSpan();
    setIcon(assigneeStatusZoomIcon, "search");
    assigneeStatusZoomBtn.onclick = () => this.focusChart('assignee-status');
    
    const assigneeStatusCanvas = assigneeStatusCard.createEl("canvas", { 
      cls: "pm-chart-canvas"
    });
    assigneeStatusCanvas.id = "assignee-status-chart";
    
    const assigneeStatusData = this.createAssigneeStatusChartData(tasks);
    this.createBarChart(assigneeStatusCanvas, assigneeStatusData, "Tasks by Status per Assignee");

    /* ── Summary Stats ───────────────────────── */
    const summaryCard = dashboardGrid.createEl("div", { cls: "pm-summary-card" });
    const summaryTitle = summaryCard.createEl("h3", { text: "Summary" });
    
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(isTaskDone).length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const summaryStats = summaryCard.createEl("div", { cls: "pm-summary-stats" });
    const totalTasksDiv = summaryStats.createEl("div", { 
      cls: "pm-stat-item"
    });
    totalTasksDiv.createEl("strong", { text: "Total Tasks: " });
    totalTasksDiv.createEl("span", { text: `${totalTasks}` });
    
    const completedTasksDiv = summaryStats.createEl("div", { 
      cls: "pm-stat-item"
    });
    completedTasksDiv.createEl("strong", { text: "Completed: " });
    completedTasksDiv.createEl("span", { text: `${completedTasks}` });
    
    const completionRateDiv = summaryStats.createEl("div", { 
      cls: "pm-stat-item"
    });
    completionRateDiv.createEl("strong", { text: "Completion Rate: " });
    completionRateDiv.createEl("span", { text: `${completionRate}%` });
    
    const uniqueProjects = new Set(tasks.map(t => t.projectName)).size;
    const uniqueAssignees = new Set(tasks.map(t => 
      (t.assignee ?? t.props?.assignee ?? t.owner ?? t.props?.owner ?? "Unassigned").toString().trim()
    )).size;
    
    const projectsDiv = summaryStats.createEl("div", { 
      cls: "pm-stat-item"
    });
    projectsDiv.createEl("strong", { text: "Projects: " });
    projectsDiv.createEl("span", { text: `${uniqueProjects}` });
    
    const assigneesDiv = summaryStats.createEl("div", { 
      cls: "pm-stat-item"
    });
    assigneesDiv.createEl("strong", { text: "Assignees: " });
    assigneesDiv.createEl("span", { text: `${uniqueAssignees}` });
  }
}
