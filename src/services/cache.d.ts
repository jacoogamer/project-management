import { App, TFile } from "obsidian";
/** One milestone row extracted from a Markdown table */
export interface Milestone {
    id: string;
    title: string;
    date: string;
    desc?: string;
    /** vault‑relative path of the note that owns this milestone row */
    file: string;
}
/** A single markdown checkbox (task) inside any project note */
export interface TaskItem {
    /** Obsidian-generated block id (e.g. ^abc123) – unique inside a vault  */
    id: string;
    file: TFile;
    line: number;
    text: string;
    props: Record<string, string>;
    checked: boolean;
    /** block IDs this task depends on (parsed from `depends:: ^id1, ^id2`) */
    depends: string[];
    /**
     * Status of the task, derived from checkbox:
     * - "not-started": [ ]
     * - "in-progress": [/]
     * - "on-hold": [-]
     * - "done": [x] or [X]
     */
    status: "not-started" | "in-progress" | "on-hold" | "done";
}
/** Aggregated data for one project note */
export interface ProjectEntry {
    file: TFile;
    tasks: TaskItem[];
    /** 0 ⇢ 1 numeric ratio */
    percentComplete: number;
    /** ISO date of the next open task or undefined */
    nextDue?: string;
    /** Number of completed tasks in the project (dashboard) */
    completedTasks?: number;
    /** Total number of tasks in the project (dashboard) */
    totalTasks?: number;
}
/**
 * Central in-memory index of every project & task.
 * All UI views should read from here instead of scanning metadata directly.
 */
export declare class ProjectCache {
    private app;
    private plugin;
    /** Dev‑tools helpers: dumpRows, dumpHeaders */
    _debug: {
        dumpRows: (path: string) => Promise<void>;
        dumpHeaders: (path: string) => Promise<void>;
    };
    /** path → project entry */
    projects: Map<string, ProjectEntry>;
    /** blockId → task (quick lookup for DnD, status moves, etc.) */
    tasks: Map<string, TaskItem>;
    /** Global milestone list (across all project notes) */
    milestones: Milestone[];
    /** simple event system so views can react to changes  */
    private listeners;
    /** Compose a unique key from vault‑path + task id (lower‑cased) */
    private makeTaskKey;
    constructor(app: App, plugin: any);
    /** Subscribe – returns an unsubscribe fn */
    onChange(cb: () => void): () => void;
    private notify;
    /** Full vault scan – call on plugin load & on 'metadata-resolved' */
    reindex(): Promise<void>;
    getProject(filePath: string): ProjectEntry | undefined;
    /**
     * Get a task by raw id. If duplicate IDs exist, returns the *first* match.
     * Prefer makeTaskKey(file,id) when you know the file path.
     */
    getTask(taskId: string): TaskItem | undefined;
    /**
     * Update a task’s metadata & persist to disk.
     * Only supports simple inline attributes for now (e.g. `due:: 2025-08-01`).
     */
    updateTask(taskId: string, changes: Partial<TaskItem["props"] & {
        checked?: boolean;
        text?: string;
    }>): Promise<void>;
    /**
     * Convenience: move task to a new status value.
     * Relies on a scalar `status` property key in settings.
     */
    moveTaskToStatus(taskId: string, status: string): Promise<void>;
}
