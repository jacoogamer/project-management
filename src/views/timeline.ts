import { ItemView, WorkspaceLeaf, MarkdownView, moment, setIcon, Notice, Modal, TFile } from "obsidian";
import type { ViewStateResult } from "obsidian";
// Load timeline-specific stylesheet
import "../../styles/styles-timeline.css";
/** Simple text-input modal for YYYY-MM-DD dates */
class DatePromptModal extends Modal {
  private label: string;
  private current: string;
  private resolve: ((val: string | null) => void) | null = null;

  constructor(app: any, label: string, current: string) {
    super(app);
    this.label = label;
    this.current = current ?? "";
  }

  openWithPromise(): Promise<string | null> {
    this.open();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Set ${this.label} date` });
    const desc = contentEl.createEl("div", { text: "Enter a date (YYYY-MM-DD). Leave blank to clear." });
    desc.style.marginBottom = "0.7em";
    const input = contentEl.createEl("input", { type: "text" });
    input.value = this.current;
    input.placeholder = "YYYY-MM-DD";
    input.style.width = "100%";
    input.style.marginBottom = "0.7em";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.submit(input.value);
      } else if (e.key === "Escape") {
        this.closeWith(null);
      }
    });
    setTimeout(() => input.focus(), 50);
    const btnRow = contentEl.createEl("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "0.5em";
    btnRow.style.justifyContent = "flex-end";
    const okBtn = btnRow.createEl("button", { text: "OK" });
    okBtn.onclick = () => this.submit(input.value);
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.closeWith(null);
  }

  submit(val: string) {
    const clean = val.trim();
    if (clean === "") {
      this.closeWith("");
      return;
    }
    // @ts-ignore callable moment
    const d = (moment as any)(clean, "YYYY-MM-DD", true);
    if (!d.isValid()) {
      new Notice("Invalid date. Use YYYY-MM-DD.");
      return;
    }
    this.closeWith(clean);
  }

  closeWith(val: string | null) {
    if (this.resolve) this.resolve(val);
    this.close();
  }
}

/** Discrete zoom stops (px per day) shown in the slider */
const ZOOM_STOPS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
import type { ProjectCache, TaskItem } from "../services/cache";
import ProjectManagementPlugin from "../main";


/** ── Simple drag context for Alt‑drag bar move or resize ───────────────── */
interface DragContext {
  barEl: HTMLElement;
  startClientX: number;
  originalDayOffset: number;
  originalSpan: number;          // durationDays when drag started
  taskPath: string;
  mode: "move" | "resize-left" | "resize-right";
}
let currentDrag: DragContext | null = null;

/** Drag context for a project‑level bar (YAML Start/End) */
interface ProjDragContext {
  barEl: HTMLElement;
  startClientX: number;
  originalStart: number;      // projStart at drag start
  originalWidth: number;      // bar width at drag start (for resizing)
  mode: "move" | "resize-left" | "resize-right";
  projectPath: string;        // full file path (for YAML update)
}
let currentProjDrag: ProjDragContext | null = null;

export const VIEW_TYPE_PM_TIMELINE = "pm-timeline-view";

/**
 * Basic project Timeline / Gantt view.
 * Displays one row per project and a 1‑day bar for each task with a `due` date.
 */
export class TimelineView extends ItemView {
  private cache: ProjectCache;
  private detachFn: (() => void) | null = null;
  private pluginInst: ProjectManagementPlugin | null = null;

  /** Heat‑map layer element (created lazily) */
  private heatLayerEl: HTMLElement | null = null;

  /** True if a render is already queued for the next animation frame */
  private renderQueued = false;

  /** User‑resizable width of the project‑name column (pixels) */
  private labelWidth = 400;    // start at maximum width
  private sortAsc = true;        // toggle project sort order
  /** Pixels per day — initialised from settings (must be a valid zoom stop) */
  private zoomPxPerDay = (() => {
    const saved =
      (this.app as any).plugins.plugins["project-management"]?.settings
        ?.zoomPxPerDay as number | undefined;
    return ZOOM_STOPS.includes(saved ?? -1) ? saved! : ZOOM_STOPS[1]; // default 4
  })();
  /** true while a zoom drag has a render queued */
  private zoomRenderScheduled = false;

  /** Remember scroll offsets between renders triggered externally */
  private pendingScroll: { v: number; h: number } | null = null;

  /** Projects whose task list is currently collapsed */
  private collapsed = new Set<string>();
  /** Projects manually hidden via the per‑project eye icon */
  private hiddenProjects = new Set<string>();

  /** Optional set of project file paths to display (injected by Portfolio view) */
  private filterPaths?: Set<string>;
  /** Optional name of the portfolio that opened this timeline */
  private filterName?: string;

  /** Keeps the vertical splitter height in sync with pane resize */
  private splitterRO: ResizeObserver | null = null;
  
  constructor(
    leaf: WorkspaceLeaf,
    cache: ProjectCache,
    plugin?: ProjectManagementPlugin
  ) {
    super(leaf);
    this.cache      = cache;
    this.pluginInst = plugin ?? null;
  }
  /**
   * Obsidian calls setState when the view is first loaded or when
   * leaf.setViewState({...state}) is invoked. Capture `filterProjects`
   * so we can filter the timeline rows.
   */
  async setState(state: any, result: ViewStateResult): Promise<void> {
    if (state?.filterProjects && Array.isArray(state.filterProjects)) {
      this.filterPaths = new Set(state.filterProjects as string[]);
    } else {
      this.filterPaths = undefined;
    }
    if (typeof state?.filterName === "string" && state.filterName.trim() !== "") {
      this.filterName = state.filterName.trim();
    } else {
      this.filterName = undefined;
    }
    // No special history handling; just re‑render
    this.render();
  }
  /** Handy accessor that falls back to global plugin lookup. */
  private get plugin() {
    return (
      this.pluginInst ??
      (this.app as any).plugins.plugins["project-management"]
    );
  }

  getViewType() {
    return VIEW_TYPE_PM_TIMELINE;
  }
  getDisplayText() {
    return this.filterName
      ? `Timeline – ${this.filterName}`
      : "Timeline";
  }
  /** Display the same icon used in the ribbon ("calendar-clock"). */
  getIcon(): string {
    return "calendar-clock";
  }

  async onOpen() {
    this.render();
    // live refresh on cache updates
    this.detachFn = this.cache.onChange(() => this.saveAndRender());
  }
  /** Allow Portfolio view to refresh the project filter at runtime */
  public updateFilter(paths: string[], name?: string) {
    this.filterPaths = new Set(paths);
    this.filterName  = name;
    this.render();
  }

  async onClose() {
    this.detachFn?.();
    this.splitterRO?.disconnect();
    this.splitterRO = null;
  }

  /**
   * Opens the given markdown file (re‑uses current leaf) and scrolls to the
   * specified block reference (`^id`). It first tries the rendered element;
   * if that never appears within 1.2 s, it falls back to scrolling the editor
   * to the provided line number.
   */
  private openAndScroll(path: string, blockId: string, line?: number) {
    const target = `${path}#^${blockId}`;

    // Open (or jump) in current leaf
    this.app.workspace.openLinkText(target, "", false);

    // Try until success or timeout
    const startTime = Date.now();
    const tryScroll = () => {
      const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!mdView) {
        requestAnimationFrame(tryScroll);
        return;
      }

      const el = mdView.containerEl.querySelector(`[id="${blockId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });

        /* --- temporary highlight so the user sees the target task --- */
        el.classList.add("pm-scroll-highlight");
        setTimeout(() => el.classList.remove("pm-scroll-highlight"), 2000);

        return; // success
      }

      const elapsed = Date.now() - startTime;
      if (elapsed < 1200) {
        requestAnimationFrame(tryScroll);
      } else if (line != null && mdView.editor) {
        // Fallback: ensure the editor scrolls even if the element never rendered
        mdView.editor.scrollIntoView(
          { from: { line, ch: 0 }, to: { line: line + 1, ch: 0 } },
          true
        );
      }
    };

    requestAnimationFrame(tryScroll);
  }

  private render() {
    const el = this.containerEl;
    /* Make sure only one observer is active */
    this.splitterRO?.disconnect();
    this.splitterRO = null;
    
    /* Remove any floating tooltip from a previous render */
    document.querySelectorAll(".pm-dash-tooltip").forEach(el => el.remove());
    /* ── Shared tooltip reused by every bar ───────────────────────────── */
    let barTip: HTMLElement | null = null;
    const showBarTip = (html: string, rect: DOMRect) => {
      /* Create or reuse floating tooltip element */
      if (!barTip || !document.body.contains(barTip)) {
        barTip?.remove();
        barTip = document.createElement("div");
        barTip.className = "pm-dash-tooltip";
        document.body.appendChild(barTip);
      }
      barTip.innerHTML = html;

      const pad = 8;
      const w   = barTip.offsetWidth;
      /* Horizontal clamp */
      let left = rect.right + pad;
      if (left + w > window.innerWidth - pad) {
        left = Math.max(rect.left - pad - w, pad);
      }

      /* Vertical clamp */
      const h   = barTip.offsetHeight;
      let top   = Math.max(rect.top, 48);              // keep below sticky header
      if (top + h > window.innerHeight - pad) {
        top = Math.max(window.innerHeight - h - pad, 48);
      }

      barTip.style.left = `${left}px`;
      barTip.style.top  = `${top}px`;
    };
    const hideBarTip = () => { barTip?.remove(); barTip = null; };
    /* Generic hover helper for icons (re‑uses showBarTip / hideBarTip) */
    const attachTip = (el: HTMLElement, text: string) => {
      el.addEventListener("mouseenter", (ev) => {
        const m = ev as MouseEvent;
        const fakeRect = {
          left:   m.clientX,
          right:  m.clientX,
          top:    m.clientY + 6,      // ↓ nudge
          bottom: m.clientY + 6,
          width:  0,
          height: 0,
        } as DOMRect;
        showBarTip(`<span>${text}</span>`, fakeRect);
      });
      el.addEventListener("mouseleave", hideBarTip);
    };
    /* Pull updated default zoom from settings in case the user changed it via Settings */
    this.zoomPxPerDay = this.plugin.settings.zoomPxPerDay ?? this.zoomPxPerDay;
    /* Capture scroll offsets of existing layout */
    const prevRight = this.containerEl.querySelector<HTMLElement>(".pm-tl-right");
    const restoreScroll = this.pendingScroll ?? {
      v: prevRight?.scrollTop ?? 0,
      h: prevRight?.scrollLeft ?? 0,
    };
    el.empty();
    /* ---------- sticky top header that holds the zoom slider ---------- */
    const topHeader = this.containerEl.createEl("div", { cls: "pm-tl-topheader" });
    /* ── global project-column controls (eye, sort-chevron, fold-all) ── */
    const topControls = topHeader.createEl("div", { cls: "pm-top-controls" });
    /* Ensure top‑controls (eye, fold, calendar icons, etc.) sit above zoomWrap */
    topControls.style.position = "relative";
    topControls.style.zIndex = "8";    // zoomWrap uses z‑index 6
    
    /* Right-hand timeline controls (all icons) */
    const rightControls = topHeader.createEl("div", { cls: "pm-top-right" });
    rightControls.style.position   = "absolute";
    rightControls.style.zIndex     = "8";
    
    // Helper: keep the icon block exactly 8 px to the right of the splitter
    const alignIcons = () => {
      const splitRect  = globalSplit.getBoundingClientRect();
      const headerRect = topHeader.getBoundingClientRect();
      const off        = splitRect.left - headerRect.left + 8; // 8-px gap
      rightControls.style.left = `${off}px`;
    };
    
    // heat‑map element was removed by .empty(); reset so next render re‑creates it
    this.heatLayerEl = null;
    // Remove any lingering arrow-layer SVG from an earlier render
    this.containerEl.querySelectorAll("svg.pm-arrow-layer").forEach(svg => svg.remove());

    // Remove global offset on topControls (if present)
    // topControls.style.marginLeft = `${this.labelWidth}px`;

    // ── outer flex container ─────────────
    const outer = el.createEl("div", { cls: "pm-tl-outer" });
    outer.style.position = "relative";   // so absolutely‑positioned children (splitter) anchor here
    outer.style.height   = "100%";

    /** Store bar geometry for dependency arrows */
    const barsById: Record<string, { x: number; w: number; el: HTMLElement }> = {};
    /** Task lookup so we can check project equality when drawing arrows */
    const tasksById = new Map<string, TaskItem>();
    /** Helper: strip leading ^ and force lower‑case for reliable matching */
    const norm = (raw: string) => raw.replace(/^\^/, "").trim().toLowerCase();

    const key = (taskOrId: TaskItem | string, filePath?: string) =>
          (typeof taskOrId === "string"
          ? filePath! + "::" + norm(taskOrId)
          : taskOrId.file.path + "::" + norm(taskOrId.id));

    /** Return a description for a task using a three‑step, robust heuristic. */
    const getDescription = (t: TaskItem): string => {
      /* 1️⃣  Any prop whose key (after trimming NBSP/space and lower‑casing)
             equals "description" */
      for (const [rawK, rawV] of Object.entries(t.props)) {
        const k = rawK.replace(/\u00A0/g, " ").trim().toLowerCase();
        if (k === "description") {
          const v = rawV.replace(/\u00A0/g, " ").trim();
          if (v) return v;
        }
      }

      /* 2️⃣  Table‑row heuristic: capture the cell under the "Description" column.
             We assume the first cell holds the ID, so try cell[1] first; if that
             looks like a date or is blank, fall back to scanning right‑to‑left
             for the first non‑date cell. */
      if (t.text.includes("|")) {
        const cells = t.text.split("|").map(s => s.replace(/\u00A0/g, " ").trim());
        if (cells.length && cells[0] === "") cells.shift();           // leading pipe
        if (cells.length && cells[cells.length - 1] === "") cells.pop(); // trailing pipe

        const dateRe = /^\d{4}-\d{2}-\d{2}$/;

        /* Prefer the cell immediately after the ID (index 1) */
        if (cells.length >= 2) {
          const cand = cells[1];
          if (cand && !dateRe.test(cand)) return cand;
        }

        /* Fallback: walk from right to left, pick first non‑date, non‑blank cell */
        for (let i = cells.length - 1; i >= 0; i--) {
          const cell = cells[i];
          if (cell && !dateRe.test(cell)) return cell;
        }
      }

      /* 3️⃣  Extra lines under the checkbox bullet */
      const lines = t.text
        .split("\n")
        .slice(1)
        .map(s => s.trim())
        .filter(Boolean);
      return lines.join(" ");
    };
    
    /** Heat‑map data: day offset → overlapping‑task count */
    const heat: Record<number, number> = {};
    /** Milestone guideline data */
    const milestoneOffsets = new Set<number>();          // unique day offsets
    const milestoneMap     = new Map<number, string>();  // (future) offset → tooltip
    const addHeat = (startOffset: number, span: number) => {
      for (let i = 0; i < span; i++) {
        // @ts-ignore Obsidian bundles callable moment
        const dayOfWeek = (moment as any)()
          .startOf("day")
          .add(startOffset + i, "days")
          .day();               // 0 = Sun, 6 = Sat
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;  // skip weekends
        heat[startOffset + i] = (heat[startOffset + i] ?? 0) + 1;
      }
    };
    
    /* --- all tasks per file (includes undated ones) ---------------- */
    const allTasksByPath = new Map<string, TaskItem[]>();
    this.cache.tasks.forEach((t) => {
      const arr = allTasksByPath.get(t.file.path) ?? [];
      arr.push(t);
      allTasksByPath.set(t.file.path, arr);
    });

    // fixed‑width left pane (project names)
    const leftPane = outer.createEl("div", { cls: "pm-tl-left" });
    leftPane.style.width = `${this.labelWidth}px`;

    // scrollable right pane (timeline grid + bars)
    const rightPane = outer.createEl("div", { cls: "pm-tl-right" });
    rightPane.style.overflow = "visible";
    rightPane.style.overflowX = "auto";
    /* keep project column vertically in sync with timeline scroll */
    rightPane.addEventListener("scroll", () => {
      leftPane.scrollTop = rightPane.scrollTop;
    });

    /* Allow mouse‑wheel on the fixed project column to scroll the timeline */
    leftPane.addEventListener(
      "wheel",
      (ev) => {
        rightPane.scrollTop += ev.deltaY;
        ev.preventDefault();        /* avoid rubber‑band / no‑scroll feeling */
      },
      { passive: false }
    );


    /* ────── shared SVG layer for ALL dependency arrows ───────── */
    const svgNS = "http://www.w3.org/2000/svg";
    const arrowLayer = document.createElementNS(svgNS, "svg");
    arrowLayer.classList.add("pm-arrow-layer");
    arrowLayer.style.position = "absolute";
    arrowLayer.style.top      = "0";
    arrowLayer.style.left     = "0";
    arrowLayer.style.width    = "100%";
    arrowLayer.style.height   = "100%";

    arrowLayer.style.overflow  = "visible";          // ← new
    arrowLayer.setAttribute("preserveAspectRatio", "none"); // ← new
    
    /* new: keep SVG above rows & let clicks pass through */
    arrowLayer.style.zIndex = "50";
    arrowLayer.style.pointerEvents = "none";
    // Insert arrowLayer *after* all project rows so SVG sits above all rows
    rightPane.appendChild(arrowLayer);   // SVG sits above all rows

    /* ---------- month‑start & weekend guide lines (auto height) ---------- */
    const injectGuidelines = () => {
      // Remove previous guideline DIVs
      rightPane
        .querySelectorAll(".pm-month-line, .pm-weekend-line, .pm-today-line, .pm-milestone-line")
        .forEach(el => el.remove());

      const lastRow = rightPane.querySelector<HTMLElement>(".pm-tl-row:last-child");
      if (!lastRow) return;

      const headerHeight = headerWrap.offsetHeight;
      const totalHeight  = lastRow.offsetTop + lastRow.offsetHeight - headerHeight;

      const addLine = (cls: string, left: number, width: number) => {
        const div = document.createElement("div");
        div.className   = cls;
        div.style.left  = `${left}px`;
        div.style.top   = `${headerHeight}px`;
        div.style.width = `${width}px`;
        div.style.height= `${totalHeight}px`;

        if (cls === "pm-milestone-line" || cls === "pm-today-line") {
          /* Make milestone + today bars hoverable */
          if (width < 4) div.style.width = "4px";     // easy hit‑area
          div.style.pointerEvents = "auto";

          /* Build tooltip HTML */
          let html: string | undefined;
          if (cls === "pm-milestone-line") {
            const off = Math.round(left / pxPerDay);
            html = milestoneMap.get(off);
          } else { /* today bar */
            // Show the real calendar date, not the timeline anchor
            // @ts-ignore callable moment bundled by Obsidian
            html = `<strong>Today</strong><br>${(moment as any)().format("YYYY-MM-DD")}`;
          }

          if (html) {
            div.addEventListener("mouseenter", (ev) => {
              const m = ev as MouseEvent;
              const fake = {
                left:   m.clientX,
                right:  m.clientX,
                top:    m.clientY,
                bottom: m.clientY,
                width:  0,
                height: 0,
              } as DOMRect;
              showBarTip(html!, fake);
            });
            div.addEventListener("mouseleave", hideBarTip);
          }
        } else {
          /* Other guideline lines stay transparent */
          div.style.pointerEvents = "none";
        }
        rightPane.appendChild(div);
      };

      // Scan header day‑cells once
      gridRow.querySelectorAll<HTMLElement>(".pm-tl-daycell").forEach(cell => {
        const x = cell.offsetLeft;
        if (cell.classList.contains("pm-tl-month-start"))
          addLine("pm-month-line", x, 2);
        if (cell.classList.contains("pm-tl-weekend"))
          addLine("pm-weekend-line", x, pxPerDay);
        if (cell.classList.contains("pm-tl-today"))
          addLine("pm-today-line", x, 2);
      });
      /* ---- milestone guideline lines ---- */
      if (this.plugin.settings.showMilestones !== false) {
        milestoneOffsets.forEach((offset) => {
          addLine("pm-milestone-line", offset * pxPerDay, 2);   // thin 2-px bar
        });
      }      
    };

    // Inject guidelines once layout is settled
    setTimeout(injectGuidelines, 0);
    
    // Add spacers at the bottom to ensure vertical scrolling works
    setTimeout(() => {
      // Right pane spacer
      const rightSpacer = rightPane.createEl("div", { cls: "pm-tl-bottom-spacer" });
      rightSpacer.style.height = "100px";
      rightSpacer.style.width = "100%";
      rightSpacer.style.flexShrink = "0";
      
      // Left pane spacer (to keep in sync)
      const leftSpacer = leftPane.createEl("div", { cls: "pm-tl-bottom-spacer" });
      leftSpacer.style.height = "100px";
      leftSpacer.style.width = "100%";
      leftSpacer.style.flexShrink = "0";
    }, 100);
    /* ---------- dependency arrows ---------- */

    // Read arrow‑toggle setting (default true)
    const arrowsEnabled: boolean =
      (this.app as any).plugins.plugins["project-management"]?.settings
        ?.showArrows ?? true;
    /** When TRUE we show only one bar per project (no per‑task rows) */
    const barsMode: boolean =
      !((this.app as any).plugins.plugins["project-management"]?.settings
        ?.showTasksInTimeline ?? true);
    // Toggle for heat‑map strip
    // @ts-ignore runtime has .plugins
    const heatmapEnabled: boolean =
      (this.app as any).plugins.plugins["project-management"]?.settings
        ?.showHeatmap ?? true;

    // Hide the arrow layer entirely when disabled
    if (!arrowsEnabled) {
      arrowLayer.style.display = "none";
    }
    
    // make the right pane horizontally scrollable
    rightPane.style.overflowX = "auto";
    rightPane.style.position  = "relative";   // context for sticky header

    /* helper to normalise vault‑relative paths: strip NBSP, trim, lower‑case, remove ".md" */
    const normPath = (p: string) =>
      p.replace(/\u00A0/g, " ")
        .trim()
        .toLowerCase()
        .replace(/\.md$/, "");

    /** Detect whether a task is completed (same logic as dashboard) */
    function tlIsTaskDone(t: any): boolean {
      if (t.done === true || t.checked === true) return true;
      if (typeof t.done === "string" && t.done.toLowerCase() === "done") return true;
      if (typeof t.percentComplete === "number" && t.percentComplete >= 1) return true;
      const raw = (t.raw ?? t.text ?? "").toString();
      return /^\s*-\s*\[[xX]\]/.test(raw);
    }

    const filterSet = this.filterPaths
      ? new Set(Array.from(this.filterPaths).map(normPath))
      : undefined;

    /** True when the project is not hidden and (no portfolio filter is active
     *  OR it belongs to the active filter). */
    const isProjectVisible = (filePath: string): boolean => {
      if (this.hiddenProjects.has(filePath)) return false;           // eye‑icon off
      if (filterSet && !filterSet.has(normPath(filePath))) return false; // outside filter
      return true;
    };

    const projects = Array.from(this.cache.projects.values())
      .filter(p => !filterSet || filterSet.has(normPath(p.file.path)))
      .sort((a, b) =>
        this.sortAsc
          ? a.file.basename.localeCompare(b.file.basename)
          : b.file.basename.localeCompare(a.file.basename)
      );
    /* Collect the full paths and basenames of *visible* projects (i.e. those
       that will have a row in the project column). We'll use this to filter
       milestone guideline bars so we never show milestones from projects that
       aren't listed. */
    const visiblePaths  = new Set(projects.map(p => p.file.path));
    const visibleBases  = new Set(
      projects.map(p => p.file.basename.toLowerCase())
    );
    /* Lower‑cased, ".md"‑stripped version of each visible file path */
    const visiblePathsNorm = new Set(
      projects.map(p => normPath(p.file.path))
    );
    
    /* ---------- calendar header (sticky) ---------- */
    const pxPerDay = this.zoomPxPerDay;   // zoomable px/day

    /* ─── anchor "today" either to settings.timelineStart or the real today ─── */
    // @ts-ignore callable moment
    const today =
      this.plugin.settings.timelineStart && this.plugin.settings.timelineStart !== ""
        ? (moment as any)(
            this.plugin.settings.timelineStart,
            "YYYY-MM-DD"
          ).startOf("day")
        : (moment as any)().startOf("day");


    /* ----- Horizon: show at least 12 full calendar months,
             or up to the end‑of‑month containing the latest due task ----- */
    let horizon = 30;   // minimum ≈ one month

    // 1️⃣ furthest due‑date month‑end (if any)
    let latestEndDays = 0;
    (() => {
      let latest: any = null;
      this.cache.tasks.forEach(t => {
        const iso = (t.props["due"] ?? "").replace(/\u00A0/g, " ").trim();
        if (!iso) return;
        // @ts-ignore Obsidian bundles callable moment
        const d = (moment as any)(iso, "YYYY-MM-DD");
        if (d.isValid() && (!latest || d.isAfter(latest))) latest = d;
      });
      if (latest) {
        const lastDay = (latest as any).endOf("month");
        latestEndDays = lastDay.diff((moment as any)().startOf("day"), "days") + 1;
      }
    })();

    // 2️⃣ exactly 12 months from today → end of that future month
    // @ts-ignore callable moment
    const oneYearEnd = (moment as any)().add(11, "months").endOf("month");
    const oneYearDays = oneYearEnd.diff((moment as any)().startOf("day"), "days") + 1;

    horizon = Math.max(30, latestEndDays, oneYearDays);
    /* User-defined end date overrides horizon */
    if (this.plugin.settings.timelineEnd && this.plugin.settings.timelineEnd !== "") {
      // @ts-ignore callable moment
      const end = (moment as any)(
        this.plugin.settings.timelineEnd,
        "YYYY-MM-DD"
      ).endOf("day");
      if (end.isValid() && end.isAfter(today)) {
        horizon = end.diff(today, "days") + 1;
      }
    }
    const headerWrap = rightPane.createEl("div", { cls: "pm-tl-headwrap" });
    // header grid begins exactly where bars start (right after the label)
    headerWrap.style.marginLeft = "0px";          // header starts flush with timeline

    
    /* ---------- global splitter (absolute, covers all rows) ---------- */
    const globalSplit = outer.createEl("div", { cls: "pm-tl-splitter" });
    //globalSplit.style.position = "sticky";  // keep splitter fixed when scrolling
    // start at the current column edge
    globalSplit.style.left = `${this.labelWidth}px`;
    globalSplit.style.top    = "0";
    globalSplit.style.bottom = "100%";
    alignIcons();  // initial icon alignment
    
    /* keep splitter as tall as the entire list OR the viewport (whichever is taller) */
    const syncSplitterHeight = () => {
      const viewportH = this.containerEl.clientHeight;   // full height of the pane

      /* Make sure the outer wrapper itself stretches to at least pane height */
      outer.style.minHeight = `${viewportH}px`;

      /* Choose the larger of content height vs. viewport height */
      const h = Math.max(
        viewportH,
        outer.scrollHeight,
        outer.clientHeight,
        rightPane.scrollHeight,
        rightPane.clientHeight
      );
      globalSplit.style.height = `${h}px`;
    };
    syncSplitterHeight();             // initial
    setTimeout(syncSplitterHeight, 0); // after bars render
    outer.addEventListener("scroll", syncSplitterHeight);
    window.addEventListener("resize", syncSplitterHeight);
    // Also resize splitter when the pane itself is dragged taller / shorter
    this.splitterRO = new ResizeObserver(() => syncSplitterHeight());
    this.splitterRO.observe(this.containerEl);
    
    let splitDragId: number | null = null;   /* active pointer id for splitter */
    let dragging = false;

    globalSplit.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0) return;        // left button only
      e.preventDefault();                // stop native selection/drag
      dragging     = true;
      splitDragId  = e.pointerId;
      globalSplit.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
      document.body.classList.add("pm-noselect");
      e.stopPropagation();               // prevent bar‑drag or text selection
    });

    /* handle move on the splitter itself (pointer capture keeps events flowing) */
    globalSplit.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging || e.pointerId !== splitDragId) return;

      /* Determine widest label (project or task) each time we drag */
      const labels = leftPane.querySelectorAll<HTMLElement>(".pm-tl-label");
      let widest = 0;
      labels.forEach(l => { widest = Math.max(widest, l.scrollWidth); });
      const maxWidth = Math.max(120, Math.min(widest + 32, 800));

      const newWidth = Math.max(
        80,
        Math.min(maxWidth, e.clientX - outer.getBoundingClientRect().left)
      );
      this.labelWidth          = newWidth;
      globalSplit.style.left   = `${newWidth}px`;
      leftPane.style.width     = `${newWidth}px`;
      // Update project-header width as well
      const hdr = leftPane.querySelector<HTMLElement>(".pm-tl-nameheader");
      if (hdr) hdr.style.width = `${newWidth}px`;
      leftPane.querySelectorAll<HTMLElement>(".pm-tl-label")
        .forEach(l => {
          const hasCaret = l.previousElementSibling?.classList.contains("pm-fold-caret");
          const indentPx = parseFloat(l.style.marginLeft || "0");
          const caretW = hasCaret ? 18 : 0;
          
          // Account for additional elements before the label
          let extraWidth = 0;
          const parent = l.parentElement;
          if (parent) {
            // Check for check icon or bullet point before the label
            const prevSibling = l.previousElementSibling;
            if (prevSibling) {
              if (prevSibling.classList.contains("pm-task-check")) {
                // Check icon with margin-right: 4px
                extraWidth += 20; // Approximate width of check icon + margin
              } else if (prevSibling.textContent === "• ") {
                // Bullet point
                extraWidth += 8; // Approximate width of bullet + space
              }
            }
            
            // Check for eye icon after the label (project rows)
            const nextSibling = l.nextElementSibling;
            if (nextSibling && nextSibling.classList.contains("pm-project-eye")) {
              extraWidth += 20; // Approximate width of eye icon
            }
          }
          
          const w = Math.max(newWidth - caretW - indentPx - extraWidth, 0);
          l.style.width = `${w}px`;
        });
      
      alignIcons();  // keep icons glued to splitter while dragging
    });

    const endSplitDrag = () => {
      if (!dragging) return;
      dragging = false;
      splitDragId = null;
      document.body.style.userSelect = "";
      document.body.classList.remove("pm-noselect");
    };

    globalSplit.addEventListener("pointerup", (e: PointerEvent) => {
      if (e.pointerId === splitDragId) {
        globalSplit.releasePointerCapture(e.pointerId);
        endSplitDrag();
      }
    });

    globalSplit.addEventListener("pointercancel", endSplitDrag);
    window.addEventListener("blur", endSplitDrag);  // safety: stop drag if window loses focus

    const gridRow    = headerWrap.createEl("div", { cls: "pm-tl-header" });
    const monthRow   = headerWrap.createEl("div", { cls: "pm-tl-monthrow" });
    /* allow absolute‑positioned labels */
    monthRow.style.position = "relative";
    /* Stretch header so the no‑heatmap background covers the full timeline */
    headerWrap.style.minWidth = `${(horizon + 1) * pxPerDay}px`;

    /* ---------- zoom slider (top‑right) ---------- */
    // Helper assigned below once zoomWrap exists
    let syncZoomPos: () => void = () => {};
    let zoomWrap = topHeader.querySelector<HTMLDivElement>(".pm-zoom-wrap");
    if (!zoomWrap) {
      zoomWrap = topHeader.createEl("div", { cls: "pm-zoom-wrap" });
      zoomWrap.style.zIndex = "6";
      const label = zoomWrap.createEl("span", { cls: "pm-zoom-label", text: "Zoom:" });

      const slider = zoomWrap.createEl("input") as HTMLInputElement;
      slider.type  = "range";
      slider.min   = "0";
      slider.max   = (ZOOM_STOPS.length - 1).toString();
      slider.step  = "1";
      /* slider value stores INDEX not pxPerDay */
      slider.value = ZOOM_STOPS.indexOf(this.zoomPxPerDay).toString();
      slider.className = "pm-zoom-slider";

      syncZoomPos = () => {};   // no‑op; top header is outside scroll pane

      slider.oninput = () => {
        const idx = slider.valueAsNumber;
        const newPx = ZOOM_STOPS[idx];
        if (newPx !== this.zoomPxPerDay) {
          this.zoomPxPerDay               = newPx;
          this.plugin.settings.zoomPxPerDay = newPx;   // persist
          this.plugin.saveSettings?.();              // async save
          headerWrap.style.minWidth = `${(horizon + 1) * this.zoomPxPerDay}px`;
          /* Update each row's min‑width so the timeline doesn't remain wider than the header */
          rightPane
            .querySelectorAll<HTMLElement>(".pm-tl-row")
            .forEach(r => (r.style.minWidth = `${(horizon + 1) * this.zoomPxPerDay}px`));
          syncZoomPos();   // keep slider in view
          this.saveAndRender();
        }
      };
    } else {
      const slider = zoomWrap.querySelector<HTMLInputElement>("input");
      if (slider) slider.value = ZOOM_STOPS.indexOf(this.zoomPxPerDay).toString();
      syncZoomPos = () => {};
    }

    /* ----- keep zoom slider pinned to the timeline viewport (horizontally) ----- */

    /* ----- drag anywhere on the zoom wrapper for fluid multi-step zoom ----- */
    {
      const slider = zoomWrap.querySelector<HTMLInputElement>("input");
      if (slider) {
        let dragStartX = 0;
        let dragStartValIdx = 0;   // store index
        let stepPxPerStop = 8;      // will be updated on pointerdown

        const onDragMove = (ev: PointerEvent) => {
          const deltaPx = ev.clientX - dragStartX;
          /* Convert pointer movement to a floating index and round to nearest stop.
             This lets the slider respond once you cross the mid‑point instead of
             waiting for a full stop width, making it feel snappier. */
          const rawIdx = dragStartValIdx + deltaPx / stepPxPerStop;
          let newIdx   = Math.round(rawIdx);
          newIdx = Math.max(0, Math.min(ZOOM_STOPS.length - 1, newIdx));

          if (ZOOM_STOPS[newIdx] !== this.zoomPxPerDay) {
            this.zoomPxPerDay = ZOOM_STOPS[newIdx];
            slider.value = newIdx.toString();
            headerWrap.style.minWidth = `${(horizon + 1) * this.zoomPxPerDay}px`;
            /* Adjust existing rows live while dragging */
            rightPane
              .querySelectorAll<HTMLElement>(".pm-tl-row")
              .forEach(r => (r.style.minWidth = `${(horizon + 1) * this.zoomPxPerDay}px`));
            syncZoomPos();   // keep slider pinned while dragging
            /* throttle: queue exactly one re-render per animation frame */
            if (!this.zoomRenderScheduled) {
              this.zoomRenderScheduled = true;
              requestAnimationFrame(() => {
                this.zoomRenderScheduled = false;
                this.saveAndRender();
              });
            }
          }
        };

        const onDragEnd = () => {
          window.removeEventListener("pointermove", onDragMove);
          window.removeEventListener("pointerup", onDragEnd);
          /* if no frame render is pending, render now */
          if (!this.zoomRenderScheduled) {
            this.plugin.settings.zoomPxPerDay = this.zoomPxPerDay;
            this.plugin.saveSettings?.();
            headerWrap.style.minWidth = `${(horizon + 1) * this.zoomPxPerDay}px`;
            this.saveAndRender();
          }
        };

        zoomWrap.onpointerdown = (ev: PointerEvent) => {
          // allow drag to start on either the label or slider
          dragStartX = ev.clientX;
          dragStartValIdx = ZOOM_STOPS.indexOf(this.zoomPxPerDay);

          /* Compute step size based on slider track width */
          const trackWidth = slider.offsetWidth;                 // full track px
          stepPxPerStop    = trackWidth / (ZOOM_STOPS.length - 1);

          window.addEventListener("pointermove", onDragMove);
          window.addEventListener("pointerup", onDragEnd);
        };
      }
    }
    // mark the real calendar "today", not merely the first cell
    // @ts-ignore callable moment
    const realToday = (moment as any)().startOf("day");
    for (let i = 0; i <= horizon; i++) {
      // Use timelineStart anchor ("today") instead of real today
      const date = (today.clone() as any).add(i, "days");
      const dayCell   = gridRow.createEl("div", { cls: "pm-tl-daycell" });
      dayCell.style.width = `${pxPerDay}px`;

      if (date.isSame(realToday, "day")) dayCell.addClass("pm-tl-today");
      if (date.day() === 0 || date.day() === 6) dayCell.addClass("pm-tl-weekend");

      if (date.date() === 1) {
        dayCell.addClass("pm-tl-month-start");

        // month label spanning this month
        const label = monthRow.createEl("div", {
          cls: "pm-tl-month-label",
          text: date.format("MMM YYYY"),
        });
        const daysInMonth = date.daysInMonth();
        /* Absolute positioning so the label's left edge equals the month bar position */
        const x = i * pxPerDay;          // i = day offset where this month starts
        label.style.position  = "absolute";
        label.style.left      = `${x + 2}px`;         /* 2‑px bar width offset */
        label.style.top       = "0";
        label.style.width     = `${Math.min(daysInMonth * pxPerDay, horizon * pxPerDay)}px`;
        label.style.padding   = "0";                  /* no extra padding */
        label.style.textAlign = "left";
      }
    }

    /* ---------- project-name column header ---------- */
    const nameHeader = leftPane.createEl("div", { cls: "pm-tl-nameheader" });
    nameHeader.createEl("span", { text: "Project " });

    /* sorting icon */
    const sortIcon = topControls.createEl("span");
    setIcon(sortIcon, "arrow-up-down");   // dual‑arrow sort icon
    attachTip(sortIcon, "Sort projects A–Z / Z–A");
    sortIcon.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.sortAsc = !this.sortAsc;
      this.render();
    };

    /* ---------- tasks ON/OFF toggle button ---------- */
    const plugin: any =
      (this.app as any).plugins.plugins["project-management"];

    const toggleBtn = topControls.createEl("span", { cls: "pm-tl-tasktoggle" });
    const toggleIcon = toggleBtn.createEl("span");
    setIcon(toggleIcon, plugin.settings.showTasksInTimeline ? "eye" : "eye-off");
    attachTip(toggleBtn, "Show / hide individual task rows");

    toggleBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't flip the sort order
      plugin.settings.showTasksInTimeline = !(plugin.settings.showTasksInTimeline ?? true);
      await plugin.saveSettings?.();
      setIcon(toggleIcon, plugin.settings.showTasksInTimeline ? "eye" : "eye-off");
      this.render(); // refresh current view
    };

    /* ---------- optional global fold/unfold caret ---------- */
    let allCaret: HTMLSpanElement | null = null;
    let allCaretIcon: HTMLSpanElement | null = null;
    allCaret = topControls.createEl("span", { cls: "pm-fold-all-caret" });
    attachTip(allCaret, "Expand / collapse all projects");
    allCaretIcon = allCaret.createEl("span");
    setIcon(
      allCaretIcon,
      this.collapsed.size === projects.length ? "plus-square" : "minus-square"
    );

    allCaret.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      /* toggle collapse state */
      if (this.collapsed.size === projects.length) {
        this.collapsed.clear();               // expand all
      } else {
        projects.forEach((p) => this.collapsed.add(p.file.path)); // collapse all
      }

      /* update icon only */
      const isCollapsed = this.collapsed.size === projects.length;
      if (allCaretIcon) setIcon(allCaretIcon, isCollapsed ? "plus-square" : "minus-square");

      this.render();
    };

    /* ---------- heat‑map ON / OFF toggle button ---------- */
    const heatToggle = rightControls.createEl("span", { cls: "pm-heatmap-toggle" });
    attachTip(heatToggle, "Toggle workload heat‑map strip");

    /* Always use the same flame icon; dim it when map is off */
    const updateHeatIcon = () => {
      setIcon(heatToggle, "flame");
      heatToggle.classList.toggle("off", !this.plugin.settings.showHeatmap);
    };
    updateHeatIcon();

    heatToggle.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.plugin.settings.showHeatmap = !this.plugin.settings.showHeatmap;
      await this.plugin.saveSettings?.();
      updateHeatIcon();
      this.saveAndRender();          // refresh timeline with/without strip
    };

    /* ---------- allow-bar-move ON / OFF toggle button ---------- */
    const moveToggle = rightControls.createEl("span", { cls: "pm-move-toggle" });
    attachTip(moveToggle, "Enable / disable bar move & resize");

    /* Always use the "move" icon; dim it when the feature is disabled */
    const updateMoveIcon = () => {
      setIcon(moveToggle, "move");
      moveToggle.classList.toggle("off", this.plugin.settings.allowBarMove === false);
    };
    updateMoveIcon();

    moveToggle.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // undefined counts as true; flip boolean
      this.plugin.settings.allowBarMove = this.plugin.settings.allowBarMove === false;
      await this.plugin.saveSettings?.();
      updateMoveIcon();
      this.saveAndRender();        // refresh rows so resize handles show/hide
    };
    
    /* ---------- dependency-arrows ON / OFF toggle button ---------- */
    const arrowToggle = rightControls.createEl("span", { cls: "pm-arrow-toggle" });
    attachTip(arrowToggle, "Show / hide dependency arrows");

    /* Always show the same icon; dim when arrows are hidden */
    const updateArrowIcon = () => {
      setIcon(arrowToggle, "arrow-right-left");   // Lucide icon name
      arrowToggle.classList.toggle("off", this.plugin.settings.showArrows === false);
    };
    updateArrowIcon();

    arrowToggle.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // undefined counts as "true"; flip boolean
      this.plugin.settings.showArrows = this.plugin.settings.showArrows === false;
      await this.plugin.saveSettings?.();
      updateArrowIcon();
      this.saveAndRender();        // redraw timeline with/without arrows
    };
    
    /* ---------- assignee-label ON / OFF toggle button ---------- */
    const assigneeToggle = rightControls.createEl("span", { cls: "pm-assignee-toggle" });
    attachTip(assigneeToggle, "Show / hide assignee labels on bars");

    const updateAssigneeIcon = () => {
      setIcon(assigneeToggle, "user");   // Lucide "user" icon
      assigneeToggle.classList.toggle("off", this.plugin.settings.showAssignees === false);
    };
    updateAssigneeIcon();

    assigneeToggle.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.plugin.settings.showAssignees = this.plugin.settings.showAssignees === false;
      await this.plugin.saveSettings?.();
      updateAssigneeIcon();
      this.saveAndRender();            // redraw bars with / without labels
    };
    
    /* ---------- milestone ON / OFF toggle button ---------- */
    const milestoneToggle = rightControls.createEl("span", { cls: "pm-milestone-toggle" });
    attachTip(milestoneToggle, "Show / hide milestone guidelines");

    const updateMilestoneIcon = () => {
      setIcon(milestoneToggle, "flag");   // Lucide "flag" icon
      milestoneToggle.classList.toggle("off", this.plugin.settings.showMilestones === false);
    };
    updateMilestoneIcon();

    milestoneToggle.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.plugin.settings.showMilestones = this.plugin.settings.showMilestones === false;
      await this.plugin.saveSettings?.();
      updateMilestoneIcon();
      this.saveAndRender();            // redraw timeline with / without milestones
    };
    
    /* ---------- timeline START / END calendar icons ---------- */
    const startCal = rightControls.createEl("span", { cls: "pm-cal-start" });
    const startLabel = rightControls.createEl("span", { cls: "pm-cal-label" });
    startLabel.style.marginLeft = "4px";
    const endCal   = rightControls.createEl("span", { cls: "pm-cal-end" });
    setIcon(startCal, "calendar");
    attachTip(startCal, "Set timeline start date");
    setIcon(endCal,   "calendar-range");
    attachTip(endCal,   "Set timeline end date");
    const endLabel   = rightControls.createEl("span", { cls: "pm-cal-label" });
    endLabel.style.marginLeft   = "4px";

    const fmt = (iso?: string) => (iso && iso.trim() !== "" ? iso : "—");
    const refreshCalLabels = () => {
      startLabel.textContent = fmt(this.plugin.settings.timelineStart);
      endLabel.textContent   = fmt(this.plugin.settings.timelineEnd);
    };
    refreshCalLabels();
    
    const promptDate = async (label: string, current: string): Promise<string | null> => {
      const modal = new DatePromptModal(this.app, label, current);
      return await modal.openWithPromise();
    };

    startCal.onclick = async (e) => {
      e.preventDefault();
      const res = await promptDate("timeline START", this.plugin.settings.timelineStart);
      if (res === null) return;
      this.plugin.settings.timelineStart = res;
      await this.plugin.saveSettings?.();
      this.saveAndRender();
      refreshCalLabels();
    };
    
    endCal.onclick = async (e) => {
      e.preventDefault();
      const res = await promptDate("timeline END", this.plugin.settings.timelineEnd);
      if (res === null) return;
      this.plugin.settings.timelineEnd = res;
      await this.plugin.saveSettings?.();
      this.saveAndRender();
      refreshCalLabels();
    };
    
    nameHeader.style.width = `${this.labelWidth}px`;
    nameHeader.onclick = () => {
      this.sortAsc = !this.sortAsc;
      /* update icon in-place */
      setIcon(sortIcon, this.sortAsc ? "chevron-up" : "chevron-down");
      this.render();                 // re-render with new order
    };


    // (no-op: global caret icons and label are now managed above)

    // (toggleBtn.setText is no longer used; icon handles state)

    /** Return tasks ordered as
     *   Epic
     *     └─ Story
     *          └─ Sub‑task
     * Tasks that have no Epic/Story reference keep their original relative order.
     */
    const orderTasks = (tasks: TaskItem[]): TaskItem[] => {
      const done = new Set<TaskItem>();
      const out: TaskItem[] = [];

      /** quick helpers */
      const idLower = (t: TaskItem) => t.id.toLowerCase();
      const isEpic  = (t: TaskItem) => idLower(t).startsWith("e");
      const isStory = (t: TaskItem) =>
        idLower(t).startsWith("s") && !idLower(t).startsWith("sb");
      const isSub   = (t: TaskItem) => idLower(t).startsWith("sb");

      /** map Story‑id → [sub‑tasks]  (reuse existing Story column + depends logic) */
      const subsByStory = new Map<string, TaskItem[]>();
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
      const storiesByEpic = new Map<string, TaskItem[]>();
      tasks.forEach(t => {
        if (!isStory(t)) return;
        const epicField = (t.props["epic"] ?? "").toString().trim().toLowerCase();
        if (!epicField) return;
        if (!storiesByEpic.has(epicField)) storiesByEpic.set(epicField, []);
        storiesByEpic.get(epicField)!.push(t);
      });

      /** helper to push Story + its subs */
      const pushStoryWithSubs = (s: TaskItem) => {
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
    };

    for (const project of projects) {
      /* Collect milestone offsets and tooltip HTML for this project */
      const projMilestones: { off: number; html: string }[] = [];
      /* ── Milestones for *this* project (table inside its note) ── */
      {
        /* If the eye‑icon has hidden this project, skip its milestones entirely */
        if (this.hiddenProjects.has(project.file.path)) {
          /* Nothing to collect for hidden projects */
        } else {
          const normP = normPath(project.file.path);

          (this.plugin?.cache?.milestones ?? [])
            .filter((m: any) => {
              /* Resolve the milestone's file reference, if any */
              const fileStr: string | undefined =
                typeof m.file     === "string" && m.file.trim()      ? m.file :
                typeof m.path     === "string" && m.path.trim()      ? m.path :
                typeof m.filePath === "string" && m.filePath.trim()  ? m.filePath :
                undefined;

              /* Keep the row when:
                 – it specifies a file/path matching this project OR
                 – it has no file reference (assumed to belong to this project note). */
              return fileStr ? normPath(fileStr) === normP : true;
            })
            .forEach((m: any) => {
              // @ts-ignore callable moment bundled by Obsidian
              const d = (moment as any)(m.date, "YYYY-MM-DD", true);
              if (!d.isValid()) return;
              const off = d.diff(today, "days");
              milestoneOffsets.add(off);

              const label = m.name ?? m.title ?? "Milestone";
              /* Prefer `description`, fall back to `desc` (parsed from the table) */
              const desc  = (m.description ?? m.desc ?? "").toString().trim();

              const html =
                `<span><strong>Project:</strong> ${project.file.basename}</span><br>` +
                `<span><strong>Title:</strong> ${label}</span><br>` +
                `<span><strong>Date:</strong> ${m.date}</span>` +
                (desc ? `<br>${desc}` : "");
              milestoneMap.set(off, html);
              projMilestones.push({ off, html });
            });
        }
      }
      const rowLeft  = leftPane.createEl("div", { cls: "pm-tl-row pm-project-row" });
      const rowRight = rightPane.createEl("div", { cls: "pm-tl-row pm-project-row" });
      rowRight.dataset.proj = project.file.path;          // identify owner project
      if (this.hiddenProjects.has(project.file.path))      // honour hide state
        rowRight.classList.add("pm-hide-bars");      
      /* Ensure separator spans the full timeline width */
      rowRight.style.minWidth = `${(horizon + 1) * pxPerDay}px`;
      /* ----- project name with fold caret ----- */
      let caret: HTMLSpanElement | null = null;
      if (!barsMode) {                         /* only show when tasks list visible */
        caret = rowLeft.createEl("span", { cls: "pm-fold-caret" });
        setIcon(
          caret,
          this.collapsed.has(project.file.path) ? "chevron-right" : "chevron-down"
        );
        caret.onclick = (e) => {
          e.preventDefault();
          if (this.collapsed.has(project.file.path)) {
            this.collapsed.delete(project.file.path);
          } else {
            this.collapsed.add(project.file.path);
          }
          if (caret)
            setIcon(
              caret,
              this.collapsed.has(project.file.path) ? "chevron-right" : "chevron-down"
            );
          this.render();
        };
      }

      /* ── per‑project eye toggle ───────────────────────────── */
      const eyeSpan  = rowLeft.createEl("span", { cls: "pm-project-eye" });
      attachTip(eyeSpan, "Show / hide this project");
      const eyeIcon  = eyeSpan.createEl("span");
      const isHidden = this.hiddenProjects.has(project.file.path);
      setIcon(eyeIcon, isHidden ? "eye-off" : "eye");
      eyeSpan.style.cursor = "pointer";
      eyeSpan.style.marginRight = "4px";

      const updateEyeVis = () => {
        const hide = this.hiddenProjects.has(project.file.path);
        setIcon(eyeIcon, hide ? "eye-off" : "eye");

        /* toggle class on every right-pane row that belongs to this project */
        rightPane
          .querySelectorAll<HTMLElement>(`[data-proj="${project.file.path}"]`)
          .forEach(el => el.classList.toggle("pm-hide-bars", hide));
      };
      
      eyeSpan.onclick = (e) => {
        e.preventDefault();
        if (this.hiddenProjects.has(project.file.path))
          this.hiddenProjects.delete(project.file.path);
        else
          this.hiddenProjects.add(project.file.path);

        /* Update bars immediately for smoother UX */
        updateEyeVis();

        /* Re‑render so milestone guideline bars refresh */
        this.render();
      };
      /* apply initial visibility */
      updateEyeVis();

      const label = rowLeft.createEl("a", {
        cls: "pm-tl-label",
        text: project.file.basename,
        href: project.file.path,
      });

      /* ── Hover tooltip with project front-matter ─────────────────────── */
      {
        let tip: HTMLElement | null = null;

        const showTip = () => {
          const fm: Record<string, any> =
            project.file instanceof TFile
              ? this.app.metadataCache.getFileCache(project.file as TFile)?.frontmatter ?? {}
              : {};

          const norm = (s: string) => s.replace(/[\s_]+/g, "").toLowerCase();
          const val  = (k: string) => {
            const want = norm(k);
            for (const key in fm) if (norm(key) === want) return String(fm[key]);
            return "—";
          };

          let html = `<strong>${project.file.basename}</strong>`;
          if (Object.keys(fm).length) {
            html += `<br><em>${val("description")}</em>
                    <br><span>Start: ${val("start date")}</span>
                    <br><span>Due  : ${val("end date") || val("due date")}</span>`;
          }

          tip = document.createElement("div");
          tip.className = "pm-dash-tooltip";
          tip.innerHTML = html;
          document.body.appendChild(tip);

          const r = label.getBoundingClientRect();
          const pad = 8;
          const w = tip.offsetWidth;
          let x = r.right + pad;
          if (x + w > window.innerWidth - pad) {
            x = Math.max(r.left - pad - w, pad);
          }
          const h = tip.offsetHeight;
          let y   = Math.max(r.top, 48);
          if (y + h > window.innerHeight - pad) {
            y = Math.max(window.innerHeight - h - pad, 48);
          }
          tip.style.left = `${x}px`;
          tip.style.top  = `${y}px`;
        };

        const hideTip = () => { tip?.remove(); tip = null; };

        label.addEventListener("mouseenter", showTip);
        label.addEventListener("mouseleave", hideTip);
      }
      
      // Toggle collapse on caret click
      // (moved to caret.onclick above)

      /* Allow space for fold-caret and eye icon so ellipsis can appear */
      const caretW = caret ? 18 : 0;
      const eyeW = 20; // Approximate width of eye icon
      label.style.width = `${Math.max(this.labelWidth - caretW - eyeW, 0)}px`;
      label.onclick = (e) => {
        e.preventDefault();
        this.app.workspace.openLinkText(project.file.path, "", false);
      };

      const barWrap = rowRight.createEl("div", { cls: "pm-tl-barwrap" });
      /* Ensure the project row has a visible height even when no task bars render */
      rowLeft.style.height  = "27px";   // keep left column the same height      
      rowRight.style.height = "27px";   // match task-row height
      barWrap.style.height  = "27px";
      barWrap.style.position = "relative";   // so bracket's absolute positioning is relative

      /* ─── show sub-task bars when the task list is hidden (barsMode === true) ─── */
      if (barsMode || this.collapsed.has(project.file.path)) {
        orderTasks(project.tasks).forEach((task) => {
          let dueIso = (task.props["due"] ?? "").replace(/\u00A0/g, " ").trim();
          if (!dueIso) return;

          // @ts-ignore runtime bundles moment
          const due = (moment as any)(dueIso, "YYYY-MM-DD");
          if (!due.isValid()) return;

          /* multi-day support via start:: */
          const startIso = (task.props["start"] ?? "").replace(/\u00A0/g, " ").trim();
          let startOff = due.diff(today, "days");
          let spanDays = 1;

          if (startIso) {
            // @ts-ignore
            const s = (moment as any)(startIso, "YYYY-MM-DD");
            if (s.isValid()) {
              startOff = s.diff(today, "days");
              spanDays = Math.max(due.diff(s, "days") + 1, 1);
            }
          }

          /* draw the bar */
          const bar = barWrap.createEl("div", { cls: "pm-tl-bar" });
          bar.style.left  = `${startOff * pxPerDay}px`;
          bar.style.width = `${Math.max(spanDays * pxPerDay, 3)}px`;
          bar.style.zIndex = "2";

          // ── track pointer movement so we can suppress post-drag clicks ──
          let dragMoved  = false;
          let dragStartX = 0;

          bar.addEventListener("pointerdown", (ev) => {
            dragMoved  = false;
            dragStartX = ev.clientX;
          });
          bar.addEventListener("pointermove", (ev) => {
            if (Math.abs(ev.clientX - dragStartX) > 3) dragMoved = true;   // >3 px = drag
          });
          
          const taskKey = key(task);
          (bar as any).dataset.task = taskKey;
          bar.addEventListener("mouseenter", () => highlightArrows(taskKey, true));
          bar.addEventListener("mouseleave", () => highlightArrows(taskKey, false));
        
          /* colour by ID prefix */
          {
            const id = task.id.toLowerCase();
            if (id.startsWith("e"))       bar.addClass("pm-bar-e");
            else if (id.startsWith("sb")) bar.addClass("pm-bar-sb");
            else if (id.startsWith("s"))  bar.addClass("pm-bar-s");
          }

          /* urgency colour (skip completed) */
          if (!task.checked) {
            const dOff = due.diff(today, "days");
            if (dOff < 0)        bar.addClass("pm-bar-overdue");
            else if (dOff <= 10) bar.addClass("pm-bar-warning");
          }

          /* tooltip + click-through */
          bar.setAttr(
            "title",
            `${task.text}\n${startIso ? "start " + startIso + " → " : ""}due ${due.format("YYYY-MM-DD")}`
          );
          bar.onclick = (e) => {
            // Suppress clicks that follow a drag, or when move-mode is enabled
            if (dragMoved || this.plugin.settings.allowBarMove !== false) {
              e.preventDefault();
              return;
            }
            e.preventDefault();
            this.openAndScroll(project.file.path, task.id, task.line);
          };

          /* ── shared tooltip (collapsed‑row bar) ── */
          {
            const buildHtml = () => {
              const fmt  = (s: string) => (s && s.trim() ? s.trim() : "—");
              const desc = getDescription(task);
              const raw  = task.text.split("\n")[0].trim();
              const shortTxt = raw.length > 70 ? raw.slice(0, 67) + "…" : raw;
              const who = (task.props["assignee"] ?? "").replace(/\u00A0/g, " ").trim() || "—";
              
              let idPrefix = "";
              {
                const idL = task.id.toLowerCase();
                const num = task.id.match(/\d+/)?.[0] ?? "";
                if (idL.startsWith("sb"))      idPrefix = `SB-${num}. `;
                else if (idL.startsWith("s") && !idL.startsWith("sb")) idPrefix = `S-${num}. `;
                else if (idL.startsWith("e"))  idPrefix = `E-${num}. `;
              }

              return `<strong>${idPrefix}${shortTxt}</strong>${desc ? `<br><em>${desc}</em>` : ""}`
                   + `<br><span>Start: ${fmt(startIso)}</span>`
                   + `<br><span>Due&nbsp;&nbsp;: ${fmt(dueIso)}</span>`
                   + `<br><span>Assignee:&nbsp;${who}</span>`;              
            };

            bar.addEventListener("mouseenter", (ev) => {
              const m = ev as MouseEvent;
              const fakeRect = {
                left:   m.clientX,
                right:  m.clientX,
                top:    m.clientY,
                bottom: m.clientY,
                width:  0,
                height: 0,
              } as DOMRect;
              showBarTip(buildHtml(), fakeRect);
            });
            bar.addEventListener("mouseleave", hideBarTip);
          }

          /* record geometry for arrows, heat-map, milestones */
          barsById[key(task)] = { x: startOff * pxPerDay, w: Math.max(spanDays * pxPerDay, 3), el: bar };
          tasksById.set(key(task), task);
          
          /* Heat‑map tally (exclude "E" and plain "S") */
          {
            const idL = task.id.toLowerCase();
            const isPlainS = idL.startsWith("s") && !idL.startsWith("sb");
            if (!idL.startsWith("e") && !isPlainS) {
              addHeat(startOff, spanDays);
            }
          }
          {
            const idL = task.id.toLowerCase();
            const isMilestone = idL.startsWith("m") ||
              ((task.props["milestone"] ?? "").toString().toLowerCase() === "true");
            if (isMilestone && isProjectVisible(project.file.path)) {
              milestoneOffsets.add(startOff);
              const desc = getDescription(task);
              const html =
                `<span><strong>Project:</strong> ${project.file.basename}</span><br>` +
                `<strong>${task.id}</strong><br>${dueIso}` +   // use dueIso here
                (desc ? `<br>${desc}` : "");
              milestoneMap.set(startOff, html);     // or startOff
              projMilestones.push({ off: startOff, html });
            }
          }
        });

        /* maintain row height */
        rowLeft.style.height  = "27px";   // keep left column the same height        
        rowRight.style.height = "27px";
        barWrap.style.height  = "27px";
      }

      /* ── Project span from YAML only ─────────────────────── */
      let projStart = Number.POSITIVE_INFINITY;
      let projEnd   = Number.NEGATIVE_INFINITY;

      (() => {
        /* Pull YAML from Obsidian's metadata cache instead of a non‑existent property */
        const fileCache = (this.app as any).metadataCache.getFileCache(project.file);
        const fm: Record<string, any> = (fileCache?.frontmatter ?? {});

        /* helper: find front‑matter key ignoring case, spaces, underscores */
        const pick = (want: string): string | undefined => {
          const target = want.replace(/\s|_/g, "").toLowerCase();
          for (const [k, v] of Object.entries(fm)) {
            const norm = k.replace(/\s|_/g, "").toLowerCase();
            if (norm === target) return String(v).trim();
          }
          return undefined;
        };

        const startIso = pick("startdate") || pick("start");
        const endIso   = pick("enddate")   || pick("end");
        if (!startIso || !endIso) return;

        /* allow either explicit YYYY‑MM‑DD or any ISO‑like string the user writes */
        // @ts-ignore moment callable in runtime
        const s = (moment as any)(startIso, ["YYYY-MM-DD", moment.ISO_8601], true);
        // @ts-ignore
        const e = (moment as any)(endIso,   ["YYYY-MM-DD", moment.ISO_8601], true);
        if (s.isValid() && e.isValid() && e.isSameOrAfter(s)) {
          projStart = s.diff(today, "days");
          projEnd   = e.diff(today, "days");
        }
      })();
      
      /* ── always-visible baseline bar + diamond milestones ── */
      if (Number.isFinite(projStart) && Number.isFinite(projEnd) && barWrap) {
        const base = barWrap.createEl("div", { cls: "pm-proj-baseline" });
        base.style.position      = "absolute";
        base.style.left          = `${projStart * pxPerDay}px`;
        base.style.width         = `${(projEnd - projStart + 1) * pxPerDay}px`;
        base.style.height        = "6px";
        base.style.top           = "50%";
        base.style.transform     = "translateY(-50%)";
        base.style.borderRadius  = "4px";
        base.style.background    = "#ccc";     /* fallback colour; override in CSS */
        base.style.zIndex        = "1";
        base.style.pointerEvents = "auto";   // allow hover even in hidden/collapsed modes

        // Hover tooltip for always-visible baseline (works when bars are hidden)
        let baseTip: HTMLElement | null = null;
        const showBaseTip = () => {
          const cache = this.app.metadataCache.getFileCache(project.file);
          const fm: Record<string, any> = cache?.frontmatter ?? {};

          const val = (k: string) => fm[k] ?? fm[k.replace(/ /g, "").toLowerCase()] ?? "—";

          const startDate = val("Start Date") || val("start date");
          const endDate = val("End Date") || val("Due Date") || val("end date") || val("due date");
          const description = val("Description") || val("description");

          const html = `
            <strong>${project.file.basename}</strong><br>
            ${description !== "—" ? `<em>${description}</em><br>` : ""}
            <span>Start: ${startDate}</span><br>
            <span>End  : ${endDate}</span>
          `;

          baseTip = document.createElement("div");
          baseTip.className = "pm-dash-tooltip";
          baseTip.innerHTML = html;
          baseTip.style.zIndex = "10001";
          document.body.appendChild(baseTip);

          const r = base.getBoundingClientRect();
          const pad = 8;
          const w = baseTip.offsetWidth || 200;
          const h = baseTip.offsetHeight || 100;

          let left = r.left + (r.width - w) / 2;
          if (left < pad) left = pad;
          if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;

          let top = r.top - h - 8;
          if (top < pad) top = r.bottom + 8;
          if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;

          baseTip.style.left = `${left}px`;
          baseTip.style.top = `${top}px`;
        };

        const hideBaseTip = () => { baseTip?.remove(); baseTip = null; };

        base.addEventListener("mouseenter", showBaseTip);
        base.addEventListener("mouseleave", hideBaseTip);

        projMilestones.forEach(({ off, html }) => {
          const dia = barWrap.createEl("div", { cls: "pm-milestone-diamond" });
          dia.style.position   = "absolute";
          dia.style.left       = `${off * pxPerDay}px`;
          dia.style.top        = "50%";
          dia.style.width      = "8px";
          dia.style.height     = "8px";
          dia.style.transform  = "translate(-50%,-50%) rotate(45deg)";
          dia.style.zIndex     = "4";          // above bars
          dia.style.pointerEvents = "auto";    // ensure hover works

          dia.addEventListener("mouseenter", (ev) => {
            const m = ev as MouseEvent;
            const r: DOMRect = {
              left:m.clientX, right:m.clientX,
              top:m.clientY,  bottom:m.clientY,
              width:0, height:0
            } as DOMRect;
            showBarTip(html, r);
          });
          dia.addEventListener("mouseleave", hideBarTip);
        });
      }
      // Decide whether to draw bars or text lines
      const showBars = barsMode || this.collapsed.has(project.file.path);

      if (!showBars) {
        if (this.collapsed.has(project.file.path)) {
          if (Number.isFinite(projStart) && Number.isFinite(projEnd)) {
            const leftPx  = projStart * pxPerDay;                    // allow negative (before today)
            const widthPx = (projEnd - projStart + 1) * pxPerDay;    // full span
            if (widthPx > 0) {
              const projBar = barWrap.createEl("div", { cls: "pm-proj-baseline" });
              projBar.style.position = "absolute";
              projBar.style.left   = `${leftPx}px`;
              projBar.style.width  = `${widthPx}px`;
              projBar.style.height = "6px";
              projBar.style.top    = "50%";
              projBar.style.transform = "translateY(-50%)";
              projBar.style.pointerEvents = "auto"; // always allow hover events
              projBar.style.cursor        = this.plugin.settings.allowBarMove === false ? "default" : "move";
              projBar.style.zIndex        = "3";

              // Hover tooltip for collapsed baseline
              let projBaseTip: HTMLElement | null = null;
              const showProjBaseTip = () => {
                const cache = this.app.metadataCache.getFileCache(project.file);
                const fm: Record<string, any> = cache?.frontmatter ?? {};

                const val = (k: string) => fm[k] ?? fm[k.replace(/ /g, "").toLowerCase()] ?? "—";

                const startDate = val("Start Date") || val("start date");
                const endDate = val("End Date") || val("Due Date") || val("end date") || val("due date");
                const description = val("Description") || val("description");

                const html = `
                  <strong>${project.file.basename}</strong><br>
                  ${description !== "—" ? `<em>${description}</em><br>` : ""}
                  <span>Start: ${startDate}</span><br>
                  <span>End  : ${endDate}</span>
                `;

                projBaseTip = document.createElement("div");
                projBaseTip.className = "pm-dash-tooltip";
                projBaseTip.innerHTML = html;
                projBaseTip.style.zIndex = "10001";
                document.body.appendChild(projBaseTip);

                const r = projBar.getBoundingClientRect();
                const pad = 8;
                const w = projBaseTip.offsetWidth || 200;
                const h = projBaseTip.offsetHeight || 100;

                let left = r.left + (r.width - w) / 2;
                if (left < pad) left = pad;
                if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;

                let top = r.top - h - 8;
                if (top < pad) top = r.bottom + 8;
                if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;

                projBaseTip.style.left = `${left}px`;
                projBaseTip.style.top = `${top}px`;
              };

              const hideProjBaseTip = () => { projBaseTip?.remove(); projBaseTip = null; };

              projBar.addEventListener("mouseenter", showProjBaseTip);
              projBar.addEventListener("mouseleave", hideProjBaseTip);
              /* ── enable move & edge‑resize ── */
              if (this.plugin.settings.allowBarMove !== false) {
                const edge = 6;   // px on each edge for resize

                projBar.addEventListener("pointerdown", (ev) => {
                  if (ev.button !== 0) return;   // left button
                  const r = projBar.getBoundingClientRect();
                  let mode: "move" | "resize-left" | "resize-right" = "move";
                  if (ev.clientX - r.left < edge)           mode = "resize-left";
                  else if (r.right - ev.clientX < edge)     mode = "resize-right";

                  projBar.setPointerCapture(ev.pointerId);
                  currentProjDrag = {
                    barEl: projBar,
                    startClientX: ev.clientX,
                    originalStart: projStart,
                    originalWidth: r.width,
                    mode,
                    projectPath: project.file.path
                  };
                  projBar.style.opacity = "0.6";
                  projBar.style.cursor  = mode === "move" ? "grabbing" : "ew-resize";
                });

                projBar.addEventListener("pointermove", (ev) => {
                  if (!currentProjDrag || currentProjDrag.barEl !== projBar) return;
                  const deltaPx   = ev.clientX - currentProjDrag.startClientX;
                  const deltaDays = Math.round(deltaPx / this.zoomPxPerDay);

                  if (currentProjDrag.mode === "move") {
                    projBar.style.left = `${(currentProjDrag.originalStart + deltaDays) * this.zoomPxPerDay}px`;
                  } else if (currentProjDrag.mode === "resize-left") {
                    const newWidth = currentProjDrag.originalWidth - deltaPx;
                    if (newWidth > this.zoomPxPerDay) {
                      projBar.style.left  = `${(currentProjDrag.originalStart + deltaDays) * this.zoomPxPerDay}px`;
                      projBar.style.width = `${newWidth}px`;
                    }
                  } else { // resize-right
                    const newWidth = currentProjDrag.originalWidth + deltaPx;
                    if (newWidth > this.zoomPxPerDay) projBar.style.width = `${newWidth}px`;
                  }
                });

                projBar.addEventListener("pointerup", (ev) => {
                  if (!currentProjDrag || currentProjDrag.barEl !== projBar) return;
                  projBar.releasePointerCapture(ev.pointerId);
                  projBar.style.opacity = "";
                  projBar.style.cursor  = "move";

                  const deltaPx   = ev.clientX - currentProjDrag.startClientX;
                  const deltaDays = Math.round(deltaPx / this.zoomPxPerDay);

                  if (deltaDays !== 0) {
                    if (currentProjDrag.mode === "move") {
                      this.containerEl.dispatchEvent(
                        new CustomEvent("pm-project-bar-moved", {
                          detail: { projectPath: currentProjDrag.projectPath, deltaDays },
                          bubbles: true
                        })
                      );
                    } else if (currentProjDrag.mode === "resize-left") {
                      this.containerEl.dispatchEvent(
                        new CustomEvent("pm-project-bar-resized", {
                          detail: { projectPath: currentProjDrag.projectPath, deltaStart: deltaDays, deltaEnd: 0 },
                          bubbles: true
                        })
                      );
                    } else if (currentProjDrag.mode === "resize-right") {
                      this.containerEl.dispatchEvent(
                        new CustomEvent("pm-project-bar-resized", {
                          detail: { projectPath: currentProjDrag.projectPath, deltaStart: 0, deltaEnd: deltaDays },
                          bubbles: true
                        })
                      );
                    }
                  }
                  currentProjDrag = null;
                });

                /* Hover feedback: change cursor to ↔ at edges */
                projBar.addEventListener("mousemove", (ev) => {
                  if (this.plugin.settings.allowBarMove === false) return;
                  const offsetX = ev.offsetX;
                  projBar.style.cursor =
                    offsetX < edge || projBar.clientWidth - offsetX < edge ? "ew-resize" : "move";
                });
              }
            }
          }
          continue;
        }
        // Render one row per task *and* draw its bar in that row
        orderTasks(project.tasks).forEach((task) => {
          /* ----- task row: left pane ----- */
          const taskRowLeft = leftPane.createEl("div", { cls: "pm-tl-taskrow" });
          if (tlIsTaskDone(task)) {
            const chk = taskRowLeft.createEl("span");
            setIcon(chk, "check-circle");
            chk.addClass("pm-task-check");
            chk.style.marginRight = "4px";
          } else {
            taskRowLeft.createEl("span", { text: "• " });
          }

          // Build the same hover title used for timeline bars
          let dueIso = (task.props["due"] ?? "").replace(/\u00A0/g, " ").trim();
          // @ts-ignore moment callable
          const dueFmt = dueIso ? (moment as any)(dueIso, "YYYY-MM-DD").format("YYYY-MM-DD") : "‑";
          const startIso = (task.props["start"] ?? "").replace(/\u00A0/g, " ").trim();

          // Remove Tasks‑emoji date markers (🔜 ⏳ 📅 ✅ 🛫 YYYY‑MM‑DD) from the display text
          const firstLineRaw = task.text.split("\n")[0].trim();
          const firstLine    = firstLineRaw.replace(/(🔜|⏳|📅|✅|🛫)\uFE0F?\s*\d{4}-\d{2}-\d{2}/g, "").trim();

          // Ellipsis if longer than 70 chars
          const shortText = firstLine.length > 70 ? firstLine.slice(0, 67) + "…" : firstLine;

          /* ---- build E‑x. / S‑x. / SB‑x. prefix ---- */
          let prefix = "";
          {
            const idLower = task.id.toLowerCase();
            const numMatch = task.id.match(/\d+/);
            const num = numMatch ? numMatch[0] : "";
            if (idLower.startsWith("sb")) {
              prefix = `SB-${num}. `;
            } else if (idLower.startsWith("s")) {
              prefix = `S-${num}. `;
            } else if (idLower.startsWith("e")) {
              prefix = `E-${num}. `;
            }
          }

          const taskLink = taskRowLeft.createEl("a", {
            text: prefix + shortText,
            href: `${project.file.path}#^${task.id}`,
          });
        
          /* ── Hover tooltip for this task ─────────────────────────── */
          {
            let tip: HTMLElement | null = null;

            const showTip = () => {
              /* Build short text & ID prefix locally */
              const raw       = task.text.split("\n")[0].trim();
              const shortTxt  = raw.length > 70 ? raw.slice(0, 67) + "…" : raw;

              let idPrefix = "";
              {
                const idL  = task.id.toLowerCase();
                const num  = task.id.match(/\d+/)?.[0] ?? "";
                if (idL.startsWith("sb"))      idPrefix = `SB-${num}. `;
                else if (idL.startsWith("s") && !idL.startsWith("sb")) idPrefix = `S-${num}. `;
                else if (idL.startsWith("e"))  idPrefix = `E-${num}. `;
              }
              const who = (task.props["assignee"] ?? "").replace(/\u00A0/g, " ").trim() || "—";
              const fmt = (s: string) => (s && s.trim() !== "" ? s.trim() : "—");
              const desc = getDescription(task);
              const html = `
                <strong>${idPrefix}${shortTxt}</strong>${desc ? `<br><em>${desc}</em>` : ""}
                <br><span>Start: ${fmt(startIso)}</span>
                <br><span>Due&nbsp;&nbsp;: ${fmt(dueIso)}</span>
                <br><span>Assignee:&nbsp;${who}</span>
              `;

              tip = document.createElement("div");
              tip.className = "pm-dash-tooltip";
              tip.innerHTML = html;
              document.body.appendChild(tip);

              /* Position beside the link, keep on-screen and under header */
              const r   = taskLink.getBoundingClientRect();
              const pad = 8;
              const w   = tip.offsetWidth;
              let x = r.right + pad;
              if (x + w > window.innerWidth - pad) {
                x = Math.max(r.left - pad - w, pad);
              }
              const h = tip.offsetHeight;
              let y   = Math.max(r.top, 48);
              if (y + h > window.innerHeight - pad) {
                y = Math.max(window.innerHeight - h - pad, 48);
              }
              tip.style.left = `${x}px`;
              tip.style.top  = `${y}px`;
            };

            const hideTip = () => { tip?.remove(); tip = null; };

            taskLink.addEventListener("mouseenter", showTip);
            taskLink.addEventListener("mouseleave", hideTip);
          }
        
          /* Indent: Epics 0, Stories 1, SB 2 */
          {
          const idTag = (task.id ?? "").toUpperCase();
          const indent =
            idTag.startsWith("E") ? 0 :
            (idTag.startsWith("S") && !idTag.startsWith("SB")) ? 1 : 2;
          taskLink.style.marginLeft = `${indent * 12}px`;
          }
        
          /* --- bold for "E" or plain "S" (not SB) --- */
          {
            const idLower = task.id.toLowerCase();
            if (
              idLower.startsWith("e") ||                       // any "E…"
              (idLower.startsWith("s") && !idLower.startsWith("sb"))  // "S…" but NOT "SB…"
            ) {
              taskLink.classList.add("pm-task-bold");
            }
          }
          taskLink.addClass("pm-tl-label");               // inherit ellipsis styles
          taskLink.style.width = `${this.labelWidth}px`;  // same width as project column

          taskLink.onclick = (e) => {
            e.preventDefault();
            this.openAndScroll(project.file.path, task.id, task.line);
          };

          /* ----- task row: right pane with its bar ----- */
          const taskRowRight = rightPane.createEl("div", { cls: "pm-tl-row" });
          taskRowRight.dataset.proj = project.file.path;
          if (this.hiddenProjects.has(project.file.path))
            taskRowRight.classList.add("pm-hide-bars");          
          /* Ensure separator spans the full timeline width */
          taskRowRight.style.minWidth = `${(horizon + 1) * pxPerDay}px`;
          /* If the timeline has exactly one project, make each task row shorter */
          let taskBarWrap: HTMLDivElement;
          if (projects.length === 1) {
            taskRowLeft.style.height  = "27px";
            taskRowRight.style.height = "27px";
            /* keep bar‑wrap in sync */
            taskBarWrap = taskRowRight.createEl("div", { cls: "pm-tl-barwrap" });
            taskBarWrap.style.height = "27px";
            /* IMPORTANT: barWrap must be the *first* child so existing logic can reuse it */
            taskRowRight.insertBefore(taskBarWrap, taskRowRight.firstChild);
          } else {
            /* multi‑project: create the barWrap as usual */
            taskBarWrap = taskRowRight.createEl("div", { cls: "pm-tl-barwrap" });
            taskBarWrap.style.height = "27px";   // default task row height
            taskRowRight.insertBefore(taskBarWrap, taskRowRight.firstChild);
          }
          taskBarWrap.style.position = "relative";   // make this the positioning context
          
          // ── draw the bar exactly as in the normal loop ──
          let dueIsoBar = task.props["due"] ?? "";
          dueIsoBar = dueIsoBar.replace(/\u00A0/g, " ").trim();
          if (!dueIsoBar) return;

          // @ts-ignore callable moment present at runtime
          const due = (moment as any)(dueIsoBar, "YYYY-MM-DD");
          if (!due.isValid()) return;

          const dayOffset = due.diff(today, "days");
          // Allow bars far outside the viewport; rely on scroll/zoom to reveal
          // if (dayOffset < -30 || dayOffset > 365) return;

          const bar = taskBarWrap.createEl("div", { cls: "pm-tl-bar" });
        
          const taskKey = key(task);
          (bar as any).dataset.task = taskKey;
          bar.addEventListener("mouseenter", () => highlightArrows(taskKey, true));
          bar.addEventListener("mouseleave", () => highlightArrows(taskKey, false));
        
          // ── track pointer movement so we can suppress post-drag clicks ──
          let dragMoved  = false;
          let dragStartX = 0;

          bar.addEventListener("pointerdown", (ev) => {
            dragMoved  = false;
            dragStartX = ev.clientX;
          });
          bar.addEventListener("pointermove", (ev) => {
            if (Math.abs(ev.clientX - dragStartX) > 3) dragMoved = true;   // >3 px = drag
          });
        
          /* --- colour by ID prefix --- */
          {
            const idLower = task.id.toLowerCase();
            if (idLower.startsWith("e")) {
              bar.addClass("pm-bar-e");          // red
            } else if (idLower.startsWith("sb")) {
              bar.addClass("pm-bar-sb");         // light blue
            } else if (idLower.startsWith("s")) {
              bar.addClass("pm-bar-s");          // grey
            }
          }
          /* --- urgency colour by due date (skip completed tasks) --- */
          if (!task.checked) {
            if (dayOffset < 0) {
              bar.addClass("pm-bar-overdue");   // red
            } else if (dayOffset <= 10) {
              bar.addClass("pm-bar-warning");   // orange
            }
          }
          
          // Support multi‑day tasks when a start:: date exists
          const startIsoBar = (task.props["start"] ?? "").replace(/\u00A0/g, " ").trim();
          let startOffset  = dayOffset;  // default single‑day bar
          let durationDays = 1;

          // (moved: update project span after startOffset/durationDays are final)
          // projStart = Math.min(projStart, startOffset);
          // projEnd   = Math.max(projEnd, startOffset + durationDays - 1);
          
          if (startIsoBar) {
            // @ts-ignore moment callable
            const start = (moment as any)(startIsoBar, "YYYY-MM-DD");
            if (start.isValid()) {
              startOffset  = start.diff(today, "days");
              /* +1 so the bar includes the due‑date day */
              durationDays = Math.max(due.diff(start, "days") + 1, 1);
            }
          }

          /* Heat‑map tally (exclude "E" and plain "S") */
          {
            const idL = task.id.toLowerCase();
            const isPlainS = idL.startsWith("s") && !idL.startsWith("sb");
            if (!idL.startsWith("e") && !isPlainS) {
              addHeat(startOffset, durationDays);
            }
          }
          /* Record milestones so we can draw vertical guideline bars */
          {
            const idLower = task.id.toLowerCase();
            const isMilestone =
              idLower.startsWith("m") ||                         // ID begins with "M…"
              ((task.props["milestone"] ?? "")
              .toString()
              .toLowerCase() === "true");                     // or milestone:: true
            if (isMilestone && isProjectVisible(project.file.path)) {
              milestoneOffsets.add(startOffset);      // or startOff
              const desc = getDescription(task);
              const html =
                `<span><strong>Project:</strong> ${project.file.basename}</span><br>` +
                `<strong>${task.id}</strong><br>${dueIso}` +        // or dueIsoBar
                (desc ? `<br>${desc}` : "");
              milestoneMap.set(startOffset, html);     // or startOff
            }
          }
          
          bar.style.left  = `${startOffset * pxPerDay}px`;
          bar.style.width = `${Math.max(durationDays * pxPerDay, 3)}px`;
          bar.style.zIndex = "2";     // keep bars below sticky headers
          // record coordinates
          barsById[key(task)] = {
            x: startOffset * pxPerDay,
            w: Math.max(durationDays * pxPerDay, 3),
            el: bar,
          };
          tasksById.set(key(task), task);

          /* ───────────────── Drag‑to‑reschedule (left‑drag) and resize handles ───────────── */
          if (this.plugin.settings.allowBarMove !== false) {
            const origOffset = startOffset;          // day offset for this bar
            /* ---- resize handles (6px wide) ---- */
            const leftHandle = bar.createEl("div", { cls: "pm-resize-handle left" });
            const rightHandle = bar.createEl("div", { cls: "pm-resize-handle right" });

            [leftHandle, rightHandle].forEach(h => {
              h.style.position = "absolute";
              h.style.top = "0";
              h.style.width = "6px";
              h.style.height = "100%";
              h.style.cursor = "ew-resize";
              h.style.touchAction = "none";
              h.style.background = "transparent";
            });
            leftHandle.style.left = "0";
            rightHandle.style.right = "0";

            /* pointer events */
            leftHandle.addEventListener("pointerdown", (ev) => {
              if (ev.button !== 0) return;
              ev.stopPropagation();
              bar.setPointerCapture(ev.pointerId);
              currentDrag = {
                barEl: bar,
                startClientX: ev.clientX,
                originalDayOffset: startOffset,
                originalSpan: durationDays,
                taskPath: project.file.path + "::" + task.id,
                mode: "resize-left"
              };
            });
            rightHandle.addEventListener("pointerdown", (ev) => {
              if (ev.button !== 0) return;
              ev.stopPropagation();
              bar.setPointerCapture(ev.pointerId);
              currentDrag = {
                barEl: bar,
                startClientX: ev.clientX,
                originalDayOffset: startOffset,
                originalSpan: durationDays,
                taskPath: project.file.path + "::" + task.id,
                mode: "resize-right"
              };
            });

            bar.addEventListener("pointerdown", (ev) => {
              if (ev.button !== 0) return;           // left‑button only
              ev.preventDefault();

              /* ── suppress the bar's normal click while we drag ── */
              const suppress = (e: MouseEvent) => { e.stopImmediatePropagation(); e.preventDefault(); };
              bar.addEventListener("click", suppress, true);           // capture phase
              
              /* Remove suppression AFTER the click event queue has fired */
              const unhook = () => setTimeout(() => bar.removeEventListener("click", suppress, true), 0);
              bar.addEventListener("pointerup", unhook,   { once: true });
              bar.addEventListener("pointercancel", unhook, { once: true });

              bar.setPointerCapture(ev.pointerId);
              currentDrag = {
                barEl: bar,
                startClientX: ev.clientX,
                originalDayOffset: origOffset,
                originalSpan: durationDays,
                taskPath: project.file.path + "::" + task.id,
                mode: "move"
              };
              bar.style.opacity = "0.6";
            });

            bar.addEventListener("pointermove", (ev) => {
              if (!currentDrag || currentDrag.barEl !== bar) return;
              const deltaPx   = ev.clientX - currentDrag.startClientX;
              const deltaDays = Math.round(deltaPx / this.zoomPxPerDay);

              if (currentDrag.mode === "move") {
                const newOffset = currentDrag.originalDayOffset + deltaDays;
                bar.style.left  = `${newOffset * this.zoomPxPerDay}px`;
              } else if (currentDrag.mode === "resize-left") {
                const newOffset = currentDrag.originalDayOffset + deltaDays;
                const newSpan   = currentDrag.originalSpan - deltaDays;
                if (newSpan >= 1) {
                  bar.style.left  = `${newOffset * this.zoomPxPerDay}px`;
                  bar.style.width = `${newSpan * this.zoomPxPerDay}px`;
                }
              } else { // resize-right
                const newSpan = currentDrag.originalSpan + deltaDays;
                if (newSpan >= 1) {
                  bar.style.width = `${newSpan * this.zoomPxPerDay}px`;
                }
              }
            });

            bar.addEventListener("pointerup", (ev) => {
              if (!currentDrag || currentDrag.barEl !== bar) return;
              bar.releasePointerCapture(ev.pointerId);
              bar.style.opacity = "";
              const deltaDays = Math.round(
                (ev.clientX - currentDrag.startClientX) / this.zoomPxPerDay
              );
              if (deltaDays !== 0) {
                if (currentDrag.mode === "move") {
                  this.containerEl.dispatchEvent(
                    new CustomEvent("pm-bar-moved", {
                      detail: { taskKey: currentDrag.taskPath, deltaDays },
                      bubbles: true
                    })
                  );
                } else {
                  const detail = {
                    taskKey: currentDrag.taskPath,
                    deltaStart: currentDrag.mode === "resize-left"  ? deltaDays : 0,
                    deltaDue:   currentDrag.mode === "resize-right" ? deltaDays : 0
                  };
                  this.containerEl.dispatchEvent(
                    new CustomEvent("pm-bar-resized", { detail, bubbles: true })
                  );
                }
              }
              currentDrag = null;
              // Immediate re-render removed; rely on main.ts refresh
            });
          }

          /* show labels only when tasks list is visible (eye ON) */
          if (
          (this.plugin.settings.showAssignees !== false) &&
          !barsMode &&                               /* tasks list visible */
          !this.collapsed.has(project.file.path)     /* project expanded */
          ) {
            const who = (task.props["assignee"] ?? "").replace(/\u00A0/g, " ").trim();
            if (who) {
              const lbl = taskBarWrap.createEl("span", { cls: "pm-assignee", text: who });
              if (who === "—") {
                lbl.style.color = "red";   // show unassigned placeholder in red
              }
              lbl.style.position       = "absolute";
              const leftPx = parseFloat(bar.style.left || "0") + parseFloat(bar.style.width || "0") + 4;
              lbl.style.left           = `${leftPx}px`;   // 4‑px gap after bar
              lbl.style.top            = "50%";
              lbl.style.transform      = "translateY(-50%)";
              lbl.style.whiteSpace     = "nowrap";
              lbl.style.pointerEvents  = "none";
            }
          }
          if (task.checked) bar.addClass("pm-tl-bar-done");

          bar.onclick = (e) => {
            // Suppress clicks that follow a drag, or when move-mode is enabled
            if (dragMoved || this.plugin.settings.allowBarMove !== false) {
              e.preventDefault();
              return;
            }
            e.preventDefault();
            this.openAndScroll(project.file.path, task.id, task.line);
          };
        
          /* ── shared tooltip (task‑row bar) ── */
          {
            const buildHtml = () => {
              const fmt = (s: string) => (s && s.trim() ? s.trim() : "—");
              const desc = getDescription(task);
              const raw  = task.text.split("\n")[0].trim();
              const shortTxt = raw.length > 70 ? raw.slice(0, 67) + "…" : raw;
              const who = (task.props["assignee"] ?? "").replace(/\u00A0/g, " ").trim() || "—";
              
              let idPrefix = "";
              {
                const low = task.id.toLowerCase();
                const num = task.id.match(/\d+/)?.[0] ?? "";
                if (low.startsWith("sb"))      idPrefix = `SB-${num}. `;
                else if (low.startsWith("s") && !low.startsWith("sb")) idPrefix = `S-${num}. `;
                else if (low.startsWith("e"))  idPrefix = `E-${num}. `;
              }

              return `<strong>${idPrefix}${shortTxt}</strong>${desc ? `<br><em>${desc}</em>` : ""}`
                   + `<br><span>Start: ${fmt(startIso)}</span>`
                   + `<br><span>Due&nbsp;&nbsp;: ${fmt(dueIso)}</span>`
                   + `<br><span>Assignee:&nbsp;${who}</span>`;
            };

            bar.addEventListener("mouseenter", (ev) => {
              const m = ev as MouseEvent;
              const fakeRect = {
                left:   m.clientX,
                right:  m.clientX,
                top:    m.clientY,
                bottom: m.clientY,
                width:  0,
                height: 0,
              } as DOMRect;
              showBarTip(buildHtml(), fakeRect);
            });
            bar.addEventListener("mouseleave", hideBarTip);
          }
        });

        /* draw backdrop bar after task rows so it sits underneath them */
        if (Number.isFinite(projStart) && Number.isFinite(projEnd)) {
          const leftPx  = projStart * pxPerDay;
          const widthPx = (projEnd - projStart + 1) * pxPerDay;
          if (widthPx > 0) {
            const projBar = barWrap.createEl("div", { cls: "pm-proj-bar" });
            projBar.style.position = "absolute";
            projBar.style.left   = `${leftPx}px`;
            projBar.style.width  = `${widthPx}px`;
            projBar.style.height = "18px";
            projBar.style.top    = "50%";
            projBar.style.transform = "translateY(-50%)";
            projBar.style.pointerEvents = "auto"; // always allow hover events
            projBar.style.cursor        = this.plugin.settings.allowBarMove === false ? "default" : "move";
            projBar.style.zIndex        = "3";

            /* ── Project bar hover tooltip ─────────────────────────── */
            let projTip: HTMLElement | null = null;
            const showProjTip = () => {
              /* Get latest front‑matter */
              const cache = this.app.metadataCache.getFileCache(project.file);
              const fm: Record<string, any> = cache?.frontmatter ?? {};

              const val = (k: string) =>
                fm[k] ?? fm[k.replace(/ /g, "").toLowerCase()] ?? "—";

              const startDate = val("Start Date") || val("start date");
              const endDate = val("End Date") || val("Due Date") || val("end date") || val("due date");
              const description = val("Description") || val("description");

              const html = `
                <strong>${project.file.basename}</strong><br>
                ${description !== "—" ? `<em>${description}</em><br>` : ""}
                <span>Start: ${startDate}</span><br>
                <span>End  : ${endDate}</span>
              `;

              projTip = document.createElement("div");
              projTip.className = "pm-dash-tooltip";
              projTip.innerHTML = html;
              projTip.style.zIndex = "10001"; // Ensure it's above everything
              document.body.appendChild(projTip);

              const r = projBar.getBoundingClientRect();
              const pad = 8;
              const w = projTip.offsetWidth || 200;
              const h = projTip.offsetHeight || 100;

              let left = r.left + (r.width - w) / 2;
              if (left < pad) left = pad;
              if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;

              let top = r.top - h - 8;
              if (top < pad) top = r.bottom + 8;
              if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;

              projTip.style.left = `${left}px`;
              projTip.style.top = `${top}px`;

            };

            const hideProjTip = () => {
              projTip?.remove();
              projTip = null;
            };

            /* ── Project bar hover tooltip ─────────────────────────── */
            projBar.addEventListener("mouseenter", (e) => {

              projBar.style.backgroundColor = "red"; // Visual test
              showProjTip();
            });
            projBar.addEventListener("mouseleave", (e) => {

              projBar.style.backgroundColor = ""; // Reset visual test
              hideProjTip();
            });
            
            /* ── enable move & edge‑resize ── */
            if (this.plugin.settings.allowBarMove !== false) {
              const edge = 6;   // px on each edge for resize

              projBar.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0) return;   // left button

                /* prevent project link from opening while dragging */
                ev.preventDefault();
                const suppress = (e: MouseEvent) => { e.stopImmediatePropagation(); e.preventDefault(); };
                projBar.addEventListener("click", suppress, true);
                const unhook = () => setTimeout(() => projBar.removeEventListener("click", suppress, true), 0);
                projBar.addEventListener("pointerup", unhook,   { once: true });
                projBar.addEventListener("pointercancel", unhook, { once: true });

                const r = projBar.getBoundingClientRect();
                let mode: "move" | "resize-left" | "resize-right" = "move";
                if (ev.clientX - r.left < edge)           mode = "resize-left";
                else if (r.right - ev.clientX < edge)     mode = "resize-right";

                projBar.setPointerCapture(ev.pointerId);
                currentProjDrag = {
                  barEl: projBar,
                  startClientX: ev.clientX,
                  originalStart: projStart,
                  originalWidth: r.width,
                  mode,
                  projectPath: project.file.path
                };
                projBar.style.opacity = "0.6";
                projBar.style.cursor  = mode === "move" ? "grabbing" : "ew-resize";
              });

              projBar.addEventListener("pointermove", (ev) => {
                if (!currentProjDrag || currentProjDrag.barEl !== projBar) return;
                const deltaPx   = ev.clientX - currentProjDrag.startClientX;
                const deltaDays = Math.round(deltaPx / this.zoomPxPerDay);

                if (currentProjDrag.mode === "move") {
                  projBar.style.left = `${(currentProjDrag.originalStart + deltaDays) * this.zoomPxPerDay}px`;
                } else if (currentProjDrag.mode === "resize-left") {
                  const newWidth = currentProjDrag.originalWidth - deltaPx;
                  if (newWidth > this.zoomPxPerDay) {
                    projBar.style.left  = `${(currentProjDrag.originalStart + deltaDays) * this.zoomPxPerDay}px`;
                    projBar.style.width = `${newWidth}px`;
                  }
                } else { // resize-right
                  const newWidth = currentProjDrag.originalWidth + deltaPx;
                  if (newWidth > this.zoomPxPerDay) projBar.style.width = `${newWidth}px`;
                }
              });

              projBar.addEventListener("pointerup", (ev) => {
                if (!currentProjDrag || currentProjDrag.barEl !== projBar) return;
                projBar.releasePointerCapture(ev.pointerId);
                projBar.style.opacity = "";
                projBar.style.cursor  = "move";

                const deltaPx   = ev.clientX - currentProjDrag.startClientX;
                const deltaDays = Math.round(deltaPx / this.zoomPxPerDay);

                if (deltaDays !== 0) {
                  if (currentProjDrag.mode === "move") {
                    this.containerEl.dispatchEvent(
                      new CustomEvent("pm-project-bar-moved", {
                        detail: { projectPath: currentProjDrag.projectPath, deltaDays },
                        bubbles: true
                      })
                    );
                  } else if (currentProjDrag.mode === "resize-left") {
                    this.containerEl.dispatchEvent(
                      new CustomEvent("pm-project-bar-resized", {
                        detail: { projectPath: currentProjDrag.projectPath, deltaStart: deltaDays, deltaEnd: 0 },
                        bubbles: true
                      })
                    );
                  } else if (currentProjDrag.mode === "resize-right") {
                    this.containerEl.dispatchEvent(
                      new CustomEvent("pm-project-bar-resized", {
                        detail: { projectPath: currentProjDrag.projectPath, deltaStart: 0, deltaEnd: deltaDays },
                        bubbles: true
                      })
                    );
                  }
                }
                currentProjDrag = null;
              });

              /* Hover feedback: change cursor to ↔ at edges */
              projBar.addEventListener("mousemove", (ev) => {
                if (this.plugin.settings.allowBarMove === false) return;
                const offsetX = ev.offsetX;
                projBar.style.cursor =
                  offsetX < edge || projBar.clientWidth - offsetX < edge ? "ew-resize" : "move";
              });
            }
          }
        }
        continue; // skip project‑level bar rendering (already drawn above)
      }

      if (!barsMode && !this.collapsed.has(project.file.path)) {
        orderTasks(project.tasks).forEach((task) => {
          /* --- ensure every task has an anchor so arrows can attach --- */
          const anchor = barWrap.createEl("div", { cls: "pm-tl-anchor" });
          anchor.style.left   = "0px";
          anchor.style.width  = "1px";
          anchor.style.height = "14px";
          anchor.style.opacity = "0";
          anchor.style.pointerEvents = "none";   // allow bar tooltip to show
          barsById[key(task)] = { x: 0, w: 1, el: anchor };
          tasksById.set(key(task), task);
          // Collapsed-tasks block: show icon for completed tasks
          const taskRowLeft = leftPane.createEl("div", { cls: "pm-tl-taskrow" });
          if (tlIsTaskDone(task)) {
            const chk = taskRowLeft.createEl("span");
            setIcon(chk, "check-circle");
            chk.addClass("pm-task-check");
            chk.style.marginRight = "4px";
          } else {
            taskRowLeft.createEl("span", { text: "• " });
          }
          let dueIso = task.props["due"] ?? "";
          dueIso = dueIso.replace(/\u00A0/g, " ").trim();   // strip NBSP + trim

          if (!dueIso) return;

          // @ts-ignore – see above
          const due = (moment as any)(dueIso, "YYYY-MM-DD");
          if (!due.isValid()) {

            return;
          }
          const dayOffset = due.diff(today, "days");
          // Allow bars far outside the viewport; rely on scroll/zoom to reveal
          // if (dayOffset < -30 || dayOffset > 365) return; // skip far dates

          const bar = barWrap.createEl("div", { cls: "pm-tl-bar" });
        
          // ── track pointer movement so we can suppress post-drag clicks ──
          let dragMoved  = false;
          let dragStartX = 0;

          bar.addEventListener("pointerdown", (ev) => {
            dragMoved  = false;
            dragStartX = ev.clientX;
          });
          bar.addEventListener("pointermove", (ev) => {
            if (Math.abs(ev.clientX - dragStartX) > 3) dragMoved = true;   // >3 px = drag
          });
        
          /* --- colour by ID prefix --- */
          {
            const idLower = task.id.toLowerCase();
            if (idLower.startsWith("e")) {
              bar.addClass("pm-bar-e");          // red
            } else if (idLower.startsWith("sb")) {
              bar.addClass("pm-bar-sb");         // light blue
            } else if (idLower.startsWith("s")) {
              bar.addClass("pm-bar-s");          // grey
            }
          }
          /* --- urgency colour by due date (skip completed tasks) --- */
          if (!task.checked) {
            if (dayOffset < 0) {
              bar.addClass("pm-bar-overdue");   // red
            } else if (dayOffset <= 10) {
              bar.addClass("pm-bar-warning");   // orange
            }
          }
          
          // Support multi‑day tasks when a start:: date exists
          const startIso = (task.props["start"] ?? "").replace(/\u00A0/g, " ").trim();
          let startOffset  = dayOffset;  // default single‑day bar
          let durationDays = 1;

          // (moved: update project span after startOffset/durationDays are final)
          // projStart = Math.min(projStart, startOffset);
          // projEnd   = Math.max(projEnd, startOffset + durationDays - 1);
          
          if (startIso) {
            // @ts-ignore – Obsidian bundles callable moment
            const start = (moment as any)(startIso, "YYYY-MM-DD");
            if (start.isValid()) {
              startOffset  = start.diff(today, "days");
              /* +1 so the bar includes the due‑date day */
              durationDays = Math.max(due.diff(start, "days") + 1, 1);
            }
          }
          
          /* Heat‑map tally (exclude "E" and plain "S") */
          {
            const idL = task.id.toLowerCase();
            const isPlainS = idL.startsWith("s") && !idL.startsWith("sb");
            if (!idL.startsWith("e") && !isPlainS) {
              addHeat(startOffset, durationDays);
            }
          }
          
          /* Record milestones so we can draw vertical guideline bars */
          {
            const idLower = task.id.toLowerCase();
            const isMilestone =
              idLower.startsWith("m") ||                         // ID begins with "M…"
              ((task.props["milestone"] ?? "")
              .toString()
              .toLowerCase() === "true");                     // or milestone:: true
            if (isMilestone) {
              milestoneOffsets.add(startOffset);      // or startOff
              const desc = getDescription(task);
              const html =
                `<span><strong>Project:</strong> ${project.file.basename}</span><br>` +
                `<strong>${task.id}</strong><br>${dueIso}` +        // or dueIsoBar
                (desc ? `<br>${desc}` : "");
              milestoneMap.set(startOffset, html);     // or startOff
            }  
          }        
          bar.style.left  = `${startOffset * pxPerDay}px`;
          bar.style.width = `${Math.max(durationDays * pxPerDay, 3)}px`;
          bar.style.zIndex = "2";     // keep bars below sticky headers

          /* custom tooltip */
          {
            let tip: HTMLElement | null = null;
            const show = () => {
 
              /* Build idPrefix + shortTxt for this scope */
              const rawLine  = task.text.split("\n")[0].trim();
              const shortTxt = rawLine.length > 70 ? rawLine.slice(0, 67) + "…" : rawLine;

              let idPrefix = "";
              {
                const low = task.id.toLowerCase();
                const num = task.id.match(/\d+/)?.[0] ?? "";
                if (low.startsWith("sb"))      idPrefix = `SB-${num}. `;
                else if (low.startsWith("s") && !low.startsWith("sb")) idPrefix = `S-${num}. `;
                else if (low.startsWith("e"))  idPrefix = `E-${num}. `;
              }
              
              const desc = getDescription(task);
              const fmt  = (s: string) => (s && s.trim() ? s.trim() : "—");
              const html = `
                <strong>${idPrefix}${shortTxt}</strong>${desc ? `<br><em>${desc}</em>` : ""}
                <br><span>Start: ${fmt(startIso)}</span>
                <br><span>Due&nbsp;&nbsp;: ${fmt(dueIso)}</span>
              `;
              tip = document.createElement("div");
              tip.className = "pm-dash-tooltip";
              tip.innerHTML = html;
              document.body.appendChild(tip);

              const r   = bar.getBoundingClientRect();
              const pad = 8;
              const w   = tip.offsetWidth;
              tip.style.left =
                r.right + pad + w <= window.innerWidth
                  ? `${r.right + pad}px`
                  : `${Math.max(r.left - pad - w, 4)}px`;
              tip.style.top = `${Math.max(r.top, 48)}px`;
            };
            const hide = () => { tip?.remove(); tip = null; };
            bar.addEventListener("mouseenter", show);
            bar.addEventListener("mouseleave", hide);
          }
        
          /* ───────────────── Drag‑to‑reschedule (hold Alt + drag) and resize handles ───────────── */
          {
            if (plugin.settings.allowBarMove !== false) {  // default ON when undefined
              const origOffset = startOffset;           // day offset for this bar
              /* ---- resize handles (6px wide) ---- */
              const leftHandle = bar.createEl("div", { cls: "pm-resize-handle left" });
              const rightHandle = bar.createEl("div", { cls: "pm-resize-handle right" });

              [leftHandle, rightHandle].forEach(h => {
                h.style.position = "absolute";
                h.style.top = "0";
                h.style.width = "6px";
                h.style.height = "100%";
                h.style.cursor = "ew-resize";
                h.style.touchAction = "none";
                h.style.background = "transparent";
              });
              leftHandle.style.left = "0";
              rightHandle.style.right = "0";

              /* pointer events */
              leftHandle.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0) return;
                ev.stopPropagation();
                bar.setPointerCapture(ev.pointerId);
                currentDrag = {
                  barEl: bar,
                  startClientX: ev.clientX,
                  originalDayOffset: startOffset,
                  originalSpan: durationDays,
                  taskPath: project.file.path + "::" + task.id,
                  mode: "resize-left"
                };
              });
              rightHandle.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0) return;
                ev.stopPropagation();
                bar.setPointerCapture(ev.pointerId);
                currentDrag = {
                  barEl: bar,
                  startClientX: ev.clientX,
                  originalDayOffset: startOffset,
                  originalSpan: durationDays,
                  taskPath: project.file.path + "::" + task.id,
                  mode: "resize-right"
                };
              });

              bar.addEventListener("pointerdown", (ev) => {

                if (ev.button !== 0) return;    // left‑button only
                ev.preventDefault();
                bar.setPointerCapture(ev.pointerId);
                currentDrag = {
                  barEl: bar,
                  startClientX: ev.clientX,
                  originalDayOffset: origOffset,
                  originalSpan: durationDays,
                  taskPath: project.file.path + "::" + task.id,
                  mode: "move"
                };
                bar.style.opacity = "0.6";
              });

              bar.addEventListener("pointermove", (ev) => {
                if (!currentDrag || currentDrag.barEl !== bar) return;
                const deltaPx   = ev.clientX - currentDrag.startClientX;
                const deltaDays = Math.round(deltaPx / this.zoomPxPerDay);

                if (currentDrag.mode === "move") {
                  const newOffset = currentDrag.originalDayOffset + deltaDays;
                  bar.style.left  = `${newOffset * this.zoomPxPerDay}px`;
                } else if (currentDrag.mode === "resize-left") {
                  const newOffset = currentDrag.originalDayOffset + deltaDays;
                  const newSpan   = currentDrag.originalSpan - deltaDays;
                  if (newSpan >= 1) {
                    bar.style.left  = `${newOffset * this.zoomPxPerDay}px`;
                    bar.style.width = `${newSpan * this.zoomPxPerDay}px`;
                  }
                } else { // resize-right
                  const newSpan = currentDrag.originalSpan + deltaDays;
                  if (newSpan >= 1) {
                    bar.style.width = `${newSpan * this.zoomPxPerDay}px`;
                  }
                }
              });

              bar.addEventListener("pointerup", (ev) => {
                if (!currentDrag || currentDrag.barEl !== bar) return;
                bar.releasePointerCapture(ev.pointerId);
                bar.style.opacity = "";
                const deltaDays = Math.round(
                  (ev.clientX - currentDrag.startClientX) / this.zoomPxPerDay
                );
                if (deltaDays !== 0) {
                  if (currentDrag.mode === "move") {
                    /* Bubble event so main.ts (or another controller) can update markdown */
                    this.containerEl.dispatchEvent(
                      new CustomEvent("pm-bar-moved", {
                        detail: { taskKey: currentDrag.taskPath, deltaDays },
                        bubbles: true
                      })
                    );
                  } else {
                    const detail = {
                      taskKey: currentDrag.taskPath,
                      deltaStart: currentDrag.mode === "resize-left"  ? deltaDays : 0,
                      deltaDue:   currentDrag.mode === "resize-right" ? deltaDays : 0
                    };
                    this.containerEl.dispatchEvent(
                      new CustomEvent("pm-bar-resized", { detail, bubbles: true })
                    );
                  }
                }
                currentDrag = null;
                // Immediate re-render removed; rely on main.ts refresh
              });
            }
          }

          
          // record coordinates
          barsById[key(task)] = {
            x: startOffset * pxPerDay,
            w: Math.max(durationDays * pxPerDay, 3),
            el: bar,
          };
          tasksById.set(key(task), task);
          /* show labels only when tasks list is visible (eye ON) */
          if (
            (this.plugin.settings.showAssignees !== false) &&
            !barsMode &&                               /* tasks list visible */
            !this.collapsed.has(project.file.path)
          ) {
            const who = (task.props["assignee"] ?? "").replace(/\u00A0/g, " ").trim();
            if (who) {
              const lbl = barWrap.createEl("span", { cls: "pm-assignee", text: who });
              lbl.style.position = "absolute";
              const leftPx2 = parseFloat(bar.style.left || "0") + parseFloat(bar.style.width || "0") + 4;
              lbl.style.left = `${leftPx2}px`;   // 4‑px gap after bar
              lbl.style.top = "50%";
              lbl.style.transform = "translateY(-50%)";
              lbl.style.whiteSpace = "nowrap";
              lbl.style.pointerEvents = "none";
            }
          }
          if (task.checked) bar.addClass("pm-tl-bar-done");

          bar.onclick = (e) => {
            // Suppress clicks that follow a drag, or when move-mode is enabled
            if (dragMoved || this.plugin.settings.allowBarMove !== false) {
              e.preventDefault();
              return;
            }
            e.preventDefault();
            this.openAndScroll(project.file.path, task.id, task.line);
          };
        });
      }

      /* After task rows, draw one background bar spanning YAML Start → End
         so users still see the overall project duration. */
      if (Number.isFinite(projStart) && Number.isFinite(projEnd)) {
        const leftPx  = projStart * pxPerDay;
        const widthPx = (projEnd - projStart + 1) * pxPerDay;
        if (widthPx > 0) {
          const projBar = barWrap.createEl("div", { cls: "pm-proj-bar" });
          projBar.style.position = "absolute";
          projBar.style.left   = `${leftPx}px`;
          projBar.style.width  = `${widthPx}px`;
          projBar.style.height = "18px";
          projBar.style.top    = "50%";
          projBar.style.transform = "translateY(-50%)";
        }
      }

    }

    /** Highlight / un-highlight dependency arrows connected to a task bar. */
    const highlightArrows = (taskKey: string, on: boolean) => {
      arrowLayer
        .querySelectorAll<SVGPathElement>('path.pm-dep-arrow')
        .forEach(path => {
          const { src, dst } =
            (path as any).dataset as { src?: string; dst?: string };
          if (src === taskKey || dst === taskKey) {
            if (on) {
              path.classList.add('pm-arrow-hover');
              // ⬇︎ enforce red stroke, overriding any CSS !important
              path.style.setProperty('stroke', '#d00', 'important');
              path.setAttribute('stroke', '#d00');
              const hovUrl = arrowLayer.getAttribute('data-hover-marker-url') || '';
              if (hovUrl) path.setAttribute('marker-end', hovUrl);
            } else {
              path.classList.remove('pm-arrow-hover');
              path.style.removeProperty('stroke');
              path.removeAttribute('stroke');
              const baseUrl = arrowLayer.getAttribute('data-marker-url') || '';
              if (baseUrl) path.setAttribute('marker-end', baseUrl);
            }
          }
        });
    };
    
    /* ---------- dependency arrows ---------- */
    const drawArrows = () => {
      arrowLayer.innerHTML = "";                    // reset
      /* Width & height are controlled by CSS (100%); explicit attributes caused
         self‑inflation on each draw and led to excessive horizontal scroll. */
      
      const containerRect = rightPane.getBoundingClientRect();
      const svgNS = "http://www.w3.org/2000/svg";

      /* one marker definition is enough */
      const defs   = document.createElementNS(svgNS, "defs");
      arrowLayer.appendChild(defs);
      // Generate unique IDs per draw to avoid cross-SVG collisions
      const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
      const markerId = `pmArrowHead-${uniq}`;
      const hoverMarkerId = `pmArrowHeadHover-${uniq}`;

      // Expose URLs so other handlers (e.g., bar hover) can reference them
      arrowLayer.setAttribute('data-marker-url', `url(#${markerId})`);
      arrowLayer.setAttribute('data-hover-marker-url', `url(#${hoverMarkerId})`);

      const marker = document.createElementNS(svgNS, "marker");
      defs.appendChild(marker);
      marker.setAttribute("id", markerId);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "10");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto");
      const head = document.createElementNS(svgNS, "path");
      head.setAttribute("d", "M 0 0 10 5 0 10 Z");
      head.classList.add("pm-dep-arrow");
      marker.appendChild(head);

      /* --- hover variant of arrow‑head --------------------------------------- */
      const markerHover = document.createElementNS(svgNS, "marker");
      defs.appendChild(markerHover);
      markerHover.setAttribute("id", hoverMarkerId);
      markerHover.setAttribute("viewBox", "0 0 10 10");
      markerHover.setAttribute("refX", "10");
      markerHover.setAttribute("refY", "5");
      markerHover.setAttribute("markerWidth", "6");
      markerHover.setAttribute("markerHeight", "6");
      markerHover.setAttribute("orient", "auto");

      const headHover = document.createElementNS(svgNS, "path");
      headHover.setAttribute("d", "M 0 0 10 5 0 10 Z");
      /* Create a completely separate arrowhead with no inherited styles */
      headHover.setAttribute("fill", "#d00");
      headHover.setAttribute("stroke", "#d00");
      headHover.setAttribute("stroke-width", "1");
      /* Set fill on marker element as well */
      markerHover.setAttribute("fill", "#d00");
      /* Also set the marker's fill attribute */
      markerHover.setAttribute("fill-opacity", "1");
      markerHover.appendChild(headHover);

      this.cache.tasks.forEach((task) => {
        if (!task.depends?.length) return;
        const dst = barsById[key(task)];
        if (!dst) return;

        task.depends.forEach((depStr) => {
          /* Robust parser: FS default, or SS / FF / SF prefix */
          let linkType: "FS" | "SS" | "FF" | "SF" = "FS";
          let depId = depStr.trim();

          const colon = depStr.indexOf(":");
          if (colon !== -1) {
            linkType = depStr.slice(0, colon).toUpperCase() as any; // FS / SS / FF / SF
            depId    = depStr.slice(colon + 1).trim();
          }

          const srcId = key(depId, task.file.path);
          const src     = barsById[srcId];
          const srcTask = tasksById.get(srcId);
          if (!src || !srcTask) return;
          if (srcTask.file.path !== task.file.path) return;

          const srcRect = src.el.getBoundingClientRect();
          const dstRect = dst.el.getBoundingClientRect();

          const y1 = srcRect.top + srcRect.height / 2 - containerRect.top + rightPane.scrollTop;
          const rowTopSrc = srcRect.top - containerRect.top + rightPane.scrollTop;
          const rowTopDst = dstRect.top - containerRect.top + rightPane.scrollTop;   // ← must exist
          const y2 = dstRect.top + dstRect.height / 2 - containerRect.top + rightPane.scrollTop + 1;
          
          /* ---- pick anchors based on linkType ---- */
          const srcLeft  = srcRect.left  - containerRect.left + rightPane.scrollLeft;
          const srcRight = srcRect.right - containerRect.left + rightPane.scrollLeft;
          const dstLeft  = dstRect.left  - containerRect.left + rightPane.scrollLeft;
          const dstRight = dstRect.right - containerRect.left + rightPane.scrollLeft;

          let x1: number, x2: number;
          switch (linkType) {
            case "SS": x1 = srcLeft;  x2 = dstLeft;  break;   // Start→Start
            case "FF": x1 = srcRight; x2 = dstRight; break;   // Finish→Finish
            case "SF": x1 = srcLeft;  x2 = dstRight; break;   // Start→Finish
            default:   x1 = srcRight; x2 = dstLeft;  break;   // Finish→Start (FS)
          }

          /* --- smarter orthogonal path: find free vertical corridor that avoids bars --- */
          const run     = 24;      // 24‑px horizontal exits/entries
          const r       = 12;   // corner radius (px)
          const dirY    = y2 > y1 ? 1 : -1;

          /**
           * Scan all bars to find the first x position between minX and maxX
           * where a vertical line from yTop→yBot does NOT intersect any bar.
           */
          const findFreeX = (minX: number, maxX: number, yTop: number, yBot: number): number => {
            const step = 4;           // 4‑px increments when searching
            for (let x = maxX; x >= minX; x -= step) {
              // test this x against all bars
              let clear = true;
              for (const b of Object.values(barsById)) {
                const br = b.el.getBoundingClientRect();
                const bx1 = br.left  - containerRect.left + rightPane.scrollLeft;
                const bx2 = bx1 + br.width;
                const by1 = br.top   - containerRect.top  + rightPane.scrollTop;
                const by2 = by1 + br.height;
                // vertical overlap?
                if (by2 >= yTop && by1 <= yBot && x >= bx1 && x <= bx2) {
                  clear = false;
                  break;
                }
              }
              if (clear) return x;
            }
            // fallback
            return minX;
          };

          // Only skip strictly backward-pointing arrows
          if (x2 + 2 < x1) return;
          
          let d: string;
          const padH  = 10;                       // 10-px horizontal offset
          const midY  = (y1 + y2) / 2;            // divider halfway between rows

          if (x2 >= x1) {
            /* ➡️ successor sits to the right */

            /* Exit: SS & SF hop left, FS & FF hop right */
            const leftHop  = (linkType === "SS" || linkType === "SF")
              ? x1 - padH   //  ←  exit to left of bar
              : x1 + padH;  //  →  exit to right of bar

            /* Approach: FF & SF come in from the right,
                          SS & FS approach from the left */
            const rightHop = (linkType === "FF" || linkType === "SF")
              ? x2 + padH   // run past the bar then back‑track
              : x2 - padH;  // stop just before the bar

            d = [
              `M ${x1} ${y1}`,  // 1. start at chosen anchor on predecessor
              `H ${leftHop}`,   // 2. initial horizontal hop (← or →)
              `V ${midY}`,      // 3. down / up to divider
              `H ${rightHop}`,  // 4. long horizontal run towards successor
              `V ${y2}`,        // 5. down / up to successor mid‑line
              `H ${x2}`         // 6. final hop into the bar (→ or ←)
            ].join(" ");
          } else {
            /* ⬅️ successor sits to the left */
            d = [
              `M ${x1} ${y1}`,
              `H ${x1 + padH}`,
              `V ${midY}`,
              `H ${x2 + padH}`,              // run past successor
              `V ${y2}`,
              `H ${x2}`
            ].join(" ");
          }

          const path = document.createElementNS(svgNS, "path");
          path.classList.add("pm-dep-arrow");
          path.setAttribute("d", d);
          path.setAttribute("marker-end", `url(#${markerId})`);

          (path as any).dataset.src = srcId;
          (path as any).dataset.dst = key(task);
          
          /* ── hover‑highlight for arrows ─────────────────────────── */
          path.style.pointerEvents = "visibleStroke";          // enable hover on stroke
          path.addEventListener("mouseenter", () => {
            path.classList.add("pm-arrow-hover");
            path.setAttribute("marker-end", `url(#${hoverMarkerId})`);
            // Force red fill on hover marker
            const hoverMarker = arrowLayer.querySelector(`#${hoverMarkerId}`);
            if (hoverMarker) {
              const hoverPath = hoverMarker.querySelector('path');
              if (hoverPath) {
                hoverPath.setAttribute("fill", "#d00");
                hoverPath.setAttribute("stroke", "#d00");
                // Also set on the marker element
                (hoverMarker as SVGMarkerElement).setAttribute("fill", "#d00");
                (hoverMarker as SVGMarkerElement).setAttribute("fill-opacity", "1");
              }
            }
          });
          path.addEventListener("mouseleave", () => {
            path.classList.remove("pm-arrow-hover");
            path.setAttribute("marker-end", `url(#${markerId})`);
          });

          arrowLayer.appendChild(path);

        });
      });
    };

    if (arrowsEnabled) {
      /* Wait two frames so bar geometry is guaranteed final before drawing arrows */
      requestAnimationFrame(() => requestAnimationFrame(drawArrows));

      /* Re‑draw arrows whenever the timeline pane scrolls vertically or horizontally */
      outer.addEventListener("scroll", () => {
        requestAnimationFrame(drawArrows);
      });
    }

    /* ---------- heat‑map strip + header fallback background ---------- */
    if (heatmapEnabled) {
      this.renderHeatmap(heat, pxPerDay, horizon);
      // show the strip
      if (this.heatLayerEl) {
        (this.heatLayerEl as HTMLElement).style.display = "block";
      }
      // keep header transparent so the strip shows through
      headerWrap.style.background = "transparent";
    } else {
      // hide and clear strip if it exists
      if (this.heatLayerEl) {
        const hl = this.heatLayerEl as HTMLElement;
        hl.style.display = "none";
        hl.innerHTML = "";
      }
      // apply solid fallback background to header rows
      headerWrap.style.background =
        "var(--background-primary, var(--background-secondary, #fff))";
    }
    /* DEBUG: expose bar coords so DevTools can inspect */
    (window as any).pmBars = barsById;

    if (this.cache.projects.size === 0) {
      leftPane.createEl("p", {
        text: `No projects found (front‑matter \`${this.plugin.settings.projectFlagProperty}: true\`).`,
      });
    }

    // --- fallback: normalise IDs to lower-case in table-row scan (if present) ---
    // (See: search for explicitIdMatch in instructions)
    // Not present in main render loop, but if you use it elsewhere:
    // Example replacement for:
    // const explicitIdMatch = line.match(/\^([A-Za-z0-9_-]+)\s*$/);
    // const id = explicitIdMatch ? explicitIdMatch[1] : `${file.path}-row-${idx}`;
    //
    // let id: string;
    // const caretMatch = line.match(/\^([A-Za-z0-9_-]+)\s*$/);
    // if (caretMatch) {
    //   id = caretMatch[1]; // use caret ID if present (^s-1)
    // } else {
    //   // else take first column cell, e.g., "S-1" or "SB-3"
    //   const idCell = line.match(/^\s*\|\s*([A-Za-z0-9_-]+)\s*\|/);
    //   id = idCell ? idCell[1] : `${file.path}-row-${idx}`;
    // }
    // id = id.toLowerCase(); // normalise for dependable matching
    /* Final scroll restore (after DOM fully built) */
    requestAnimationFrame(() => {
      const rightEl = this.containerEl.querySelector<HTMLElement>(".pm-tl-right");
      const v = this.pendingScroll ? this.pendingScroll.v : restoreScroll.v;
      const h = this.pendingScroll ? this.pendingScroll.h : restoreScroll.h;

      if (rightEl) rightEl.scrollTop  = v;   // restore vertical scroll
      if (rightEl) rightEl.scrollLeft = h;   // restore horizontal scroll

      /* Defer clearing so any additional queued renders reuse the same offsets */
      requestAnimationFrame(() => (this.pendingScroll = null));
    });
  }

  /**
   * Draw a 4‑px‑tall heat‑map strip under the header. Opacity scales with
   * the number of overlapping bars recorded in `heat` for each day.
   * @param heat       day‑offset (int) → count
   * @param pxPerDay   horizontal pixels per day
   * @param horizon    number of days to cover (inclusive)
   */
  private renderHeatmap(
    heat: Record<number, number>,
    pxPerDay: number,
    horizon: number
  ) {
    // Create or reuse the heat layer element
    if (!this.heatLayerEl) {
      // Insert just under the header in the right pane
      const rightPane = this.containerEl.querySelector(".pm-tl-right");
      if (!rightPane) return;
      this.heatLayerEl = rightPane.querySelector(".pm-heat-layer") as HTMLElement;
      if (!this.heatLayerEl) {
        // Anchor INSIDE the sticky header wrapper so it scrolls with it
        const headerWrap = this.containerEl.querySelector(".pm-tl-headwrap") as HTMLElement | null;
        if (!headerWrap) return;

        this.heatLayerEl = headerWrap.querySelector(".pm-heat-layer") as HTMLElement | null;
        if (!this.heatLayerEl) {
          this.heatLayerEl = document.createElement("div");
          this.heatLayerEl.className = "pm-heat-layer";
          headerWrap.appendChild(this.heatLayerEl);
        }
      }
    }
    // Clear old
    this.heatLayerEl.innerHTML = "";

    // Render a cell for every day from 0 to horizon (inclusive)
    for (let offset = 0; offset <= horizon; offset++) {
      const count = heat[offset] ?? 0;
      const cell  = this.heatLayerEl.createEl("div", { cls: "pm-heat-cell" });
      cell.style.left  = `${offset * pxPerDay}px`;
      cell.style.width = `${pxPerDay}px`;

      /* --- continuous yellow→red scale using settings.heatMin / heatMax ----
         ≤ heatMin : very pale yellow  (h 55°, L 90 %)
         ≥ heatMax : pure red          (h  0°, L 40 %)                       */
      const { heatMin = 5, heatMax = 25 } = this.plugin.settings;
      const span     = Math.max(1, heatMax - heatMin);   // avoid divide‑by‑zero
      const fracRaw  = (count - heatMin) / span;         // could be <0 or >1
      const frac     = Math.max(0, Math.min(1, fracRaw)); // clamp 0‑1
      const hue      = 55 - 55 * frac;                   // 55° → 0°
      const light    = 90 - 50 * frac;                   // 90 % → 40 %
      cell.style.background = `hsl(${hue}deg 95% ${light}%)`;
      cell.style.opacity    = "1";

      // Enhanced hover tooltip with proper positioning
      let tip: HTMLElement | null = null;
      
      const showTip = () => {
        if (tip) return;
        
        // Calculate the date for this offset
        const date = (moment as any)().add(offset, 'days');
        const dateStr = date.format('dddd, MMMM Do YYYY');
        
        tip = document.createElement("div");
        tip.className = "pm-dash-tooltip";
        tip.innerHTML = `<strong>${dateStr}</strong><br>${count} task${count === 1 ? "" : "s"}`;
        document.body.appendChild(tip);

        const r = cell.getBoundingClientRect();
        const pad = 8;
        const w = tip.offsetWidth;
        let x = r.left + (r.width / 2) - (w / 2); // Center horizontally
        if (x < pad) x = pad;
        if (x + w > window.innerWidth - pad) {
          x = Math.max(window.innerWidth - w - pad, pad);
        }
        
        const h = tip.offsetHeight;
        let y = r.top - h - pad; // Position above the cell
        if (y < pad) {
          y = r.bottom + pad; // Position below if not enough space above
        }
        
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
      };

      const hideTip = () => { tip?.remove(); tip = null; };

      cell.addEventListener("mouseenter", showTip);
      cell.addEventListener("mouseleave", hideTip);
    }
  }

  /** Queue a scroll‑preserving re‑render. Multiple calls within
   *  the same animation frame coalesce into a single render. */
  public saveAndRender() {
    if (!this.pendingScroll) {
      const right = this.containerEl.querySelector<HTMLElement>(".pm-tl-right");
      this.pendingScroll = {
        v: right?.scrollTop  ?? 0,
        h: right?.scrollLeft ?? 0,
      };
    }

    if (this.renderQueued) return;   // already scheduled this frame
    this.renderQueued = true;

    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }
}
