import { App, PluginSettingTab, Setting } from "obsidian";
import type ProjectManagementPlugin from "./src/main";
import { VIEW_TYPE_PM_PROGRESS }  from "./src/views/progress";
import { VIEW_TYPE_PM_TIMELINE }  from "./src/views/timeline";
import { VIEW_TYPE_PM_TASKWEEKS } from "./src/views/task_weeks";
import { VIEW_TYPE_PM_RESOURCES } from "./src/views/resources";
import { VIEW_TYPE_PM_PORTFOLIO } from "./src/views/portfolio";

export interface PmSettings {
  // ===== Core Properties =====
  statusProperty: string;
  dueProperty: string;
  ownerProperty: string;
  /** Front‑matter boolean key that marks a note as a Project (default: "project") */
  projectFlagProperty: string;
  /** Vault‑relative path to a markdown file that will be used as the template
   *  when `New Project` creates a project note.  Blank = use the built‑in
   *  default template bundled with the plugin. */
  projectTemplate: string;
  statusValues: string[];

  // ===== Timeline View Settings =====
  showTasksInTimeline: boolean;      // new toggle
  showArrows: boolean;            // new toggle
  showHeatmap: boolean;      // new toggle
  showAssignees: boolean;   // toggle assignee labels
  showMilestones: boolean;
  showBarShadows: boolean;        // toggle bar shadows
  allowBarMove: boolean;           // enable Alt‑drag bar move
  timelineStart?: string;         // ISO YYYY‑MM‑DD for timeline start (empty = today)
  timelineEnd?:   string;         // ISO YYYY‑MM‑DD for timeline end   (empty = auto)
  zoomPxPerDay: number;      // default zoom level (px per day)
  heatMin: number;              // counts ≤ heatMin → coolest colour
  heatMax: number;              // counts ≥ heatMax → hottest colour

  // ===== Resources View Settings =====
  resourcesOverloadThreshold: number; // total tasks above this shows red alert

  // ===== Task Weeks View Settings =====
  taskWeeksOverloadThreshold: number; // weekly tasks above this shows red exclamation

  // ===== Light Mode Colors =====
  barColorE: string;        // colour for "E" tasks
  barColorS: string;        // colour for "S" tasks
  barColorSB: string;       // colour for "SB" tasks
  completedBarLight: string;
  milestoneLineLight: string;

  // ===== Dark Mode Colors =====
  barColorE_dark: string;      // dark‑mode E bar
  barColorS_dark: string;      // dark‑mode S bar
  barColorSB_dark: string;     // dark‑mode SB bar
  completedBarDark: string;
  milestoneLineDark:  string;

  // ===== Ribbon Icon Settings =====
  showProgressRibbon: boolean;
  showTimelineRibbon:  boolean;
  showTaskRibbon:      boolean;   // Task Weeks
  showResourcesRibbon: boolean;


  // ===== Pane Reuse Settings =====
  reuseProgressPane:  boolean;
  reuseTimelinePane:   boolean;
  reuseTaskWeeksPane:  boolean;
  reuseResourcesPane:  boolean;
}

export const DEFAULT_SETTINGS: PmSettings = {
  // ===== Core Properties =====
  statusProperty: "status",
  dueProperty: "due",
  ownerProperty: "owner",
  projectFlagProperty: "project",
  projectTemplate: "",
  statusValues: ["Todo", "Doing", "Review", "Done"],

  // ===== Timeline View Settings =====
  showTasksInTimeline: true,
  showArrows: true,
  showHeatmap: true,
  showAssignees: true,
  showMilestones: true,
  showBarShadows: true,
  allowBarMove: true,
  timelineStart: "",
  timelineEnd: "",
  zoomPxPerDay: 4,
  heatMin: 20,
  heatMax: 30,

  // ===== Resources View Settings =====
  resourcesOverloadThreshold: 20,

  // ===== Task Weeks View Settings =====
  taskWeeksOverloadThreshold: 5,

  // ===== Light Mode Colors =====
  barColorE: "#d9534f",   // red
  barColorS: "#6c757d",   // grey
  barColorSB: "#5bc0de",  // light-blue
  completedBarLight: "#9acd32", // light-mode done colour (yellow-green)
  milestoneLineLight: "#ff9900",

  // ===== Dark Mode Colors =====
  barColorE_dark: "#ff7670",  // softer red for dark bg
  barColorS_dark: "#adb5bd",  // muted grey
  barColorSB_dark: "#66d9ef", // cyan-ish blue
  completedBarDark: "#6fbf3a", // dark-mode done colour
  milestoneLineDark: "#ffb84d",

  // ===== Ribbon Icon Settings =====
  showProgressRibbon: true,
  showTimelineRibbon: true,
  showTaskRibbon: true,
  showResourcesRibbon: true,


  // ===== Pane Reuse Settings =====
  reuseProgressPane: true,
  reuseTimelinePane: true,
  reuseTaskWeeksPane: true,
  reuseResourcesPane: true,
};

export class PmSettingsTab extends PluginSettingTab {
  plugin: ProjectManagementPlugin;

  constructor(app: App, plugin: ProjectManagementPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Project Management Settings" });

    // ===== Core Properties =====
    const coreSection = containerEl.createEl("details", { cls: "pm-settings-section" });
    const coreSummary = coreSection.createEl("summary", { cls: "pm-settings-summary" });
    coreSummary.createEl("h2", { text: "Core Properties" });
    
    new Setting(coreSection)
      .setName("Status property key")
      .setDesc("Front‑matter/Property key to read & write task status.")
      .addText((text) =>
        text
          .setPlaceholder("status")
          .setValue(this.plugin.settings.statusProperty)
          .onChange(async (value) => {
            this.plugin.settings.statusProperty = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(coreSection)
      .setName("Due date property key")
      .setDesc("Front‑matter/Property key for due date.")
      .addText((text) =>
        text
          .setPlaceholder("due")
          .setValue(this.plugin.settings.dueProperty)
          .onChange(async (value) => {
            this.plugin.settings.dueProperty = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(coreSection)
      .setName("Project flag property key")
      .setDesc("Front‑matter boolean key used to detect a Project note.")
      .addText((text) =>
        text
          .setPlaceholder("project")
          .setValue(this.plugin.settings.projectFlagProperty)
          .onChange(async (value) => {
            this.plugin.settings.projectFlagProperty = value.trim() || "project";
            await this.plugin.saveSettings();

            // Re‑index cache to pick up projects with the new front matter key
            // @ts-ignore cache has reindex method
            if (typeof this.plugin.cache?.reindex === "function") {
              await this.plugin.cache.reindex();
            }

            // Refresh all project management views
            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_PROGRESS).forEach((leaf) => {
              const view = leaf.view as any;
              if (typeof view.render === "function") {
                view.render();
              }
            });

            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE).forEach((leaf) => {
              const view = leaf.view as any;
              if (typeof view.saveAndRender === "function") {
                view.saveAndRender();
              } else if (typeof view.render === "function") {
                view.render();
              }
            });

            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TASKWEEKS).forEach((leaf) => {
              const view = leaf.view as any;
              if (typeof view.render === "function") {
                view.render();
              }
            });

            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_RESOURCES).forEach((leaf) => {
              const view = leaf.view as any;
              if (typeof view.render === "function") {
                view.render();
              }
            });

            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_PORTFOLIO).forEach((leaf) => {
              const view = leaf.view as any;
              if (typeof view.render === "function") {
                view.render();
              }
            });
          })
      );

    /* ========= Project template ==================================================== */
    new Setting(coreSection)
      .setName("Project note template")
      .setDesc("Vault‑relative path to a Markdown file whose content will be "
             + "used when creating a new project. Leave blank to use the plugin’s "
             + "default built‑in template.")
      .addText(text =>
        text
          .setPlaceholder("Templates/ProjectTemplate.md   (blank = default)")
          .setValue(this.plugin.settings.projectTemplate)
          .onChange(async (value) => {
            this.plugin.settings.projectTemplate = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // ===== Timeline View Settings =====
    const timelineSection = containerEl.createEl("details", { cls: "pm-settings-section" });
    const timelineSummary = timelineSection.createEl("summary", { cls: "pm-settings-summary" });
    timelineSummary.createEl("h2", { text: "Timeline View" });
    
    new Setting(timelineSection)
      .setName("Show tasks on Timeline")
      .setDesc("Toggle display of individual task bars in the Timeline view.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTasksInTimeline)
          .onChange(async (value) => {
            this.plugin.settings.showTasksInTimeline = value;
            await this.plugin.saveSettings();

            // Re‑index cache and force each Timeline view to save its scroll, then refresh
            // @ts-ignore cache has reindex method
            if (typeof this.plugin.cache?.reindex === "function") {
              this.plugin.cache.reindex();
            }

            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE).forEach((leaf) => {
              {
                const view = leaf.view as any;
                if (typeof view.saveAndRender === "function") {
                  view.saveAndRender();
                } else if (typeof view.render === "function") {
                  view.render();
                }
              }
            });
          })
      );

    // ===== Resources View Settings =====
    const resourcesSection = containerEl.createEl("details", { cls: "pm-settings-section" });
    const resourcesSummary = resourcesSection.createEl("summary", { cls: "pm-settings-summary" });
    resourcesSummary.createEl("h2", { text: "Resources View" });

    new Setting(resourcesSection)
      .setName("Overload threshold (tasks)")
      .setDesc("If an assignee’s total tasks exceed this number, show a red exclamation in Resources.")
      .addText((text) =>
        text
          .setPlaceholder("20")
          .setValue(String(this.plugin.settings.resourcesOverloadThreshold))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isNaN(n)) {
              this.plugin.settings.resourcesOverloadThreshold = n;
              await this.plugin.saveSettings();
              // Refresh Resources views
              this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_RESOURCES).forEach((leaf) => {
                const view = leaf.view as any;
                if (typeof view.render === "function") view.render();
              });
            }
          })
      );

    // ===== Task Weeks View Settings =====
    const taskWeeksSection = containerEl.createEl("details", { cls: "pm-settings-section" });
    const taskWeeksSummary = taskWeeksSection.createEl("summary", { cls: "pm-settings-summary" });
    taskWeeksSummary.createEl("h2", { text: "Task Weeks View" });

    new Setting(taskWeeksSection)
      .setName("Weekly overload threshold (tasks)")
      .setDesc("If a week's total tasks exceed this number, show a red exclamation in Task Weeks.")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.taskWeeksOverloadThreshold))
          .onChange(async (value) => {
            const n = Number(value);
            if (!Number.isNaN(n)) {
              this.plugin.settings.taskWeeksOverloadThreshold = n;
              await this.plugin.saveSettings();
              // Refresh Task Weeks views
              this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TASKWEEKS).forEach((leaf) => {
                const view = leaf.view as any;
                if (typeof view.render === "function") view.render();
              });
            }
          })
      );

    new Setting(timelineSection)
      .setName("Show dependency arrows")
      .setDesc("Toggle display of arrows that connect tasks with depends:: links in Timeline view.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showArrows)
          .onChange(async (value) => {
            this.plugin.settings.showArrows = value;
            await this.plugin.saveSettings();

            // Re‑index cache and force each Timeline view to save its scroll, then refresh
            // @ts-ignore cache has reindex method
            if (typeof this.plugin.cache?.reindex === "function") {
              this.plugin.cache.reindex();
            }

            this.app.workspace.getLeavesOfType("pm-timeline").forEach((leaf) => {
              {
                const view = leaf.view as any;
                if (typeof view.saveAndRender === "function") {
                  view.saveAndRender();
                } else if (typeof view.render === "function") {
                  view.render();
                }
              }
            });
          })
      );

    new Setting(timelineSection)
      .setName("Show workload heat‑map")
      .setDesc("Thin colour strip under the header shows how many tasks overlap each day.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showHeatmap)
          .onChange(async (value) => {
            this.plugin.settings.showHeatmap = value;
            await this.plugin.saveSettings();

            // Refresh Timeline views without losing scroll
            this.app.workspace.getLeavesOfType("pm-timeline").forEach((leaf) => {
              const v = leaf.view as any;
              if (typeof v.saveAndRender === "function") v.saveAndRender();
              else if (typeof v.render === "function") v.render();
            });
          })
      );

    /* Heat‑map intensity range */
    new Setting(timelineSection)
      .setName("Heat‑map minimum (tasks)")
      .setDesc("Daily counts at or below this value are shown in the coolest colour.")
      .addText(text =>
        text
          .setPlaceholder("20")
          .setValue(String(this.plugin.settings.heatMin))
          .onChange(async (value) => {
            const n = Number(value);
            if (!isNaN(n)) {
              this.plugin.settings.heatMin = n;
              await this.plugin.saveSettings();

              /* Refresh Timeline views */
              this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE).forEach((leaf) => {
                const v = leaf.view as any;
                if (typeof v.saveAndRender === "function") v.saveAndRender();
                else if (typeof v.render === "function") v.render();
              });
            }
          })
      );

    new Setting(timelineSection)
      .setName("Heat‑map maximum (tasks)")
      .setDesc("Daily counts at or above this value are rendered in the hottest colour.")
      .addText(text =>
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.heatMax))
          .onChange(async (value) => {
            const n = Number(value);
            if (!isNaN(n)) {
              this.plugin.settings.heatMax = n;
              await this.plugin.saveSettings();

              /* Refresh Timeline views */
              this.app.workspace.getLeavesOfType("pm-timeline").forEach((leaf) => {
                const v = leaf.view as any;
                if (typeof v.saveAndRender === "function") v.saveAndRender();
                else if (typeof v.render === "function") v.render();
              });
            }
          })
      );

    /* ---- Timeline date range ---- */
    new Setting(timelineSection)
      .setName("Timeline start date")
      .setDesc("Anchor the left edge of the Timeline. YYYY‑MM‑DD, blank = today.")
      .addText(text =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.timelineStart ?? "")
          .onChange(async (value) => {
            this.plugin.settings.timelineStart = value.trim();
            await this.plugin.saveSettings();

            /* Refresh all open Timeline views */
            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE).forEach((leaf) => {
              const v = leaf.view as any;
              if (typeof v.saveAndRender === "function") v.saveAndRender();
              else if (typeof v.render === "function") v.render();
            });
          })
      );

    new Setting(timelineSection)
      .setName("Timeline end date")
      .setDesc("Right edge of the Timeline. YYYY‑MM‑DD, blank = auto horizon.")
      .addText(text =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.timelineEnd ?? "")
          .onChange(async (value) => {
            this.plugin.settings.timelineEnd = value.trim();
            await this.plugin.saveSettings();

            /* Refresh all open Timeline views */
            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE).forEach((leaf) => {
              const v = leaf.view as any;
              if (typeof v.saveAndRender === "function") v.saveAndRender();
              else if (typeof v.render === "function") v.render();
            });
          })
      );

    new Setting(timelineSection)
      .setName("Show bar shadows")
      .setDesc("Toggle the drop‑shadow beneath each task bar in Timeline view.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showBarShadows)
          .onChange(async (value) => {
            this.plugin.settings.showBarShadows = value;
            await this.plugin.saveSettings();

            // Refresh Timeline views without losing scroll
            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE).forEach((leaf) => {
              const v = leaf.view as any;
              if (typeof v.saveAndRender === "function") v.saveAndRender();
              else if (typeof v.render === "function") v.render();
            });
          })
      );

    new Setting(timelineSection)
      .setName("Show assignee labels")
      .setDesc("Display the assignee name next to each task bar.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showAssignees)
          .onChange(async (value) => {
            this.plugin.settings.showAssignees = value;
            await this.plugin.saveSettings();

            /* Refresh Timeline views without losing scroll */
            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE).forEach((leaf) => {
              const v = leaf.view as any;
              if (typeof v.saveAndRender === "function") v.saveAndRender();
              else if (typeof v.render === "function") v.render();
            });
          })
      );

    new Setting(timelineSection)
      .setName("Enable bar drag‑to‑move")
      .setDesc("Allow Alt‑dragging a bar in the timeline to shift its start/due dates.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.allowBarMove)
          .onChange(async (value) => {
            this.plugin.settings.allowBarMove = value;
            await this.plugin.saveSettings();

            /* Refresh Timeline views without losing scroll */
            this.app.workspace.getLeavesOfType(VIEW_TYPE_PM_TIMELINE).forEach((leaf) => {
              const v = leaf.view as any;
              if (typeof v.saveAndRender === "function") v.saveAndRender();
              else if (typeof v.render === "function") v.render();
            });
          })
      );

    /* Zoom level (px per day) slider */
    new Setting(timelineSection)
      .setName("Default zoom (px per day)")
      .setDesc("Sets the initial horizontal scale for Timeline views.")
      .addSlider((slider) =>
        slider
          .setLimits(2, 10, 1)
          .setValue(this.plugin.settings.zoomPxPerDay)
          .onChange(async (value) => {
            this.plugin.settings.zoomPxPerDay = value;
            await this.plugin.saveSettings();

            /* Refresh open Timeline views with new default zoom */
            this.app.workspace.getLeavesOfType("pm-timeline").forEach((leaf) => {
              const v = leaf.view as any;
              if (typeof v.saveAndRender === "function") v.saveAndRender();
              else if (typeof v.render === "function") v.render();
            });
          })
      );

    /* Milestone settings */
    new Setting(timelineSection)
      .setName("Show milestone lines")
      .setDesc("Display vertical guideline bars for milestones in the Timeline.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showMilestones)
         .onChange(async v => {
           this.plugin.settings.showMilestones = v;
           await this.plugin.saveSettings();
           this.plugin.applyBarColours?.();
           this.app.workspace.getLeavesOfType("pm-timeline")
             .forEach(l => ((l.view as any).saveAndRender?.() ?? (l.view as any).render?.()));
         })
      );

    // ===== Light Mode Colors =====
    const lightColorsSection = containerEl.createEl("details", { cls: "pm-settings-section" });
    const lightColorsSummary = lightColorsSection.createEl("summary", { cls: "pm-settings-summary" });
    lightColorsSummary.createEl("h2", { text: "Light Mode Colors" });
    
    /* Bar colour pickers */
    new Setting(lightColorsSection)
      .setName("Bar colour – E tasks")
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings.barColorE)
          .onChange(async (value) => {
            this.plugin.settings.barColorE = value;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours();   // refresh CSS vars if helper exists
          })
      );

    new Setting(lightColorsSection)
      .setName("Bar colour – S tasks")
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings.barColorS)
          .onChange(async (value) => {
            this.plugin.settings.barColorS = value;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours();
          })
      );

    new Setting(lightColorsSection)
      .setName("Bar colour – SB tasks")
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings.barColorSB)
          .onChange(async (value) => {
            this.plugin.settings.barColorSB = value;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours();
          })
      );

    new Setting(lightColorsSection)
      .setName("Completed-task bar")
      .addColorPicker(cp =>
        cp.setValue(this.plugin.settings.completedBarLight)
          .onChange(async (val) => {
            this.plugin.settings.completedBarLight = val;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours?.();   // refresh CSS vars
          })
    );

    new Setting(lightColorsSection)
      .setName("Milestone line")
      .addColorPicker(cp =>
        cp.setValue(this.plugin.settings.milestoneLineLight)
          .onChange(async val => {
            this.plugin.settings.milestoneLineLight = val;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours?.();
          })
      );

    // ===== Dark Mode Colors =====
    const darkColorsSection = containerEl.createEl("details", { cls: "pm-settings-section" });
    const darkColorsSummary = darkColorsSection.createEl("summary", { cls: "pm-settings-summary" });
    darkColorsSummary.createEl("h2", { text: "Dark Mode Colors" });

    new Setting(darkColorsSection)
      .setName("Bar colour – E tasks (dark)")
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings.barColorE_dark)
          .onChange(async (value) => {
            this.plugin.settings.barColorE_dark = value;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours();
          })
      );

    new Setting(darkColorsSection)
      .setName("Bar colour – S tasks (dark)")
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings.barColorS_dark)
          .onChange(async (value) => {
            this.plugin.settings.barColorS_dark = value;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours();
          })
      );

    new Setting(darkColorsSection)
      .setName("Bar colour – SB tasks (dark)")
      .addColorPicker((cp) =>
        cp
          .setValue(this.plugin.settings.barColorSB_dark)
          .onChange(async (value) => {
            this.plugin.settings.barColorSB_dark = value;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours();
          })
    );
    
    new Setting(darkColorsSection)
      .setName("Completed-task bar (dark)")
      .addColorPicker(cp =>
        cp.setValue(this.plugin.settings.completedBarDark)
          .onChange(async (val) => {
            this.plugin.settings.completedBarDark = val;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours?.();
          })
    );

    new Setting(darkColorsSection)
      .setName("Milestone line (dark)")
      .addColorPicker(cp =>
        cp.setValue(this.plugin.settings.milestoneLineDark)
          .onChange(async val => {
            this.plugin.settings.milestoneLineDark = val;
            await this.plugin.saveSettings();
            this.plugin.applyBarColours?.();
          })
      );

    // ===== Ribbon Icon Settings =====
    const ribbonSection = containerEl.createEl("details", { cls: "pm-settings-section" });
    const ribbonSummary = ribbonSection.createEl("summary", { cls: "pm-settings-summary" });
    ribbonSummary.createEl("h2", { text: "Ribbon Icons" });

    new Setting(ribbonSection)
      .setName("Progress ribbon icon")
      .setDesc("Show or hide the Progress view icon in Obsidian’s ribbon.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showProgressRibbon)
         .onChange(async v => {
           this.plugin.settings.showProgressRibbon = v;
           await this.plugin.saveSettings();
           (this.plugin as any).refreshRibbonIcons?.();
         })
      );

    new Setting(ribbonSection)
      .setName("Timeline ribbon icon")
      .setDesc("Show or hide the Timeline icon in the ribbon.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showTimelineRibbon)
         .onChange(async v => {
           this.plugin.settings.showTimelineRibbon = v;
           await this.plugin.saveSettings();
           (this.plugin as any).refreshRibbonIcons?.();
         })
      );

    new Setting(ribbonSection)
      .setName("Task‑Weeks ribbon icon")
      .setDesc("Show or hide the Task view icon in the ribbon.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showTaskRibbon)
         .onChange(async v => {
           this.plugin.settings.showTaskRibbon = v;
           await this.plugin.saveSettings();
           (this.plugin as any).refreshRibbonIcons?.();
         })
      );

    new Setting(ribbonSection)
      .setName("Resources ribbon icon")
      .setDesc("Show or hide the Resources view icon in the ribbon.")
      .addToggle(t =>
        t.setValue(this.plugin.settings.showResourcesRibbon)
         .onChange(async v => {
           this.plugin.settings.showResourcesRibbon = v;
           await this.plugin.saveSettings();
           (this.plugin as any).refreshRibbonIcons?.();
         })
      );



    // ===== Pane Reuse Settings =====
    const paneReuseSection = containerEl.createEl("details", { cls: "pm-settings-section" });
    const paneReuseSummary = paneReuseSection.createEl("summary", { cls: "pm-settings-summary" });
    paneReuseSummary.createEl("h2", { text: "Pane Reuse" });

    const reuseToggles: [keyof PmSettings, string][] = [
      ["reuseProgressPane",  "Reuse Progress pane"],
      ["reuseTimelinePane",   "Reuse Timeline pane"],
      ["reuseTaskWeeksPane",  "Reuse Weekly‑tasks pane"],
      ["reuseResourcesPane",  "Reuse Resources pane"],
    ];

    reuseToggles.forEach(([key, label]) => {
      new Setting(paneReuseSection)
        .setName(label)
        .setDesc("If enabled, clicking a button will update an existing "
               + "pane of this type instead of opening a new split.")
        .addToggle(t =>
          t.setValue((this.plugin.settings as any)[key])
            .onChange(async v => {
              (this.plugin.settings as any)[key] = v;
              await this.plugin.saveSettings();
            })
        );
    });
    
  }
}
