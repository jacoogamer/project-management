import { App, TFile, ListItemCache, CachedMetadata } from "obsidian";
import { PmSettings } from "../../settings";
import type ProjectManagementPlugin from "../main";

/** One milestone row extracted from a Markdown table */
export interface Milestone {
  id: string;
  title: string;
  date: string;      // ISO YYYY-MM-DD
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
export class ProjectCache {
  private app: App;
  private plugin: ProjectManagementPlugin; // Reference to the main plugin instance

  /** Dev‑tools helpers: dumpRows, dumpHeaders */
  public _debug: {
    dumpRows: (path: string) => Promise<void>;
    dumpHeaders: (path: string) => Promise<void>;
  };

  /** path → project entry */
  public projects = new Map<string, ProjectEntry>();

  /** blockId → task (quick lookup for DnD, status moves, etc.) */
  public tasks = new Map<string, TaskItem>();

  /** Global milestone list (across all project notes) */
  public milestones: Milestone[] = [];

  /** simple event system so views can react to changes  */
  private listeners = new Set<() => void>();

  /** Compose a unique key from vault‑path + task id (lower‑cased) */
  private makeTaskKey(filePath: string, id: string): string {
    return `${filePath.toLowerCase()}::${id.toLowerCase()}`;
  }
  constructor(app: App, plugin: ProjectManagementPlugin) {
    this.app = app;
    this.plugin = plugin;

    /* ── dev‑tools helper ───────────────────────────────────────────── *
     * In DevTools you can now run:
     *   pmPlugin.cache._debug.dumpRows("path/to/file.md")
     *   pmPlugin.cache._debug.dumpHeaders("path/to/file.md")
     * ---------------------------------------------------------------- */
    this._debug = {
      /** Print every pipe‑table row that contains a checkbox bullet */
      dumpRows: async (filePath: string) => {
        const file = this.app.vault.getFileByPath(filePath);
        if (!file || !(file instanceof TFile)) return;
        const lines = (await this.app.vault.read(file)).split("\n");
        lines
          .filter(l => /^\s*\|.*-\s*\[[ xX/]\]/.test(l))

      },

      /** Show the header cells Obsidian thinks this table has */
      dumpHeaders: async (filePath: string) => {
        const file = this.app.vault.getFileByPath(filePath);
        if (!file || !(file instanceof TFile)) return;
        const lines = (await this.app.vault.read(file)).split("\n");
        const hdr = lines.find(l => /^\s*\|\s*id\s*\|/i.test(l));
        if (!hdr) return;
        const cells = hdr.split("|").map(c => c.replace(/\u00A0/g," ").trim());

      },
    };
  }

  /** Subscribe – returns an unsubscribe fn */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private notify() {
    this.listeners.forEach((f) => f());
  }

  /** Full vault scan – call on plugin load & on 'metadata-resolved' */
  async reindex() {
    this.projects.clear();
    this.tasks.clear();
    this.milestones = [];

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const meta = this.app.metadataCache.getFileCache(file);
      const flag = this.plugin.settings.projectFlagProperty || "project";
      if (!meta?.frontmatter || !meta.frontmatter[flag]) continue;

      const fileLines = (await this.app.vault.read(file)).split("\n");

      const tasks: TaskItem[] = [];

meta.listItems?.forEach((item: any) => {
  /* -----------------------------------------------------------
     Recognise tasks that live *inside* Markdown tables.
     Obsidian's `item.task` is undefined for those, so fall back
     to a regex on the source line.
  ----------------------------------------------------------- */
  const firstLineRaw = fileLines[item.position.start.line] ?? "";
  // Accept [ ], [x], [X], or [/] for open/in-progress/done states
  const tableTaskMatch = /^\s*\|.*-\s*\[[ xX/]\]/.test(firstLineRaw);

  if (!item.task && !tableTaskMatch) return;        // not a task at all

  /* ---------- pull the full list-item block (can span multiple lines) ---------- */
  const startIdx = item.position.start.line;
  const endIdx   = (item.position.end?.line ?? startIdx);
  let rawBlock   = fileLines.slice(startIdx, endIdx + 1).join("\n");

  // Normalize whitespace + NBSP
  rawBlock = rawBlock.replace(/\u00A0/g, " ").replace(/\s+\n/g, "\n");

  // First line (with checkbox) for props parsing
  const firstLine = fileLines[startIdx] ?? "";

  const props: Record<string, string> = {};
  /* ---------- collect props ---------- */
  // 1) attributes array provided by Obsidian (may be stale immediately after edit)
  (item.attributes ?? []).forEach((attr: any) => {
    props[attr.key.toLowerCase()] = String(attr.value);
  });

  // 2) Parse inline props anywhere in the *table row*, even after a pipe.
  //    We join the first line of the row (which contains all cells) with
  //    the full list‑item block so props on continuation lines still count.
  //
  //    Reg‑exp stops at whitespace **or** a pipe, so
  //      due:: 2025-07-31 |
  //    is captured as due ⇒ 2025-07-31
  //
  const rowText = fileLines[startIdx] ?? "";
  [...rowText.matchAll(/([A-Za-z0-9_-]+)::\s*([^|\n]+)/g)]
    .forEach(([, k, v]) => (props[k.toLowerCase()] = v.trim()));

  // 2b) If this list‑item lives inside a pipe table, pull the “Description” cell
  if (rowText.includes("|")) {
    const cells = rowText.split("|").map(c => c.replace(/\u00A0/g, " ").trim());
    if (cells.length && cells[0] === "") cells.shift();                    // leading pipe
    if (cells.length && cells[cells.length - 1] === "") cells.pop();       // trailing pipe
    /* Heuristic: walk from right to left until we find the first non‑date cell */
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (let i = cells.length - 1; i >= 2; i--) {  // skip ID + Summary columns
      const cand = cells[i];
      if (cand && !dateRe.test(cand)) {
        props["description"] = cand;
        break;
      }
    }
  }

  // 3) Parse Tasks plugin emoji dates (🔜 ⏳ 📅 ✅ 🛫) – tolerate NBSPs, tabs, newlines
  [...rawBlock.matchAll(/([🔜⏳📅✅🛫])\uFE0F?[\u00A0 \t\r\n]*([0-9]{4}-[0-9]{2}-[0-9]{2})/gu)]
    .forEach(([, icon, date]) => {
      let d = date.trim();  // strip trailing NBSP/newlines
      switch (icon) {
        case "🔜":   // start
        case "⏳":   // scheduled
        case "🛫":   // plane takeoff as start
          props["start"] = d;
          break;
        case "📅":   // due
          props["due"] = d;
          break;
        case "✅":   // done / completion
          props["done"] = d;
          break;
      }
    });

  /* ---------- dependency list ---------- */
  const depends: string[] = [];
  const depAttr = props["depends"];
  if (depAttr) {
    depAttr.split(/[, ]+/).forEach((d) => {
      const id = d.replace(/^\^/, "").trim().toLowerCase();
      if (id) depends.push(id);
    });
  }

  /* ---------- derive text, checked, and status ---------- */
  const stripped = rawBlock
    .replace(/^\s*\|?\s*/g, "")            // drop leading pipe / whitespace
    .replace(/^\s*-\s*\[[\sxX/]\]\s*/, "")  // remove leading checkbox (now includes /)
    .replace(/(\w+)::\s*[^\s]+/g, "")      // drop inline props
    .trim();
  // Only [x] or [X] is checked; [/] is in-progress but not checked
  const isChecked =
    Boolean(item.task?.checked) || /\-\s*\[[xX]\]/.test(firstLineRaw);
  // Status: [x] or [X] = done, [/] = in-progress, [-] = on-hold, else not-started
  let status: "not-started" | "in-progress" | "on-hold" | "done";
  if (/\-\s*\[[xX]\]/.test(firstLineRaw)) {
    status = "done";
  } else if (/\-\s*\[\/\]/.test(firstLineRaw)) {
    status = "in-progress";
  } else if (/\-\s*\[\-\]/.test(firstLineRaw)) {
    status = "on-hold";
  } else {
    status = "not-started";
  }

  /* ---------- assemble task ---------- */
  const task: TaskItem = {
    id: item.id ?? `${file.path}-${item.position?.start?.line}`,
    file,
    line: item.position.start.line,
    text: stripped || "(no text)",
    props,
    checked: isChecked,
    depends,
    status,
  };

  tasks.push(task);
  this.tasks.set(this.makeTaskKey(file.path, task.id), task);
});

/* ============================================================
   Fallback: Obsidian’s metadataCache skips tasks inside tables
   in some versions.  Scan each line for a checklist bullet
   inside a table row that we haven’t already collected.
============================================================ */
fileLines.forEach((line, idx) => {
  // pattern: | … - [ ] … |, allow [ ], [x], [X], [/], [-] for all statuses
  if (!/^\s*\|.*-\s*\[[ xX/\\-]\]/.test(line)) return;

  // avoid duplicates (if future versions start emitting listItems)
  if (tasks.find(t => t.line === idx)) return;

  const props: Record<string, string> = {};

  // capture inline props across the row
  [...line.matchAll(/([A-Za-z0-9_-]+)::\s*([^|\n]+)/g)]
    .forEach(([, k, v]) => (props[k.toLowerCase()] = v.trim()));

  // Also capture the “Description” cell from this pipe row
  if (line.includes("|")) {
    const cells = line.split("|").map(c => c.replace(/\u00A0/g, " ").trim());
    if (cells.length && cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    for (let i = cells.length - 1; i >= 2; i--) {
      const cand = cells[i];
      if (cand && !dateRe.test(cand)) {
        props["description"] = cand;
        break;
      }
    }
  }

  /* ---------- dependency list ---------- */
  const depends: string[] = [];
  const depAttr = props["depends"];
  if (depAttr) {
    depAttr.split(/[, ]+/).forEach((d) => {
      const id = d.replace(/^\^/, "").trim().toLowerCase();
      if (id) depends.push(id);
    });
  }

  const cells = line.split("|").map(c => c.trim());

  // derive checked state, status, and stripped text
  // Only [x] or [X] is checked; [/] is in-progress but not checked
  const isChecked = /\-\s*\[[xX]\]/.test(line);
  let status: "not-started" | "in-progress" | "on-hold" | "done";
  if (/\-\s*\[[xX]\]/.test(line)) {
    status = "done";
  } else if (/\-\s*\[\/\]/.test(line)) {
    status = "in-progress";
  } else if (/\-\s*\[\-\]/.test(line)) {
    status = "on-hold";
  } else {
    status = "not-started";
  }
  const stripped  = line
    .replace(/^\s*\|.*?-\s*\[[\sxX\/\-]\]\s*/, "")   // from bullet to first cell (now includes / and -)
    .replace(/\|.*/, "")                         // drop remaining cells
    .replace(/(\w+)::\s*[^|]+/g, "")             // drop inline props
    .trim();

  /* -------------------------------------------------------------
     Block‑ID precedence for table rows
     1. Caret at end of row  (^s-1)
     2. First column text    (e.g. "S-1", "SB-3", "E-1")
     3. Fallback synthetic   (file‑path + line)
  ------------------------------------------------------------- */
  // #1 caret suffix
  let id: string | undefined;
  const caretMatch = line.match(/\^([A-Za-z0-9_-]+)\s*$/);
  if (caretMatch) id = caretMatch[1];

  // #2 ID column
  if (!id) {
    const idCell = line.match(/^\s*\|\s*([A-Za-z0-9_-]+)\s*\|/);
    if (idCell) id = idCell[1];
  }

  // #3 synthetic fallback
  if (!id) id = `${file.path}-row-${idx}`;

  id = id.toLowerCase();   // ensure consistent matching for depends arrows

  const task: TaskItem = {
    id,
    file,
    line: idx,
    text: stripped || "(no text)",
    props,
    checked: isChecked,
    depends,
    status,
  };

  tasks.push(task);
  this.tasks.set(this.makeTaskKey(file.path, task.id), task);

  /* ---------- collect Milestones table (ID | Title | Date ...) ---------- */
  fileLines.forEach((line, idx) => {
    // Detect header row
    if (!/^\s*\|/.test(line)) return; // must start with pipe
    if (!/\bDate\b/i.test(line)) return; // includes "Date"
    if (!/\bTitle\b/i.test(line)) return; // includes "Title"

    // iter subsequent rows until blank / no pipe
    for (let r = idx + 1; r < fileLines.length; r++) {
      const row = fileLines[r];
      if (!/^\s*\|/.test(row)) break;       // end of table

      const cells = row.split("|").map(c => c.trim());
      if (cells.length < 4) continue;

      const id    = cells[1] ?? "";
      const title = cells[2] ?? "";
      const date  = cells[3] ?? "";
      const desc  = cells[4] ?? "";

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      this.milestones.push({ id, title, date, desc, file: file.path });
    }
  });
});

      const done = tasks.filter((t) => t.checked).length;
      const percentComplete = tasks.length === 0 ? 1 : done / tasks.length;

      // compute nearest open due date
      let nextDue: string | undefined;
      tasks.forEach((t) => {
        const due = t.props[this.plugin.settings.dueProperty];
        if (due && !t.checked && (!nextDue || due < nextDue)) nextDue = due;
      });

      this.projects.set(file.path, { file, tasks, percentComplete, nextDue });
    }

    this.notify();
  }

  // ---------- helpers ----------------------------------------------------

  getProject(filePath: string): ProjectEntry | undefined {
    return this.projects.get(filePath);
  }

  /**
   * Get a task by raw id. If duplicate IDs exist, returns the *first* match.
   * Prefer makeTaskKey(file,id) when you know the file path.
   */
  getTask(taskId: string): TaskItem | undefined {
    // direct hit with composite key
    if (this.tasks.has(taskId)) return this.tasks.get(taskId);
    // else fall back: scan by id suffix
    for (const [key, task] of this.tasks) {
      if (key.endsWith(`::${taskId.toLowerCase()}`)) return task;
    }
    return undefined;
  }

  /**
   * Update a task’s metadata & persist to disk.
   * Only supports simple inline attributes for now (e.g. `due:: 2025-08-01`).
   */
  async updateTask(
    taskId: string,
    changes: Partial<
      TaskItem["props"] & { checked?: boolean; text?: string }
    >
  ) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const fileText = await this.app.vault.read(task.file);
    const lines = fileText.split("\n");
    let line = lines[task.line];

    // Checkbox state
    if (typeof changes.checked === "boolean") {
      line = line.replace(
        /^\s*-\s*\[[ xX]\]/,
        `- [${changes.checked ? "x" : " "}]`
      );
      task.checked = changes.checked;
    }
    // Raw text
    if (changes.text !== undefined) {
      line = line.replace(/\](.*?)(\^\w+)?$/, `] ${changes.text} ${task.id}`);
      task.text = changes.text;
    }

    // Inline props
    const propKeys = Object.keys(changes).filter(
      (k) => k !== "checked" && k !== "text"
    );
    if (propKeys.length) {
      const nextLineIdx = task.line + 1;
      let attrLine = lines[nextLineIdx] ?? "";
      propKeys.forEach((k) => {
        const val = changes[k as keyof typeof changes];
        if (val === undefined) return;
        const regex = new RegExp(`${k}::\\s*[^\\s]+`);
        if (regex.test(attrLine)) {
          attrLine = attrLine.replace(regex, `${k}:: ${val}`);
        } else {
          attrLine += `  ${k}:: ${val}`;
        }
        task.props[k] = val;
      });
      lines[nextLineIdx] = attrLine;
    }

    // Write file back & refresh cache
    lines[task.line] = line;
    await this.app.vault.modify(task.file, lines.join("\n"));
    await this.reindex();
  }

  /**
   * Convenience: move task to a new status value.
   * Relies on a scalar `status` property key in settings.
   */
  async moveTaskToStatus(taskId: string, status: string) {
    await this.updateTask(taskId, { [this.plugin.settings.statusProperty]: status });
  }
}
