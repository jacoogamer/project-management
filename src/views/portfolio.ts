import {
  App,
  ItemView,
  WorkspaceLeaf,
  setIcon,
  Modal,
  TFile,
  normalizePath,
  Notice,
  parseYaml,
  stringifyYaml,
  TFolder,
  FuzzySuggestModal,
} from "obsidian";
import { ProjectCache } from "../services/cache";
import { newProject } from "../newProject";
import { PmSettings } from "../../settings";
import { VIEW_TYPE_PM_PROGRESS } from "./progress";
import { VIEW_TYPE_PM_TIMELINE } from "./timeline";
import { VIEW_TYPE_PM_TASKWEEKS } from "./task_weeks";
import { VIEW_TYPE_PM_RESOURCES } from "./resources";
import { VIEW_TYPE_PM_DASHBOARD } from "./dashboard";
import { VIEW_TYPE_PM_TODAY } from "./today";

// Load portfolio-specific styles
import "../../styles/styles-portfolio.css";

export const VIEW_TYPE_PM_PORTFOLIO = "pm-portfolio-view";

/* ───────────────────────── Types & constants ───────────────────────── */

// --- Simple input modal for user prompts ---
class PromptModal extends Modal {
  private resolveFn: ((value: string | null) => void) | null = null;
  constructor(app: any, private title: string, private initial: string = "") {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });
    const input = contentEl.createEl("input", {
      type: "text",
      value: this.initial,
    });
    input.focus();
    const btnBar = contentEl.createDiv({ cls: "modal-button-container" });
    const ok = btnBar.createEl("button", { text: "OK" });
    const cancel = btnBar.createEl("button", { text: "Cancel" });

    ok.onclick = () => {
      this.close();
      this.resolveFn?.(input.value.trim() || null);
    };
    cancel.onclick = () => {
      this.close();
      this.resolveFn?.(null);
    };
  }
  public async prompt(): Promise<string | null> {
    return new Promise<string | null>((res) => {
      this.resolveFn = res;
      this.open();
    });
  }
}

/** Folder chooser that calls its callback exactly once */
class FolderSelectModal extends FuzzySuggestModal<TFolder> {
  private picked = false;
  constructor(app: App, private onPick: (folder: TFolder | null) => void) {
    super(app);
    this.setPlaceholder("Select folder for new project…");
  }
  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter(
      (f) => f instanceof TFolder
    ) as TFolder[];
  }
  getItemText(item: TFolder) { return item.path; }

  onChooseItem(item: TFolder) {
    this.picked = true;
    this.onPick(item);   // fire once with the chosen folder
  }

  onClose() {
    // Fire with null only if user closed without selecting
    if (!this.picked) this.onPick(null);
  }
}
interface PortfolioFile {
  id: string;
  name: string;
  projectPaths: string[];
  /** One‑paragraph summary shown in the UI */
  description?: string;
  owner?: string;
  created: number;
  modified: number;
  /** Saved height of the description textarea (px) */
  descHeight?: number;
}


// Store portfolio YAML files in the new sync-friendly folder
const PORT_DIR = "Portfolios";

const OLD_PORT_DIR = ".obsidian/plugins/project-management/pm";

async function migrateOldPortfolios(app: App) {
  try {
    const oldPath = normalizePath(OLD_PORT_DIR);
    const newPath = normalizePath(PORT_DIR);

    // Ensure new folder exists
    try { await app.vault.adapter.mkdir(newPath); } catch (_) {}

    const listing = await app.vault.adapter.list(oldPath);
    for (const file of listing.files) {
      if (file.endsWith(".yml") || file.endsWith(".yaml")) {
        const baseName = file.substring(file.lastIndexOf("/") + 1);
        const targetPath = `${newPath}/${baseName}`;
        // Copy file contents to new location
        const data = await app.vault.adapter.read(file);
        await app.vault.adapter.write(targetPath, data);
        // Optionally delete old file
        try { await app.vault.adapter.remove(file); } catch (_) {}
      }
    }
  } catch (err) {

  }
}

const SB_WIDTH_KEY = "pm-portfolio-sidebar-width";
const SB_COLLAPSE_KEY = "pm-portfolio-sidebar-collapsed";

/* ───────────────────────── View class ──────────────────────────────── */
export class PortfolioView extends ItemView {
  public icon = "layers";

  /* Data */
  private portfolios: PortfolioFile[] = [];
  private selectedId: string | null = null;
  private descBox?: HTMLTextAreaElement;   // ref to description textarea
  /** Active sidebar tooltip so we can close it on render/change */
  private descTip: HTMLElement | null = null;

  /** Sorting key and direction (1 = asc, -1 = desc) */
  private sortKey: "name" | "area" | "priority" = "name";
  private sortDir: 1 | -1 = 1;

  constructor(
    leaf: WorkspaceLeaf,
    private cache: ProjectCache,
    private settings: PmSettings
  ) {
    super(leaf);
  }

  /* -------------------------------------------------- identity ------- */
  getViewType(): string {
    return VIEW_TYPE_PM_PORTFOLIO;
  }
  getDisplayText(): string {
    return "Project Management";
  }

  /* -------------------------------------------------- lifecycle ------ */
  async onOpen() {
    await migrateOldPortfolios(this.app);
    await this.ensureFolder();
    await this.loadPortfolios();
    if (this.portfolios[0]) this.selectedId = this.portfolios[0].id;

    /* If vault indexing isn't finished, refresh once "resolved" fires */
    if ((this.app.metadataCache as any).resolved === false) {
      const ref = this.app.metadataCache.on("resolved", async () => {
        await this.loadPortfolios();
        this.render();                 // projects are ready now
      });
      // Register the event so it is automatically cleaned up with the view
      this.registerEvent(ref);
    }

    this.render();
  }
  async onClose() {
    if (!this.descBox) return;
    const sel = this.portfolios.find((pf) => pf.id === this.selectedId);
    if (sel) {
      const h = this.descBox.clientHeight;
      if (h && h !== sel.descHeight) {
        sel.descHeight = h;
        await this.savePortfolio(sel);   // persist on pane close
      }
    }
  }

  /* -------------------------------------------------- FS helpers ----- */
  private async ensureFolder() {
    const path = normalizePath(PORT_DIR);
    try {
      await this.app.vault.adapter.mkdir(path);
    } catch (_) {
      /* folder already exists or cannot create */
    }
  }

  private async loadPortfolios() {
    /* use adapter.list to catch .yml in plugin folder */
    const dirPath = normalizePath(PORT_DIR);
    let files: string[] = [];
    try {
      const listing = await this.app.vault.adapter.list(dirPath);
      files = listing.files.filter(
        (p) => p.endsWith(".yml") || p.endsWith(".yaml")
      );
    } catch (err) {

    }

    /* Fallback: if adapter.list found nothing, try vault.getFiles() */
    if (files.length === 0) {
      files = this.app.vault
        .getFiles()
        .filter(
          (f) =>
            f.path.startsWith(`${PORT_DIR}/`) &&
            (f.extension.toLowerCase() === "yml" ||
              f.extension.toLowerCase() === "yaml")
        )
        .map((f) => f.path);
    }

    const out: PortfolioFile[] = [];
    for (const pth of files) {
      try {
        const raw = await this.app.vault.adapter.read(pth);
        const data = parseYaml(raw) as any;
        const base =
          pth.substring(pth.lastIndexOf("/") + 1, pth.lastIndexOf("."));
        
        // Clean up invalid project paths and try to find renamed files
        let projectPaths = Array.isArray(data.projectPaths) ? data.projectPaths : [];
        const validPaths: string[] = [];
        const invalidPaths: string[] = [];
        
        for (const path of projectPaths) {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file && file instanceof TFile) {
            validPaths.push(path);
          } else {
            // Try to find the file by name (it might have been renamed)
            const fileName = path.substring(path.lastIndexOf("/") + 1);
            const foundFile = this.findFileByName(fileName);
            if (foundFile) {
              // Verify that the found file is actually a project file
              const isProject = await this.isProjectFile(foundFile);
              if (isProject) {
                validPaths.push(foundFile.path);
              } else {
                invalidPaths.push(path);
              }
            } else {
              // Also check if the file exists but with a different path structure
              const allFiles = this.app.vault.getFiles();
              const matchingFile = allFiles.find(f => f.name === fileName);
              if (matchingFile) {
                // Verify that the found file is actually a project file
                const isProject = await this.isProjectFile(matchingFile);
                if (isProject) {
                  validPaths.push(matchingFile.path);
                } else {
                  invalidPaths.push(path);
                }
              } else {
                invalidPaths.push(path);
              }
            }
          }
        }
        
        // If we found invalid paths, update the portfolio
        if (invalidPaths.length > 0) {
          const updatedData = {
            ...data,
            projectPaths: validPaths,
            modified: Date.now()
          };
          const updatedYaml = stringifyYaml(updatedData);
          await this.app.vault.adapter.write(pth, updatedYaml);
        }
        
        out.push({
          id: data.id ?? base,
          name: data.name ?? base,
          projectPaths: validPaths,
          description: data.description ?? "",
          owner: data.owner,
          created: data.created ?? Date.now(),
          modified: data.modified ?? Date.now(),
          descHeight: typeof data.descHeight === "number" ? data.descHeight : undefined,
        });
      } catch (e) {

      }
    }
    this.portfolios = out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Try to find a file by its name (for handling renamed files) */
  private findFileByName(fileName: string): TFile | null {
    const files = this.app.vault.getFiles();
    // First try exact name match
    let foundFile = files.find(file => file.name === fileName);
    
    if (foundFile) {
      return foundFile;
    }
    
    // If no exact match, try to find files that might be the same project
    // Look for files with similar names (ignoring case and common variations)
    const normalizedFileName = fileName.toLowerCase().replace(/\.md$/, '');
    
    for (const file of files) {
      const normalizedFile = file.name.toLowerCase().replace(/\.md$/, '');
      
      // Check if this might be the same file (exact match without extension)
      if (normalizedFile === normalizedFileName) {
        return file;
      }
      
      // Check if it's a close match (e.g., "project-name" vs "project_name")
      const fileVariations = [
        normalizedFile,
        normalizedFile.replace(/[-_]/g, ''),
        normalizedFile.replace(/[-_]/g, '-'),
        normalizedFile.replace(/[-_]/g, '_')
      ];
      
      if (fileVariations.includes(normalizedFileName)) {
        return file;
      }
    }
    
    return null;
  }

  /** Check if a file is a project file by looking at its front matter */
  private async isProjectFile(file: TFile): Promise<boolean> {
    try {
      const content = await this.app.vault.read(file);
      const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      if (!frontMatterMatch) return false;
      
      const frontMatter = frontMatterMatch[1];
      const projectFlag = this.settings.projectFlagProperty;
      
      // Check if the project flag is set to true
      const flagRegex = new RegExp(`^${projectFlag}\\s*:\\s*true\\s*$`, 'm');
      return flagRegex.test(frontMatter);
    } catch (error) {
      return false;
    }
  }

  /** Persist the YAML back to the portfolio storage folder */
  private async savePortfolio(p: PortfolioFile) {
    p.modified = Date.now();
    const yaml = stringifyYaml({
      id:            p.id,
      name:          p.name,
      description:   p.description ?? "",
      owner:         p.owner ?? "",
      projectPaths:  p.projectPaths,
      created:       p.created,
      modified:      p.modified,
      descHeight:    p.descHeight ?? undefined,
    });
    const filePath = `${PORT_DIR}/${p.id}.yml`;
    const existing = this.app.vault.getAbstractFileByPath(filePath);

    if (existing instanceof TFile) {
      /* Portfolio already indexed by Obsidian — use modify */
      await this.app.vault.modify(existing, yaml);
    } else {
      /* File not in vault index (common in .obsidian folder) — write via adapter */
      await this.app.vault.adapter.write(filePath, yaml);
    }
    await this.loadPortfolios();
  }

  /** Delete a portfolio YAML and refresh list */
  private async deletePortfolio(id: string) {
    const filePath = `${PORT_DIR}/${id}.yml`;
    const file = this.app.vault.getAbstractFileByPath(filePath);

    if (file && file instanceof TFile) {
      // File is indexed by the vault – safe to delete via vault API
      await this.app.vault.delete(file);
    } else {
      // Not indexed (common for .obsidian folder) – remove via adapter
      try {
        await this.app.vault.adapter.remove(filePath);
      } catch (err) {

      }
    }

    await this.loadPortfolios();
    if (this.selectedId === id) this.selectedId = this.portfolios[0]?.id ?? null;
  }

  /* -------------------------------------------------- helpers -------- */
  /** Open Progress view showing only projects in the selected portfolio */
  private async openProgress() {
    // Get project paths for current portfolio
    const sel    = this.portfolios.find((pf) => pf.id === this.selectedId);
    const filter = sel?.projectPaths ?? [];

    // Reuse an existing Progress leaf; otherwise open in bottom pane
    let leaf: WorkspaceLeaf | undefined;
    if (this.settings.reuseProgressPane) {
      leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_PROGRESS)[0];
    }
    if (!leaf) leaf = this.app.workspace.splitActiveLeaf("horizontal");

    // Push the filter into the viewState (works for fresh & existing)
    await leaf.setViewState({
      type:   VIEW_TYPE_PM_PROGRESS,
      active: true,
      state:  {
        filterProjects: filter,
        filterName:     sel?.name ?? "",
      },
    });

    // If the view instance already exists, call its runtime updater
    const view: any = leaf.view;
    if (view?.updateFilter) view.updateFilter(filter, sel?.name ?? "");

    this.app.workspace.revealLeaf(leaf);
  }

  /** Open Dashboard showing only projects in the selected portfolio */
  private async openDashboard() {
    // Get project paths for current portfolio
    const sel    = this.portfolios.find((pf) => pf.id === this.selectedId);
    const filter = sel?.projectPaths ?? [];

    // Reuse an existing Dashboard leaf; otherwise create new leaf
    let leaf: WorkspaceLeaf | undefined;
    if (this.settings.reuseProgressPane) {
      leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_DASHBOARD)[0];
    }
    if (!leaf) leaf = this.app.workspace.getLeaf();

    // Push the filter into the viewState (works for fresh & existing)
    if (leaf) {
      await leaf.setViewState({
        type:   VIEW_TYPE_PM_DASHBOARD,
        active: true,
        state:  {
          filterProjects: filter,
          filterName:     sel?.name ?? "",
        },
      });

      // If the view instance already exists, call its runtime updater
      const view: any = leaf.view;
      if (view?.updateFilter) view.updateFilter(filter, sel?.name ?? "");

      this.app.workspace.revealLeaf(leaf);
    }
  }

  /** Open Today view showing task recommendations */
  private async openToday() {
    // Reuse an existing Today leaf; otherwise create new leaf
    let leaf: WorkspaceLeaf | undefined;
    if (this.settings.reuseProgressPane) {
      leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TODAY)[0];
    }
    if (!leaf) leaf = this.app.workspace.getLeaf();

    if (leaf) {
      await leaf.setViewState({
        type:   VIEW_TYPE_PM_TODAY,
        active: true,
      });

      this.app.workspace.revealLeaf(leaf);
    }
  }

  /** Open Timeline showing only projects in the selected portfolio */
  private async openTimeline() {
    // Collect project paths for the active portfolio
    const sel    = this.portfolios.find((pf) => pf.id === this.selectedId);
    const filter = sel?.projectPaths ?? [];

    /* Re‑use an existing Timeline pane if one is open */
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE)[0];
    if (!leaf) {
      leaf = this.app.workspace.splitActiveLeaf("horizontal");
    }

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_TIMELINE,
      active: true,
      state:  {
        filterProjects: filter,
        filterName:     sel?.name ?? "",
      },
    });

    // If the view instance already exists, call its runtime updater
    const view: any = leaf.view;
    if (view?.updateFilter) view.updateFilter(filter, sel?.name ?? "");

    this.app.workspace.revealLeaf(leaf);
  }

  private toggleSort(key: "name" | "area" | "priority") {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 1 ? -1 : 1;
    } else {
      this.sortKey = key;
      this.sortDir = 1;
    }
    this.render();
  }

  /* -------------------------------------------------- render --------- */
  private render() {
    const el = this.contentEl;
    /* Close lingering sidebar tooltip, if any */
    if (this.descTip) {
      this.descTip.remove();
      this.descTip = null;
    }
    el.empty();

    /** Shared hover‑tooltip helper (reuses the .pm-port-tooltip styling) */
    function attachTip(target: HTMLElement, text: string) {
      let tip: HTMLElement | null = null;

      target.addEventListener("mouseenter", (ev: MouseEvent) => {
        tip = document.createElement("div");
        tip.classList.add("pm-port-tooltip");
        tip.textContent = text;
        document.body.appendChild(tip);

        /* Position beside the cursor, clamped to viewport */
        const pad = 8;
        const w   = tip.offsetWidth  || 120;
        const h   = tip.offsetHeight || 40;

        let left = ev.clientX + 12;
        let top  = ev.clientY + 12;

        if (left + w > window.innerWidth - pad) {
          left = Math.max(ev.clientX - w - 12, pad);
        }
        if (top + h > window.innerHeight - pad) {
          top = Math.max(window.innerHeight - h - pad, pad);
        }

        tip.style.left = `${left}px`;
        tip.style.top  = `${top}px`;
      });

      const remove = () => { tip?.remove(); tip = null; };
      target.addEventListener("mouseleave", remove);
      target.addEventListener("mousedown", remove);  // hide when clicked
    }

    const wrap = el.createDiv({ cls: "pm-port-wrap" });
    const sidebar = wrap.createDiv({ cls: "pm-port-sidebar" });
    /* Apply stored width or collapsed state using CSS custom properties */
    const savedW = Number(localStorage.getItem(SB_WIDTH_KEY));
    const isCollapsed = localStorage.getItem(SB_COLLAPSE_KEY) === "1";
    if (isCollapsed) {
      sidebar.style.setProperty("--sidebar-width", "0px");
      sidebar.style.display = "none";
    } else if (!isNaN(savedW) && savedW >= 120 && savedW <= 400) {
      sidebar.style.setProperty("--sidebar-width", `${savedW}px`);
    } else {
      sidebar.style.setProperty("--sidebar-width", "180px");
    }

    /* Draggable splitter + chevron toggle that stays visible */
    const split = wrap.createDiv({ cls: "pm-port-split" });
    const toggleBtn = split.createSpan();
    setIcon(toggleBtn, isCollapsed ? "chevron-right" : "chevron-left");
    toggleBtn.style.cursor = "pointer";
    toggleBtn.style.display = "block";
    toggleBtn.style.margin = "4px auto";
    toggleBtn.style.fontSize = "14px";
    toggleBtn.onmousedown = (e) => { e.stopPropagation(); e.preventDefault(); };
    toggleBtn.onclick = () => {
      const goingCollapsed = !(localStorage.getItem(SB_COLLAPSE_KEY) === "1");
      if (goingCollapsed) {
        const w = sidebar.getBoundingClientRect().width;
        if (w >= 120 && w <= 400) localStorage.setItem(SB_WIDTH_KEY, String(w));
        localStorage.setItem(SB_COLLAPSE_KEY, "1");
        sidebar.style.display = "none";
        sidebar.style.setProperty("--sidebar-width", "0px");
      } else {
        localStorage.setItem(SB_COLLAPSE_KEY, "0");
        const savedW = Number(localStorage.getItem(SB_WIDTH_KEY));
        if (!isNaN(savedW) && savedW >= 120 && savedW <= 400) {
          sidebar.style.setProperty("--sidebar-width", `${savedW}px`);
        } else {
          sidebar.style.setProperty("--sidebar-width", "180px");
        }
        sidebar.style.display = ""; // revert to default block
      }
      this.render();
    };

    const panel = wrap.createDiv({ cls: "pm-port-panel" });

    /* ── Splitter drag logic ────────────────────────────────────────────── */
    (() => {
      let startX = 0;
      let startW = 180;
      let isDragging = false;

      const onMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const newW = Math.max(0, Math.min(400, startW + dx));
        sidebar.style.setProperty("--sidebar-width", `${newW}px`);
        setIcon(toggleBtn, newW <= 20 ? "chevron-right" : "chevron-left");
      };

      const stop = () => {
        if (!isDragging) return;
        isDragging = false;
        
        const w = sidebar.getBoundingClientRect().width;
        const nowCollapsed = w <= 20;
        
        if (!nowCollapsed) {
          localStorage.setItem(SB_WIDTH_KEY, `${w}`);
          localStorage.setItem(SB_COLLAPSE_KEY, "0");
        } else {
          localStorage.setItem(SB_COLLAPSE_KEY, "1");
          sidebar.style.display = "none";
          sidebar.style.setProperty("--sidebar-width", "0px");
        }

        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", stop);
      };

      split.addEventListener("mousedown", (e) => {
        if ((e.target as HTMLElement)?.closest("span") === toggleBtn) return;
        
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startW = sidebar.getBoundingClientRect().width;
        // If currently collapsed/hidden, make it visible before dragging
        if (getComputedStyle(sidebar).display === "none") {
          sidebar.style.display = ""; // default block
          // start from previous saved width or minimal width
          const savedW = Number(localStorage.getItem(SB_WIDTH_KEY));
          const initial = !isNaN(savedW) && savedW >= 120 && savedW <= 400 ? savedW : 180;
          sidebar.style.setProperty("--sidebar-width", `${initial}px`);
          localStorage.setItem(SB_COLLAPSE_KEY, "0");
          setIcon(toggleBtn, "chevron-left");
        }
        
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", stop);
      });
    })();

    /* ---- sidebar header ---- */
    const listHeader = sidebar.createDiv({ cls: "pm-port-sb-head" });
    
    // Left side: briefcase icon and text
    const leftSide = listHeader.createEl("div");
    leftSide.style.display = "flex";
    leftSide.style.alignItems = "center";
    
    // Add briefcase icon before the text
    const briefcaseIcon = leftSide.createEl("span");
    setIcon(briefcaseIcon, "briefcase");
    briefcaseIcon.style.marginRight = "8px";
    
    leftSide.createEl("span", { text: "Portfolios" });
    
    // Right side: plus button
    const addBtn = listHeader.createEl("span");
    addBtn.style.marginLeft = "auto";
    setIcon(addBtn, "plus");
    addBtn.style.cursor = "pointer";
    attachTip(addBtn, "Add new portfolio");
    addBtn.onclick = async () => {
      const name = await new PromptModal(this.app, "New portfolio name").prompt();
      if (!name) return;

      const id = `pf-${Date.now()}`;
      const pf: PortfolioFile = {
        id,
        name,
        projectPaths: [],
        created: Date.now(),
        modified: Date.now(),
      };
      await this.savePortfolio(pf);
      this.selectedId = id;
      this.render();
    };

    /* ---- sidebar list ---- */
    const ul = sidebar.createEl("ul", { cls: "pm-port-ul" });
    for (const p of this.portfolios) {
      const li = ul.createEl("li", { cls: p.id === this.selectedId ? "active" : "" });

      /* Bullet column – shows “•” only for the active portfolio */
      li.createSpan({
        text: p.id === this.selectedId ? "•" : "",
        cls:  "pm-port-bullet",
      });

      /* Portfolio name */
      const nameSpan = li.createSpan({ text: p.name, cls: "pm-port-name" });
      nameSpan.onclick = () => {
        /* Close any active tooltip */
        this.descTip?.remove();
        this.descTip = null;
        this.selectedId = p.id;
        this.render();
      };
      /* Hover tooltip with portfolio description */
      if (p.description && p.description.trim() !== "") {
        const showTip = (ev: MouseEvent) => {
          /* Kill any previous tooltip */
          this.descTip?.remove();

          this.descTip = document.createElement("div");
          this.descTip.classList.add("pm-port-tooltip");
          this.descTip.textContent = p.description!;
          document.body.appendChild(this.descTip);

          /* Hide when the cursor leaves the tooltip itself */
          this.descTip.addEventListener("mouseleave", () => {
            this.descTip?.remove();
            this.descTip = null;
          });

          /* Position beside the cursor, clamped to viewport */
          const pad = 8;
          const w   = this.descTip.offsetWidth  || 200;
          const h   = this.descTip.offsetHeight || 80;

          let left = ev.clientX + 12;
          let top  = ev.clientY + 12;

          if (left + w > window.innerWidth - pad) {
            left = Math.max(ev.clientX - w - 12, pad);
          }
          if (top + h > window.innerHeight - pad) {
            top = Math.max(window.innerHeight - h - pad, pad);
          }

          this.descTip.style.left = `${left}px`;
          this.descTip.style.top  = `${top}px`;
        };

        const hideTip = () => { this.descTip?.remove(); this.descTip = null; };

        nameSpan.addEventListener("mouseenter", showTip);
        nameSpan.addEventListener("mouseleave", hideTip);
      }

      /* rename */
      const ren = li.createSpan({ cls: "pm-port-ico" });
      setIcon(ren, "pencil");
      attachTip(ren, "Rename this portfolio");
      ren.onclick = async (e) => {
        e.stopPropagation();
        const newName = await new PromptModal(this.app, "Rename portfolio", p.name).prompt();
        if (newName) {
          p.name = newName;
          await this.savePortfolio(p);
          this.render();
        }
      };

      /* delete */
      const del = li.createSpan({ cls: "pm-port-ico" });
      setIcon(del, "trash");
      attachTip(del, "Delete this portfolio");
      del.onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete portfolio “${p.name}”?\nThis cannot be undone.`)) {
          await this.deletePortfolio(p.id);
          this.render();
        }
      };
    }

    /* ── Create Project button under list ──────────────────── */
    const createWrap = sidebar.createDiv({ cls: "pm-create-proj" });
    const createBtn  = createWrap.createEl("button", { text: "Create Project" });
    attachTip(createBtn, "Create a new project in the selected folder");

    createBtn.onclick = () => {
      new FolderSelectModal(this.app, async (folder) => {
        if (!folder) return;                       // user cancelled

        // 1) create the new project note
        await (newProject as any)(this.app, folder);

        // 2) give Obsidian a moment to index the note, then refresh
        setTimeout(async () => {
          await this.loadPortfolios();   // reload portfolio YAMLs
          this.render();                 // re‑render sidebar + table
        }, 250);
      }).open();
    };

    /* ---- main panel ---- */
    const selected = this.portfolios.find((pf) => pf.id === this.selectedId);
    if (!selected) {
      panel.createEl("p", { text: "No portfolio selected. Create at least one portfolio to see any projects." });
      return;
    }

    const titleRow = panel.createDiv({ cls: "pm-port-title", text: selected.name });
    /* Column header row: Project | Category | Priority */
    /*const colHead = panel.createDiv({ cls: "pm-port-col-head" });
    ["Project", "Category", "Priority"].forEach((txt) =>
      colHead.createEl("span", { text: txt })
    );*/
    const openBtns = titleRow.createDiv({ cls: "pm-port-open" });

    /* Today */
    const todayBtn = openBtns.createEl("button");
    const icoToday = todayBtn.createSpan();
    setIcon(icoToday, "calendar");
    icoToday.style.marginRight = "4px";
    todayBtn.createSpan({ text: "Today" });
    attachTip(todayBtn, "Open today's task recommendations");
    todayBtn.onclick = () => this.openToday();

    /* Dashboard */
    const dashboardBtn = openBtns.createEl("button");
    const icoDashboard = dashboardBtn.createSpan();
    setIcon(icoDashboard, "pie-chart");
    icoDashboard.style.marginRight = "4px";
    dashboardBtn.createSpan({ text: "Dashboard" });
    attachTip(dashboardBtn, "Open analytics dashboard for this portfolio");
    dashboardBtn.onclick = () => this.openDashboard();

    /* Progress */
    const dashBtn = openBtns.createEl("button");
    const icoDash = dashBtn.createSpan();
    setIcon(icoDash, "bar-chart-2");
    icoDash.style.marginRight = "4px";
    dashBtn.createSpan({ text: "Progress" });
    attachTip(dashBtn, "Open progress dashboard for this portfolio");
    dashBtn.onclick = () => this.openProgress();

    /* Timeline */
    const tlBtn = openBtns.createEl("button");
    const icoTl = tlBtn.createSpan();
    setIcon(icoTl, "calendar-clock");
    icoTl.style.marginRight = "4px";
    tlBtn.createSpan({ text: "Timeline" });
    attachTip(tlBtn, "Open timeline view for this portfolio");
    tlBtn.onclick = () => this.openTimeline();

    /* Weekly view */
    const wkBtn = openBtns.createEl("button");
    const icoWk = wkBtn.createSpan();
    setIcon(icoWk, "calendar-check");
    icoWk.style.marginRight = "4px";
    wkBtn.createSpan({ text: "Weekly" });
    attachTip(wkBtn, "Open weekly task view for this portfolio");
    wkBtn.onclick = () => this.openTaskWeeks();

    /* Resources */
    const resBtn = openBtns.createEl("button");
    const icoRs = resBtn.createSpan();
    setIcon(icoRs, "users");
    icoRs.style.marginRight = "4px";
    resBtn.createSpan({ text: "Resources" });
    attachTip(resBtn, "Open resources allocation view for this portfolio");
    resBtn.onclick = () => this.openResources();


    /* Description textarea – row beneath the header buttons */
    const descRow = panel.createDiv({ cls: "pm-port-desc-row" });
    const descBox = (this.descBox = descRow.createEl("textarea", {
      cls: "pm-port-desc",
      text: selected.description ?? "",
      attr: { placeholder: "Add a brief description…" },
    }));
    if (selected.descHeight) descBox.style.height = `${selected.descHeight}px`;

    const saveHeight = async () => {
      const h = descBox.clientHeight;
      if (h && h !== selected.descHeight) {
        selected.descHeight = h;
        await this.savePortfolio(selected);
      }
    };
    /* Auto‑persist height whenever user resizes textarea */
    const ro = new ResizeObserver(() => {
      const h = descBox.clientHeight;
      if (h && h !== selected.descHeight) {
        selected.descHeight = h;
        this.savePortfolio(selected);    // fire‑and‑forget; no await needed
      }
    });
    ro.observe(descBox);
    this.register(() => ro.disconnect());
    const saveDesc = async () => {
      selected.description = descBox.value.trim();
      await this.savePortfolio(selected);        // persist YAML right away
      await saveHeight();
    };
    descBox.addEventListener("change", saveDesc);
    descBox.addEventListener("blur",   saveDesc);  // safety if user tabs away
    // descBox.addEventListener("mouseup", saveHeight);   // user finished resize

    /* ---- project picker ---- */
    const tbl = panel.createEl("table", { cls: "pm-port-proj-table" });
    const thead = tbl.createEl("thead");
    const headRow = thead.createEl("tr");

    headRow.createEl("th");   // blank checkbox column

    /* ---- Project ---- */
    const nameHead  = headRow.createEl("th", { cls: "pm-click-sort" });
    nameHead.createSpan({ text: "Project" });
    const icoName   = nameHead.createSpan({ cls: "pm-sort-ico" });
    if (this.sortKey === "name") {
      setIcon(icoName, this.sortDir === 1 ? "chevron-up" : "chevron-down");
      icoName.style.opacity = "";
    } else {
      setIcon(icoName, "chevrons-up-down");
      icoName.style.opacity = "0.5";
    }
    nameHead.onclick = () => this.toggleSort("name");

    /* ---- Area ---- */
    const areaHead  = headRow.createEl("th", { cls: "pm-click-sort" });
    areaHead.createSpan({ text: "Area" });
    const icoArea   = areaHead.createSpan({ cls: "pm-sort-ico" });
    if (this.sortKey === "area") {
      setIcon(icoArea, this.sortDir === 1 ? "chevron-up" : "chevron-down");
      icoArea.style.opacity = "";
    } else {
      setIcon(icoArea, "chevrons-up-down");
      icoArea.style.opacity = "0.5";
    }
    areaHead.onclick = () => this.toggleSort("area");

    /* ---- Priority ---- */
    const prioHead  = headRow.createEl("th", { cls: "pm-click-sort" });
    prioHead.createSpan({ text: "Priority" });
    const icoPrio   = prioHead.createSpan({ cls: "pm-sort-ico" });
    if (this.sortKey === "priority") {
      setIcon(icoPrio, this.sortDir === 1 ? "chevron-up" : "chevron-down");
      icoPrio.style.opacity = "";
    } else {
      setIcon(icoPrio, "chevrons-up-down");
      icoPrio.style.opacity = "0.5";
    }
    prioHead.onclick = () => this.toggleSort("priority");

    headRow.createEl("th");   // blank actions column

    const tbody = tbl.createEl("tbody");

    /* Build helper map for category / priority */
    const projMeta = new Map<string, { cat: string; prio: number | null }>();
    /* Normalise front‑matter keys: strip non‑letters and lowercase */
    const normKey = (s: string) => s.replace(/[^a-z]/gi, "").toLowerCase();


    for (const p of this.cache.projects.values()) {
      const cacheFm = this.app.metadataCache.getFileCache(p.file)?.frontmatter ?? {};
      const val = (key: string) => {
        const want = normKey(key);
        const found = Object.entries(cacheFm).find(
          ([k]) => normKey(k) === want
        );
        return found ? found[1] : undefined;
      };
      const cat = (val("area") as string) ?? p.file.parent?.name ?? "—";
      const pr  = Number(val("priority"));
      projMeta.set(p.file.path, { cat, prio: isNaN(pr) ? null : pr });
    }

    const projects = Array.from(this.cache.projects.values()).sort((a, b) => {
      const metaA = projMeta.get(a.file.path)!;
      const metaB = projMeta.get(b.file.path)!;

      if (this.sortKey === "area") {
        return this.sortDir * metaA.cat.localeCompare(metaB.cat);
      }
      if (this.sortKey === "priority") {
        return this.sortDir * ((metaA.prio ?? 999) - (metaB.prio ?? 999));
      }
      // default name
      return this.sortDir * a.file.basename.localeCompare(b.file.basename);
    });

    for (const proj of projects) {
      const isSelected = selected.projectPaths.includes(proj.file.path);
      const row = tbody.createEl("tr", { cls: isSelected ? "active" : "" });
      if (!isSelected) row.style.opacity = "0.5";  // grey out unselected rows
      const cellChk = row.createEl("td");
      const chk = cellChk.createEl("span", { cls: "pm-port-check" });
      chk.style.cursor = "pointer";
      chk.style.display = "inline-block";
      chk.style.width = "16px";
      chk.style.height = "16px";
      
      // Set initial icon state
      setIcon(chk, isSelected ? "check-circle" : "circle");
      
      chk.onclick = () => {
        const newSelected = !selected.projectPaths.includes(proj.file.path);
        if (newSelected) {
          if (!selected.projectPaths.includes(proj.file.path))
            selected.projectPaths.push(proj.file.path);
          row.addClass("active");
          row.style.opacity = "1";
          setIcon(chk, "check-circle");
        } else {
          selected.projectPaths = selected.projectPaths.filter(
            (p) => p !== proj.file.path
          );
          row.removeClass("active");
          row.style.opacity = "0.5";
          setIcon(chk, "circle");
        }
      };
      // Name cell: clickable link opens the project note
      const nameCell = row.createEl("td");
      const link = nameCell.createEl("a", {
        text: proj.file.basename,
        cls: "pm-port-proj-link",
        href: "#",
      });
      link.onclick = (e) => {
        e.preventDefault();
        this.app.workspace.openLinkText(proj.file.path, "", false);
      };
      /* ── Hover tooltip showing front‑matter ─────────────────────── */
      let hoverEl: HTMLElement | null = null;

      link.addEventListener("mouseenter", () => {
        const cache = this.app.metadataCache.getFileCache(proj.file);
        const fm: Record<string, any> = cache?.frontmatter ?? {};

        const get = (k: string) =>
          fm[k] ??
          fm[k.replace(/ /g, "").toLowerCase()] ??
          "—";

        const html = `
          <strong>${proj.file.basename}</strong><br>
          <em>${get("Description")}</em><br>
          <span>Start: ${get("Start Date")}</span><br>
          <span>Due  : ${get("End Date") || get("Due Date")}</span>
        `;

        hoverEl = document.createElement("div");
        hoverEl.classList.add("pm-port-tooltip");
        hoverEl.innerHTML = html;
        document.body.appendChild(hoverEl);

        const rect = link.getBoundingClientRect();
        const pad  = 8;                              // gap from window edges

        /* Default position: to the right of the link */
        let left = rect.right + 8;
        let top  = rect.top;

        /* Measure tooltip after it’s in the DOM */
        const tipW = hoverEl.offsetWidth  || 220;    // fallback width
        const tipH = hoverEl.offsetHeight || 140;    // fallback height

        /* Horizontal overflow – flip to left side */
        if (left + tipW > window.innerWidth - pad) {
          left = Math.max(rect.left - tipW - 8, pad);
        }

        /* Vertical overflow – clamp within viewport */
        if (top + tipH > window.innerHeight - pad) {
          top = Math.max(window.innerHeight - tipH - pad, pad);
        }

        hoverEl.style.left = `${left}px`;
        hoverEl.style.top  = `${top}px`;
      });

      link.addEventListener("mouseleave", () => {
        hoverEl?.remove();
        hoverEl = null;
      });

      /* ----------------------------------------------------------------
         Pull fresh front‑matter from Obsidian’s metadata cache           */
      const cache = this.app.metadataCache.getFileCache(proj.file);
      const fm: Record<string, any> = cache?.frontmatter ?? {};

      /**
       * Grab a front‑matter value using case‑insensitive comparison and by
       * stripping non‑letter characters (so “Priority” or “priority::” both match).
       */
      const fmVal = (want: string) => {
        const norm = (s: string) => s.replace(/[^a-z]/gi, "").toLowerCase();
        const wantNorm = norm(want);
        for (const [k, v] of Object.entries(fm)) {
          if (norm(k) === wantNorm) {
            if (typeof v === "string" || typeof v === "number") return v;
            if (Array.isArray(v)) return v.join(", ");
          }
        }
        return undefined;
      };

      const meta = projMeta.get(proj.file.path)!;
      row.createEl("td", { text: meta.cat });

      const prioText = meta.prio !== null ? String(meta.prio) : "—";
      row.createEl("td", { text: prioText });

      /* Actions: open this single project in Dashboard or Timeline */
      const actCell = row.createEl("td", { cls: "pm-port-actions" });

      const icoDash = actCell.createSpan();
      setIcon(icoDash, "bar-chart-2");        // new bar‑chart icon
      icoDash.classList.add("clickable-icon");
      attachTip(icoDash, "Open Progress");    // updated tooltip
      icoDash.onclick = () => this.openDashboardFor([proj.file.path]);

      const icoTl = actCell.createSpan();
      setIcon(icoTl, "calendar-clock");
      icoTl.classList.add("clickable-icon");
      attachTip(icoTl, "Open Timeline");
      icoTl.onclick = () => this.openTimelineFor([proj.file.path]);

      const icoWk = actCell.createSpan();
      setIcon(icoWk, "calendar-check");
      icoWk.classList.add("clickable-icon");
      attachTip(icoWk, "Open Weekly");
      icoWk.onclick = () => this.openTaskWeeksFor([proj.file.path]);

      const icoRes = actCell.createSpan();
      setIcon(icoRes, "users");
      icoRes.classList.add("clickable-icon");
      attachTip(icoRes, "Open Resources");
      icoRes.onclick = () => this.openResourcesFor([proj.file.path]);
    }

    const saveBtn = panel.createEl("button", { text: "Save", cls: "pm-port-save" });
    saveBtn.onclick = async () => {
      await saveHeight();                   // capture latest resize first
      await this.savePortfolio(selected);   // writes YAML + reloads list
      this.render();                        // re-render UI with latest data
      new Notice("Portfolio saved");
    };
    attachTip(saveBtn, "Save description, layout and selection changes");
  }
  /** Open Dashboard filtered to the supplied project paths */
  private async openDashboardFor(paths: string[]) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_PROGRESS)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf();
    }

    // Type-safe: only use basename if TFile
    const projFile = paths.length === 1
      ? this.app.vault.getAbstractFileByPath(paths[0])
      : null;
    const projName = projFile instanceof TFile ? projFile.basename : "";

    if (leaf) {
      await leaf.setViewState({
        type:   VIEW_TYPE_PM_PROGRESS,
        active: true,
        state:  {
          filterProjects: paths,
          filterName:     projName,          // "Progress - <project>"
        },
      });

      const view: any = leaf.view;
      if (view?.updateFilter) view.updateFilter(paths, projName);

      this.app.workspace.revealLeaf(leaf);
    }
  }

  /** Open Timeline filtered to the supplied project paths */
  private async openTimelineFor(paths: string[]) {
    /* Re‑use an existing Timeline pane if the setting is enabled */
    let leaf: WorkspaceLeaf | undefined;
    if (this.settings.reuseTimelinePane) {
      leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE)[0];
    }
    if (!leaf) leaf = this.app.workspace.splitActiveLeaf("horizontal");

    const projFile = paths.length === 1
      ? this.app.vault.getAbstractFileByPath(paths[0])
      : null;
    const projName = projFile instanceof TFile ? projFile.basename : "";

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_TIMELINE,
      active: true,
      state:  {
        filterProjects: paths,
        filterName:     projName,
      },
    });

    const view: any = leaf.view;
    if (view?.updateFilter) view.updateFilter(paths, projName);

    this.app.workspace.revealLeaf(leaf);
  }
  /** Open Task Weeks filtered to the current portfolio */
  private async openTaskWeeks() {
    const sel    = this.portfolios.find((pf) => pf.id === this.selectedId);
    const filter = sel?.projectPaths ?? [];

    // Re-use existing leaf, or create a new bottom pane if none exists
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TASKWEEKS)[0];

    if (!leaf) {
      // No Task‑Weeks view open yet → create a new bottom pane
      leaf = this.app.workspace.splitActiveLeaf("horizontal");
    }

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_TASKWEEKS,
      active: true,
      state:  {
        filterProjects: filter,
        filterName:     sel?.name ?? "",
      },
    });

    const view: any = leaf.view;
    if (view?.updateFilter) view.updateFilter(filter, sel?.name ?? "");

    this.app.workspace.revealLeaf(leaf);
  }

  /** Open Task Weeks filtered to the supplied project paths */
  private async openTaskWeeksFor(paths: string[]) {
    /* Re‑use an existing Task‑Weeks pane only if the setting is enabled */
    let leaf: WorkspaceLeaf | undefined;
    if (this.settings.reuseTaskWeeksPane) {
      leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TASKWEEKS)[0];
    }
    if (!leaf) leaf = this.app.workspace.splitActiveLeaf("horizontal");

    const projFile = paths.length === 1
      ? this.app.vault.getAbstractFileByPath(paths[0])
      : null;
    const projName = projFile instanceof TFile ? projFile.basename : "";

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_TASKWEEKS,
      active: true,
      state:  {
        filterProjects: paths,
        filterName:     projName,
      },
    });

    const view: any = leaf.view;
    if (view?.updateFilter) view.updateFilter(paths, projName);

    this.app.workspace.revealLeaf(leaf);
  }

  /** Open Resources view filtered to current portfolio */
  private async openResources() {
    const sel    = this.portfolios.find((pf) => pf.id === this.selectedId);
    const filter = sel?.projectPaths ?? [];

    /* Prefer an existing Resources leaf; otherwise open in bottom pane */
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_RESOURCES)[0];

    if (!leaf) {
      // Create a new horizontal split (bottom pane)
      leaf = this.app.workspace.splitActiveLeaf("horizontal");
    }

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_RESOURCES,
      active: true,
      state:  {
        filterProjects: filter,
        filterName:     sel?.name ?? "",
      },
    });

    const view: any = leaf.view;
    if (view?.updateFilter) view.updateFilter(filter, sel?.name ?? "");

    this.app.workspace.revealLeaf(leaf);
  }

  /** Open Resources view filtered to the supplied project paths */
  private async openResourcesFor(paths: string[]) {
    /* Re‑use an existing Resources pane only if the setting is enabled */
    let leaf: WorkspaceLeaf | undefined;
    if (this.settings.reuseResourcesPane) {
      leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_RESOURCES)[0];
    }
    if (!leaf) leaf = this.app.workspace.splitActiveLeaf("horizontal");

    const projFile = paths.length === 1
      ? this.app.vault.getAbstractFileByPath(paths[0])
      : null;
    const projName = projFile instanceof TFile ? projFile.basename : "";

    await leaf.setViewState({
      type:   VIEW_TYPE_PM_RESOURCES,
      active: true,
      state:  {
        filterProjects: paths,
        filterName:     projName,
      },
    });

    const view: any = leaf.view;
    if (view?.updateFilter) view.updateFilter(paths, projName);

    this.app.workspace.revealLeaf(leaf);
  }
}
