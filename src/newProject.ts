import { App, TFile, TFolder, Modal, Notice, normalizePath } from "obsidian";

/**
 * Prompt the user for basic metadata and create a new project note
 * in the “Projects/” folder using the standard layout.
 */
export async function newProject(app: App, targetFolder?: TFolder) {
  // Prevent accidental double‑invocation (e.g. button fires twice)
  if ((app as any)._pmCreatingProject) return;
  (app as any)._pmCreatingProject = true;
  try {
    // ── helper: quick modal to collect a single string value ────────────
    const ask = (title: string, placeholder = ""): Promise<string | null> =>
      new Promise((res) => {
        new class extends Modal {
          onOpen() {
            this.contentEl.createEl("h3", { text: title });
            const input = this.contentEl.createEl("input", {
              type: "text",
              placeholder,
            });
            input.focus();
            const ok = this.contentEl.createEl("button", { text: "OK" });
            ok.onclick = () => { this.close(); res(input.value.trim() || null); };
            this.contentEl.createEl("button", { text: "Cancel" }).onclick = () => {
              this.close(); res(null);
            };
          }
        }(app).open();
      });
    // ── Ask for a project title ─────────────────────────────────────────
    const title = await ask("Project title", "Gap Analysis");
    if (!title) return;

    // ── Ask for a project number (optional) ─────────────────────────────
    const projNum = await ask("Project Number (optional)", "1.1.2");

    // ── Date helpers ────────────────────────────────────────────────────
    const momentFn = (window as any).moment;
    const startDate = momentFn().format("YYYY-MM-DD");
    const endDate   = momentFn().add(2, "months").endOf("month").format("YYYY-MM-DD");

    // Front‑matter key that marks a Project note
    const pmPlugin = (app as any).plugins?.getPlugin?.("project-management");
    const flagKey: string = pmPlugin?.settings?.projectFlagProperty?.trim?.() || "project";

    const baseDir = targetFolder ? targetFolder.path : "Projects";

    /* If the user typed a project number, prepend it to the file name */
    const safeNum = projNum ? projNum.replace(/[^\w.-]/g, "-") : "";
    const safeNumDot =
      safeNum && !safeNum.endsWith(".") ? `${safeNum}.` : safeNum;
    const fileName = safeNum
      ? `${safeNumDot} ${title}.md`
      : `${title}.md`;
    const filePath = `${baseDir}/${fileName}`;

    let template = `---
Start Date: ${startDate}
End Date: ${endDate}
Project Number: "${projNum ?? ""}"
Description: "This is a description of the project."
Priority (1-5): "1"
Area: Work
cssclasses:
  - wide-page
${flagKey}: true
---

## 🗂️ Epics

| ID  | Title           | Assignee | Start              | Due              | Description |
| --- | --------------- | -------- | ------------------ | ---------------- | ----------- |
| E-1 | - [ ] Main Task | assignee:: Me | start:: ${startDate} | due:: ${endDate} | Main Epic   |

### 📄 Stories

| ID  | Epic | Title       | Depends          | Assignee      | Priority | Start              | Due              | Description |
| --- | ---- | ----------- | ---------------- | ------------- | -------- | ------------------ | ---------------- | ----------- |
| S-1 | E-1  | - [ ] To Do | depends:: SS:E-1 | assignee:: Me | 1        | start:: ${startDate} | due:: 2025-07-25 | A Story     |

#### 🔧 Sub-tasks

| ID   | Story | Title            | Depends          | Assignee      | Start              | Due              | Description            |
| ---- | ----- | ---------------- | ---------------- | ------------- | ------------------ | ---------------- | ---------------------- |
| SB-1 | S-1   | - [ ] Sub Task 1 | depends:: SF:S-1 | assignee:: Me | start:: ${startDate} | due:: ${endDate} | How to do the sub task |
| SB-2 | S-1   | - [ ] Sub Task 2 | depends:: SS:S-1 | assignee:: Me | start:: ${startDate} | due:: ${endDate} | How to do the sub task |
| SB-3 | S-1   | - [ ] Sub Task 3 | depends:: FF:S-1 | assignee:: Me | start:: ${startDate} | due:: ${endDate} | How to do the sub task |
| SB-4 | S-1   | - [ ] Sub Task 4 | depends:: FS:S-1 | assignee:: Me | start:: ${startDate} | due:: ${endDate} | How to do the sub task |

## 🎯 Milestones
| ID  | Title       | Date       | Description        |
| --- | ----------- | ---------- | ------------------ |
| M-1 | Milestone 1 | ${endDate} | Milestone Number 1 |

## ⚠️ Risks
*None logged.*

## 📋 Action-Item Backlog
*No action items yet.*
`;

    /* ── Override with user‑defined template if the setting is non‑blank ── */
    const tplPath: string =
      pmPlugin?.settings?.projectTemplate?.trim?.() ?? "";

    if (tplPath) {
      const tplFile = app.vault.getFileByPath(tplPath);
      if (tplFile instanceof TFile) {
        template = await app.vault.cachedRead(tplFile);

        /* ── If the template's front‑matter contains the project flag set to false
           flip it to true so the new note is recognised. */
        const flagRE = new RegExp(`(^|\\n)([ \\t]*${flagKey}[ \\t]*:[ \\t]*)([\"']?false[\"']?)([ \\t]*\\r?\\n)`, "i");
        template = template.replace(flagRE, (_m, p1, p2, _pFalse, p4) => `${p1}${p2}true${p4}`);
      } else {
        new Notice(`Template “${tplPath}” not found – using default.`);
      }
    }

    // ── Create or update the note ───────────────────────────────────────
    let file: TFile | null = null;
    const dirPath  = targetFolder ? targetFolder.path : "Projects";
    const fullPath = normalizePath(`${dirPath}/${fileName}`);

    const existing = app.vault.getFileByPath(fullPath);
    if (!existing) {
      file = await app.vault.create(fullPath, template);
    } else if (existing instanceof TFile) {
      file = existing;
      await app.vault.modify(existing, template);
    }

    // If file wasn't assigned (shouldn't happen), find it now
    if (!file) {
      const foundFile = app.vault.getFileByPath(fullPath);
      file = foundFile instanceof TFile ? foundFile : null;
    }
    if (!file) {
      throw new Error("Failed to create project file");
    }
    // ── Open the new note in a fresh pane ───────────────────────────────
    await app.workspace.getLeaf(true).openFile(file);
  } finally {
    delete (app as any)._pmCreatingProject;   // release the lock
  }
}