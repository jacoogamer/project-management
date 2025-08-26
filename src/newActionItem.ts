import { App, TFile, TFolder, Notice, Modal, Setting, DropdownComponent } from "obsidian";
import { ProjectCache } from "./services/cache";

interface ActionItemData {
  project: string;
  type: "epic" | "story" | "subtask";
  title: string;
  startDate: string;
  dueDate: string;
  description: string;
  assignee: string;
  parentEpic?: string;
  parentStory?: string;
  dependency?: string;
  dependencyType?: "FF" | "FS" | "SF" | "SS" | "";
}

export async function newActionItem(app: App, cache: ProjectCache) {
  const modal = new ActionItemModal(app, cache);
  modal.open();
}

class ActionItemModal extends Modal {
  private data: ActionItemData = {
    project: "",
    type: "epic",
    title: "",
    startDate: "",
    dueDate: "",
    description: "",
    assignee: "",
    parentEpic: "",
    parentStory: "",
    dependency: "",
    dependencyType: "FF"
  };
  
  private projects: Array<{ path: string; name: string }> = [];
  private assignees: string[] = [];
  private projectTasks: Map<string, Array<{ id: string; text: string }>> = new Map();
  private cache: ProjectCache;
  private dependencySetting?: Setting;
  private dependencyDropdown?: DropdownComponent;
  private parentStorySetting?: Setting;
  private parentStoryDropdown?: DropdownComponent;

  constructor(app: App, cache: ProjectCache) {
    super(app);
    this.cache = cache;
    this.loadProjects();
    this.loadAssignees();
    this.loadProjectTasks();
  }

  private loadProjects() {
    // Get all project files from the cache synchronously and sort alphabetically
    this.projects = Array.from(this.cache.projects.values())
      .map(project => ({
        path: project.file.path,
        name: project.file.basename
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private loadAssignees() {
    // Get all unique assignees from existing tasks and sort alphabetically
    const assigneeSet = new Set<string>();
    
    this.cache.projects.forEach(project => {
      project.tasks.forEach(task => {
        const assignee = task.props["assignee"];
        if (assignee && assignee.trim()) {
          assigneeSet.add(assignee.trim());
        }
      });
    });
    
    this.assignees = Array.from(assigneeSet).sort((a, b) => a.localeCompare(b));
  }

  private loadProjectTasks() {
    // Load tasks for each project and sort alphabetically
    this.cache.projects.forEach(project => {
      const tasks = project.tasks
        .map(task => ({
          id: task.id,
          text: task.text
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      
      this.projectTasks.set(project.file.path, tasks);
    });
  }

  private updateDependencyDropdown() {
    if (!this.dependencyDropdown) return;

    // Clear existing options
    this.dependencyDropdown.selectEl.empty();
    this.dependencyDropdown.addOption("", "Select a dependency...");

    // Add tasks from selected project
    if (this.data.project) {
      const tasks = this.projectTasks.get(this.data.project);
      if (tasks) {
        tasks.forEach(task => {
          const displayText = `${task.id} - ${task.text.split('\n')[0].trim()}`;
          this.dependencyDropdown!.addOption(task.id, displayText);
        });
      }
    }

    // Reset the value
    this.dependencyDropdown.setValue(this.data.dependency || "");
  }

  private getEpicsForProject(projectPath: string): Array<{ id: string; displayText: string }> {
    const project = this.cache.projects.get(projectPath);
    if (!project) return [];

    return project.tasks
      .filter(task => task.id.toLowerCase().startsWith('e'))
      .map(task => ({
        id: task.id,
        displayText: `${task.id} - ${task.text.split('\n')[0].trim()}`
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private getStoriesForEpic(projectPath: string, epicId: string): Array<{ id: string; displayText: string }> {
    const project = this.cache.projects.get(projectPath);
    if (!project) return [];

    return project.tasks
      .filter(task => {
        const taskId = task.id.toLowerCase();
        return taskId.startsWith('s') && !taskId.startsWith('sb');
      })
      .map(task => ({
        id: task.id,
        displayText: `${task.id} - ${task.text.split('\n')[0].trim()}`
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private updateParentStoryDropdown() {
    if (!this.parentStoryDropdown || !this.data.parentEpic) return;

    // Clear existing options
    this.parentStoryDropdown.selectEl.empty();
    this.parentStoryDropdown.addOption("", "Select a story...");

    // Add stories from the selected project
    if (this.data.project) {
      const stories = this.getStoriesForEpic(this.data.project, this.data.parentEpic);
      stories.forEach(story => {
        this.parentStoryDropdown!.addOption(story.id, story.displayText);
      });
    }

    // Reset the value
    this.parentStoryDropdown.setValue(this.data.parentStory || "");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Create New Action Item" });

    // Step 1: Project Selection
    new Setting(contentEl)
      .setName("Project")
      .setDesc("Select the project for this action item")
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown.addOption("", "Select a project...");
        this.projects.forEach(project => {
          dropdown.addOption(project.path, project.name);
        });
        dropdown.setValue(this.data.project);
        dropdown.onChange((value) => {
          this.data.project = value;
          // Update dependency dropdown when project changes
          this.updateDependencyDropdown();
          // Update parent dropdowns when project changes
          if (this.data.type === "story" || this.data.type === "subtask") {
            this.updateParentStoryDropdown();
          }
        });
      });

    // Step 2: Type Selection
    new Setting(contentEl)
      .setName("Type")
      .setDesc("Select the type of action item")
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown.addOption("epic", "Epic");
        dropdown.addOption("story", "Story");
        dropdown.addOption("subtask", "Subtask");
        dropdown.setValue(this.data.type);
        dropdown.onChange((value) => {
          this.data.type = value as "epic" | "story" | "subtask";
        });
      });

    // Step 3: Title
    new Setting(contentEl)
      .setName("Title")
      .setDesc("Enter a short, descriptive title for this action item")
      .addText((text) => {
        text.setPlaceholder("e.g., Design new user interface");
        text.setValue(this.data.title);
        text.onChange((value) => {
          this.data.title = value;
        });
      });

    // Step 4: Parent Epic (for Stories and Subtasks)
    if (this.data.type === "story" || this.data.type === "subtask") {
      new Setting(contentEl)
        .setName("Parent Epic")
        .setDesc("Select which epic this story/subtask belongs to")
        .addDropdown((dropdown: DropdownComponent) => {
          dropdown.addOption("", "Select an epic...");
          if (this.data.project) {
            const epics = this.getEpicsForProject(this.data.project);
            epics.forEach(epic => {
              dropdown.addOption(epic.id, epic.displayText);
            });
          }
          dropdown.setValue(this.data.parentEpic || "");
          dropdown.onChange((value) => {
            this.data.parentEpic = value;
            // Update parent story dropdown if this is a subtask
            if (this.data.type === "subtask") {
              this.updateParentStoryDropdown();
            }
          });
        });
    }

    // Step 5: Parent Story (for Subtasks only)
    if (this.data.type === "subtask") {
      this.parentStorySetting = new Setting(contentEl)
        .setName("Parent Story")
        .setDesc("Select which story this subtask belongs to")
        .addDropdown((dropdown: DropdownComponent) => {
          this.parentStoryDropdown = dropdown;
          dropdown.addOption("", "Select a story...");
          dropdown.setValue(this.data.parentStory || "");
          dropdown.onChange((value) => {
            this.data.parentStory = value;
          });
        });
    }

    // Step 6: Start Date
    new Setting(contentEl)
      .setName("Start Date")
      .setDesc("When should this action item start?")
      .addText((text) => {
        text.setPlaceholder("YYYY-MM-DD");
        text.setValue(this.data.startDate);
        text.onChange((value) => {
          this.data.startDate = value;
        });
      });

    // Step 7: Due Date
    new Setting(contentEl)
      .setName("Due Date")
      .setDesc("When should this action item be completed?")
      .addText((text) => {
        text.setPlaceholder("YYYY-MM-DD");
        text.setValue(this.data.dueDate);
        text.onChange((value) => {
          this.data.dueDate = value;
        });
      });

    // Step 8: Description
    new Setting(contentEl)
      .setName("Description")
      .setDesc("Describe what this action item is about")
      .addTextArea((text) => {
        text.setPlaceholder("Enter a description...");
        text.setValue(this.data.description);
        text.onChange((value) => {
          this.data.description = value;
        });
        text.inputEl.rows = 3;
      });

    // Step 9: Assignee
    new Setting(contentEl)
      .setName("Assignee")
      .setDesc("Who is responsible for this action item?")
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown.addOption("", "Select an assignee...");
        this.assignees.forEach(assignee => {
          dropdown.addOption(assignee, assignee);
        });
        dropdown.setValue(this.data.assignee);
        dropdown.onChange((value) => {
          this.data.assignee = value;
        });
      });

    // Step 10: Dependency Type (Optional)
    new Setting(contentEl)
      .setName("Dependency Type")
      .setDesc("Optional: Type of dependency relationship")
      .addDropdown((dropdown: DropdownComponent) => {
        dropdown.addOption("", "No dependency");
        dropdown.addOption("FF", "FF - Finish to Finish");
        dropdown.addOption("FS", "FS - Finish to Start");
        dropdown.addOption("SF", "SF - Start to Finish");
        dropdown.addOption("SS", "SS - Start to Start");
        dropdown.setValue(this.data.dependencyType || "");
        dropdown.onChange((value) => {
          this.data.dependencyType = value as "FF" | "FS" | "SF" | "SS" | "";
        });
      });

    // Step 11: Dependency (Optional)
    this.dependencySetting = new Setting(contentEl)
      .setName("Dependency")
      .setDesc("Optional: What does this action item depend on?")
      .addDropdown((dropdown: DropdownComponent) => {
        this.dependencyDropdown = dropdown;
        dropdown.addOption("", "Select a dependency...");
        dropdown.setValue(this.data.dependency || "");
        dropdown.onChange((value) => {
          this.data.dependency = value;
        });
      });

    // Buttons
    const buttonContainer = contentEl.createEl("div", { cls: "modal-button-container" });
    
    buttonContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
      this.close();
    });
    
    buttonContainer.createEl("button", { text: "Create Action Item", cls: "mod-cta" }).addEventListener("click", () => {
      this.createActionItem();
    });
  }

  private async createActionItem() {
    // Validate required fields
    if (!this.data.project) {
      new Notice("Please select a project");
      return;
    }
    if (!this.data.title.trim()) {
      new Notice("Please enter a title");
      return;
    }
    if (!this.data.description.trim()) {
      new Notice("Please enter a description");
      return;
    }
    if (!this.data.startDate) {
      new Notice("Please enter a start date");
      return;
    }
    if (!this.data.dueDate) {
      new Notice("Please enter a due date");
      return;
    }
    if (!this.data.assignee) {
      new Notice("Please select an assignee");
      return;
    }

    try {
      // Get the project file
      const projectFile = this.app.vault.getFileByPath(this.data.project);
      if (!projectFile || !(projectFile instanceof TFile)) {
        new Notice("Project file not found");
        return;
      }

      // Read the current content
      const content = await this.app.vault.read(projectFile);
      const lines = content.split("\n");

      // Generate the task ID based on type
      const taskId = this.generateTaskId(projectFile, this.data.type);

      // Create the task line based on type
      const taskLine = this.createTaskLine(taskId);

      // Find the appropriate table and insert the task
      const updatedLines = this.insertTaskIntoTable(lines, taskLine, this.data.type);

      // Write back to the file
      await this.app.vault.modify(projectFile, updatedLines.join("\n"));

      // Re-index the cache
      await this.cache.reindex();

      new Notice(`Created ${this.data.type} ${taskId}`);
      this.close();

    } catch (error) {
      console.error("Error creating action item:", error);
      new Notice("Error creating action item");
    }
  }

  private generateTaskId(projectFile: TFile, type: string): string {
    // Get existing tasks to find the next available ID
    const existingTasks = this.cache.getProjectTasks(projectFile.path) || [];
    
    let nextNumber = 1;
    const prefix = type === "epic" ? "E" : type === "story" ? "S" : "SB";
    
    // Find the highest existing number for this type
    existingTasks.forEach(task => {
      const taskId = task.id.toLowerCase();
      if (taskId.startsWith(prefix.toLowerCase())) {
        const match = taskId.match(new RegExp(`^${prefix.toLowerCase()}-(\\d+)`, 'i'));
        if (match) {
          const num = parseInt(match[1]);
          if (num >= nextNumber) {
            nextNumber = num + 1;
          }
        }
      }
    });

    return `${prefix}-${nextNumber}`;
  }

  private createTaskLine(taskId: string): string {
    const parts = [
      `- [ ] ${taskId} ${this.data.title}`,
      `  start:: ${this.data.startDate}`,
      `  due:: ${this.data.dueDate}`,
      `  assignee:: ${this.data.assignee}`
    ];

    if (this.data.dependency && this.data.dependency.trim()) {
      let dependencyLine = `  depends:: ${this.data.dependency.trim()}`;
      if (this.data.dependencyType && this.data.dependencyType.length > 0) {
        dependencyLine = `  depends:: ${this.data.dependencyType}:${this.data.dependency.trim()}`;
      }
      parts.push(dependencyLine);
    }

    return parts.join("\n");
  }

  private insertTaskIntoTable(lines: string[], taskLine: string, type: string): string[] {
    const newLines = [...lines];
    
    // Find the appropriate table based on type
    let tableStart = -1;
    let tableEnd = -1;
    
    if (type === "epic") {
      // Find the Epics table
      for (let i = 0; i < newLines.length; i++) {
        if (newLines[i].includes("## 🗂️ Epics")) {
          tableStart = i;
          break;
        }
      }
    } else if (type === "story") {
      // Find the Stories table
      for (let i = 0; i < newLines.length; i++) {
        if (newLines[i].includes("### 📄 Stories")) {
          tableStart = i;
          break;
        }
      }
    } else if (type === "subtask") {
      // Find the Sub-tasks table
      for (let i = 0; i < newLines.length; i++) {
        if (newLines[i].includes("#### 🔧 Sub-tasks")) {
          tableStart = i;
          break;
        }
      }
    }
    
    if (tableStart === -1) {
      // If table not found, insert after frontmatter
      for (let i = 0; i < newLines.length; i++) {
        if (newLines[i].startsWith("---")) {
          tableStart = i + 1;
          break;
        }
      }
      newLines.splice(tableStart, 0, taskLine);
      return newLines;
    }
    
    // Find the end of the table (next section or end of file)
    for (let i = tableStart + 1; i < newLines.length; i++) {
      if (newLines[i].startsWith("## ") || newLines[i].startsWith("### ") || newLines[i].startsWith("#### ")) {
        tableEnd = i;
        break;
      }
    }
    
    if (tableEnd === -1) {
      tableEnd = newLines.length;
    }
    
    // Find the last row in the table (before the closing)
    let insertIndex = tableEnd;
    for (let i = tableStart; i < tableEnd; i++) {
      if (newLines[i].includes("|") && !newLines[i].includes("---")) {
        insertIndex = i + 1;
      }
    }
    
    // Create the table row based on type
    const tableRow = this.createTableRow(taskLine, type);
    
    // Insert the new row
    newLines.splice(insertIndex, 0, tableRow);
    
    return newLines;
  }

  private createTableRow(taskLine: string, type: string): string {
    const taskId = taskLine.match(/- \[ \] ([A-Z]+-\d+)/)?.[1] || "";
    const title = `- [ ] ${this.data.title}`;
    const assignee = `assignee:: ${this.data.assignee}`;
    const startDate = `start:: ${this.data.startDate}`;
    const dueDate = `due:: ${this.data.dueDate}`;
    const description = this.data.description;
    
    let dependency = "";
    if (this.data.dependency && this.data.dependency.trim()) {
      dependency = this.data.dependencyType && this.data.dependencyType.length > 0 
        ? `depends:: ${this.data.dependencyType}:${this.data.dependency.trim()}`
        : `depends:: ${this.data.dependency.trim()}`;
    }
    
    if (type === "epic") {
      return `| ${taskId} | ${title} | ${assignee} | ${startDate} | ${dueDate} | ${description} |`;
    } else if (type === "story") {
      const parentEpic = this.data.parentEpic || "E-1";
      return `| ${taskId} | ${parentEpic} | ${title} | ${dependency} | ${assignee} | 1 | ${startDate} | ${dueDate} | ${description} |`;
    } else if (type === "subtask") {
      const parentStory = this.data.parentStory || "S-1";
      return `| ${taskId} | ${parentStory} | ${title} | ${dependency} | ${assignee} | ${startDate} | ${dueDate} | ${description} |`;
    }
    
    return taskLine;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
