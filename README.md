# Project Management

A comprehensive project management plugin for Obsidian that helps you organize, track, and visualize your projects and tasks across multiple views.

## Features

### 📁 Portfolio View
- **Project Organization**: Group and manage projects within portfolios
- **Project Creation**: Create new projects with templates
- **Filtering**: Filter projects by priority, area, and status
- **Collapsible Sidebar**: Toggle portfolio visibility with chevron controls

### 📊 Progress View
- **Project Overview**: Track completion status and progress across all projects
- **Task Management**: Mark sub-tasks as complete/incomplete with clickable icons
- **Status Tracking**: Visual status badges (On track, Warning, Off track, Completed)
- **Filtering**: Filter by projects, assignees, and task types (Epics, Stories, Sub-tasks)
- **Search**: Real-time task filtering with search input

### 📅 Task Weeks View
- **Weekly Organization**: Group tasks by ISO week for time-based planning
- **Today's Tasks**: Special row highlighting tasks due today
- **Task Completion**: Toggle task completion directly from the view
- **Assignee Management**: Filter tasks by assignee with dropdown controls
- **Overload Warnings**: Visual indicators when weeks have too many tasks

### 📈 Timeline View
- **Gantt Chart**: Visual timeline representation of projects and tasks
- **Dependencies**: Show task dependencies with arrows
- **Milestones**: Display project milestones as diamonds
- **Interactive**: Drag to adjust dates, zoom in/out, scroll through time
- **Heatmap**: Optional heatmap showing task density by day

### 🔧 Resources View
- **Team Management**: Organize tasks by assignee
- **Workload Tracking**: Monitor task distribution and completion rates
- **Status Controls**: Play/pause buttons for task status management
- **Task Type Filtering**: Show/hide Epics, Stories, and Sub-tasks
- **Overload Alerts**: Warnings when assignees have too many tasks

### 📋 Dashboard View
- **Project Overview**: High-level summary of all projects and portfolios
- **Quick Access**: Fast navigation to all project management views
- **Status Summary**: Overview of project completion and task status
- **Recent Activity**: Quick view of recent project changes and updates

### 📅 Today View
- **Daily Focus**: View tasks due on a specific date
- **Date Navigation**: Navigate between different dates with date picker
- **Overdue Tasks**: Filter to show overdue tasks and tasks that should have started
- **Project Filtering**: Filter tasks by specific projects or portfolios
- **Task Viewing**: View task details and status for daily planning

### 📅 Calendar View
- **Monthly Calendar**: Visual calendar interface showing tasks by day
- **Task Indicators**: Color-coded task counts showing workload intensity
- **Day Expansion**: Click on days to see detailed task lists
- **Starting vs Due Tasks**: Separate display of tasks starting and due on each day
- **ISO Week Numbers**: Week numbers displayed for better planning
- **Project & Assignee Filtering**: Filter tasks by projects and assignees
- **Monday Start**: Calendar starts on Monday for better work week planning
- **Month Navigation**: Navigate between months with previous/next buttons

## Installation

### From Obsidian
1. Open **Settings** → **Community plugins**
2. Turn off **Safe mode**
3. Click **Browse** and search for "Project Management"
4. Click **Install**
5. After installation, close the community plugins window and activate the newly installed plugin

### Using BRAT (Beta Reviewer Auto-updater Tool)
1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) in Obsidian
2. Open **Settings** → **Community plugins** → **BRAT**
3. Add this repository: `https://github.com/jacoogamer/project-management`
4. The plugin will appear in your Community Plugins list
5. Install and enable the plugin

### From GitHub
1. Download the latest release from the [releases page](../../releases)
2. Extract the plugin folder from the zip to your vault's plugins folder: `<vault>/.obsidian/plugins/`
3. Reload Obsidian
4. If prompted about Safe Mode, you can disable safe mode and enable the plugin
5. Head to Settings → Community plugins and make sure the plugin is enabled

## Getting Started

### 1. Create Your First Portfolio
Start by opening the Portfolio view and creating a portfolio to organize your projects:

1. Open the command palette (`Ctrl/Cmd + P`)
2. Search for "Project Management: Open Projects" and select it, or use the ribbon icon in the left sidebar
3. Use the "+" button to create your first portfolio
4. Your portfolio will serve as a container for related projects
5. You can use the description textarea to add a brief description of the portfolio

### 2. Create Projects Using the Button
Once you have a portfolio set up, create projects using the built-in project creation feature:

1. In the Portfolio view, click the **"Create Project"** button
2. The plugin will ask you where to create the project file
3. This will create a new project note with the proper front matter structure (you can override this with a custom template in settings)
4. The project will automatically include the required `project: true` flag (this flag name can be customized in settings)
5. Edit the generated project note to add your specific details

```yaml
---
project: true
description: "Your project description"
start-date: 2024-01-01
end-date: 2024-12-31
priority: high
area: development
---
```

### 3. Add Tasks to Your Project File
In the generated project note, add tasks using the Epic (E-), Story (S-), and Sub-task (SB-) format. You can delete the default tasks and add your own. Tasks are currently based on Obsidian's native task format (markdown checkboxes), and task support may be expanded in future versions.

### 4. Enhance Tasks with Properties in Your Project File
Add inline properties directly to tasks in your project note for better tracking, such as assignee, due dates, and start dates. These properties are parsed from the task text and integrated into the project management views

## Configuration

### Settings
Access plugin settings through **Settings** → **Community plugins** → **Project Management**

**General Settings:**
- **Project Flag Property**: Customize the front matter key for identifying projects (default: "project")
- **Task Overload Thresholds**: Set limits for weekly and resource overload warnings

**View-Specific Settings:**
- **Timeline**: Colors, bar heights, dependency arrows, heatmap options
- **Progress**: Row colors, status badge colors
- **Resources**: Overload thresholds, status indicators

**Theme Settings:**
- **Light Mode**: Customize colors for light theme
- **Dark Mode**: Customize colors for dark theme

### Task Types
The plugin recognizes three main task types:

- **Epics (E-*)**: High-level features or initiatives
- **Stories (S-*)**: User stories or features within epics
- **Sub-tasks (SB-*)**: Specific implementation tasks

### Status System
Tasks can have the following statuses:
- `[ ]` - Not started
- `[/]` - In progress
- `[-]` - On hold
- `[x]` - Completed

## Usage Guide

### 📁 Portfolio View - Project Organization Hub

**Purpose**: Central hub for organizing and managing your project portfolio.

**Key Features**:
- **Portfolio Description**: Define the scope and purpose of your portfolio at the top
- **Project List**: View all projects with their key details (description, dates, priority, area)
- **Create Projects**: Use the "Create Project" button to create new projects with proper structure. This will create a new project note in the selected folder.
- **Collapsible Sidebar**: Toggle portfolio visibility with the chevron icon
- **Action Icons**: Quick access to open projects, view progress, timeline, weekly planning, and resources

**Best Practices**:
- Start here to create your project structure
- Use the description to define portfolio scope
- Create projects using the built-in button for proper setup
- Use the action icons to quickly navigate to other views

### 📊 Progress View - High-Level Project Tracking

**Purpose**: Monitor overall project progress and completion status.

**Key Features**:
- **Project Overview**: See all projects with completion percentages and status
- **Task Management**: Click check icons to mark sub-tasks complete/incomplete
- **Status Badges**: Visual indicators (On track, Warning, Off track, Completed)
- **Filtering**: Filter by projects, assignees, and task types (Epics, Stories, Sub-tasks)
- **Search**: Real-time task filtering with search input
- **Task Completion**: Interactive check/circle icons for sub-tasks

**Best Practices**:
- Use for executive-level project status reviews
- Filter by specific projects or assignees for focused views
- Use the search to quickly find specific tasks
- Toggle task type visibility to focus on relevant work items

### 📅 Task Weeks View - Time-Based Planning

**Purpose**: Organize and plan tasks by week for time-sensitive project management.

**Key Features**:
- **Weekly Organization**: Tasks grouped by ISO week numbers
- **Today's Row**: Special highlighting for tasks due today (always visible)
- **Task Completion**: Toggle completion directly from the view
- **Assignee Filtering**: Filter tasks by assignee with dropdown controls
- **Overload Warnings**: Visual indicators when weeks have too many tasks
- **Global Toggle**: Expand/collapse all weeks with the top chevron

**Best Practices**:
- Use for sprint planning and weekly task allocation
- Check the "Today" row daily for immediate priorities
- Use assignee filters to focus on individual workloads
- Monitor overload warnings to balance work distribution
- Use the global toggle to quickly overview all weeks

### 📈 Timeline View - Visual Project Planning

**Purpose**: Visual timeline representation for project scheduling and dependencies.

**Key Features**:
- **Gantt Chart**: Visual timeline with project bars and task details
- **Dependencies**: Show task dependencies with interactive arrows
- **Milestones**: Display project milestones as diamonds (toggle visibility)
- **Interactive Controls**: Drag to adjust dates, zoom in/out, scroll through time
- **Heatmap**: Optional heatmap showing task density by day (subtasks only)
- **Project Tooltips**: Hover over bars to see project details
- **Start Date Mode**: Toggle to view tasks sorted chronologically by start date
- **Action Item Creation**: Create new tasks directly from Portfolio and Timeline views
- **Enhanced Tooltips**: Rich tooltips with project context, descriptions, and assignee info
- **Completed Task Styling**: Visual indicators for completed tasks with check icons and green bars
- **Proper Indentation**: Hierarchical indentation for Epics, Stories, and Sub-tasks

**Start Date Mode Features**:
- **Chronological Sorting**: View all tasks across projects sorted by start date
- **Project Context**: Project information shown in tooltips instead of header rows
- **Hierarchical Indentation**: Tasks indented based on type (Epics: 0px, Stories: 12px, Sub-tasks: 24px)
- **Consistent Styling**: Same visual styling as normal mode with proper bullet points and check icons
- **Heatmap Support**: Task density heatmap showing subtask workload by day
- **Tooltip Toggle**: Show/hide bar tooltips with toggle button
- **Drag Functionality**: Drag and resize bars even in start date mode

**Action Item Creation**:
- **Quick Task Creation**: Create new Epics, Stories, or Sub-tasks from Portfolio and Timeline views
- **Smart Dropdowns**: Project selection with alphabetical sorting
- **Assignee Management**: Select from existing assignees with alphabetical sorting
- **Dependency Tracking**: Link tasks to existing tasks within the same project
- **Proper Formatting**: Automatically generates correctly formatted task entries with checkboxes and properties

**Best Practices**:
- Set start and end dates in project front matter for accurate timelines
- Use dependencies to show task relationships and critical paths
- Add milestones for important deadlines and checkpoints
- Use the heatmap to identify busy periods and resource conflicts
- Zoom and scroll to focus on specific time periods
- Use start date mode for weekly planning and chronological task review
- Create action items directly from views for quick task addition
- Use tooltips to get detailed task information without opening files

### 🔧 Resources View - Team Management

**Purpose**: Manage team workloads and track task distribution across assignees.

**Key Features**:
- **Team Overview**: Organize tasks by assignee with completion statistics
- **Workload Tracking**: Monitor task distribution and completion rates
- **Status Controls**: Play/pause buttons for task status management
- **Task Type Filtering**: Show/hide Epics, Stories, and Sub-tasks
- **Overload Alerts**: Warnings when assignees have too many tasks
- **Project Filtering**: Filter by specific projects or portfolios

**Best Practices**:
- Use for team capacity planning and workload balancing
- Monitor overload alerts to prevent burnout
- Use task type toggles to focus on actionable work items
- Filter by projects to focus on specific initiatives
- Use status controls to quickly update task progress

### 📋 Dashboard View - Project Overview Hub

**Purpose**: Central dashboard providing high-level overview and quick access to all project management features.

**Key Features**:
- **Project Summary**: Overview of all projects with completion status
- **Portfolio Overview**: Summary of portfolios and their contained projects
- **Quick Navigation**: Direct access to all project management views
- **Status Overview**: Visual indicators of project health and progress
- **Recent Activity**: Summary of recent changes and updates

**Best Practices**:
- Use as your main entry point to project management
- Check project status at a glance before diving into specific views
- Use quick navigation to jump between different management perspectives
- Monitor overall portfolio health and project distribution

### 📅 Today View - Daily Task Management

**Purpose**: Focus on daily task management with date-specific filtering and task completion.

**Key Features**:
- **Date Selection**: Choose any date to view tasks due on that day
- **Overdue Filter**: Show tasks that are overdue or should have started
- **Project Filtering**: Filter tasks by specific projects or portfolios
- **Task Viewing**: View task details, status, and assignments
- **Date Navigation**: Easy navigation between different dates

**Best Practices**:
- Use for daily standups and task planning
- Check overdue tasks to identify blockers and priorities
- Use project filters to focus on specific initiatives
- Navigate between dates to plan ahead or review past work
- Use the view to identify what needs to be done today

### 📅 Calendar View - Monthly Task Planning

**Purpose**: Visual monthly calendar interface for comprehensive task planning and workload management.

**Key Features**:
- **Monthly Overview**: Visual calendar showing all days with task indicators
- **Task Count Indicators**: Color-coded numbers showing task workload intensity
- **Day Details**: Click on any day to see detailed task lists with project and assignee information
- **Starting vs Due Tasks**: Separate display of tasks starting and due on each day
- **ISO Week Numbers**: Week numbers displayed for better planning and coordination
- **Project & Assignee Filtering**: Filter tasks by specific projects and assignees
- **Monday Start**: Calendar starts on Monday for better work week planning
- **Month Navigation**: Navigate between months with previous/next buttons
- **Today Highlighting**: Current day is highlighted for easy identification

**Best Practices**:
- Use for monthly planning and capacity management
- Monitor task density with color-coded indicators
- Use day expansion to review detailed task lists
- Filter by projects to focus on specific initiatives
- Use assignee filters to check individual workloads
- Navigate between months to plan ahead or review past work
- Use ISO week numbers for better team coordination

### General Workflow Tips

**Project Organization**:
1. **Start with portfolios**: Create portfolios first to define project scope and context
2. **Use the Create Project button**: Always create projects through the Portfolio view for proper setup
3. **Set consistent naming conventions** for tasks (E-1, S-1, SB-1)
4. **Use the assignee property** to track ownership
5. **Set due dates** for time-sensitive tasks

**Task Management**:
1. Start with Epics, break them down into Stories, then Sub-tasks
2. Use the Progress view for high-level project tracking
3. Use Task Weeks for time-based planning
4. Use Resources view for team management

**Timeline Planning**:
1. Set start and end dates in project front matter
2. Use dependencies to link related tasks
3. Add milestones for important deadlines
4. Use the heatmap to identify busy periods

## Commands

The plugin provides several commands that can be accessed through the Command Palette (`Ctrl/Cmd + P`)

### View Commands
| Command | Description |
|---------|-------------|
| "Open Project Management" | Opens the Portfolio view |
| "Open Project Dashboard" | Opens the Dashboard view |
| "Open Project Progress" | Opens the Progress view |
| "Open Project Timeline" | Opens the Timeline view |
| "Open Weekly Task View" | Opens the Task Weeks view |
| "Open Today View" | Opens the Today view |
| "Open Calendar View" | Opens the Calendar view |
| "Open Resources View" | Opens the Resources view |

### Project Management Commands
| Command | Description |
|---------|-------------|
| "Create New Project Note" | Creates a new project with proper structure |
| "Create New Action Item" | Creates a new task (Epic, Story, or Sub-task) with interactive form |
| "Re‑index Project/Task Cache" | Manually refreshes the project cache |

### Ribbon Icons
The plugin also provides ribbon icons in the left sidebar for quick access to views:
- **Portfolio** (layers icon): Always visible
- **Progress** (bar-chart-2 icon): Toggle in settings
- **Timeline** (calendar-clock icon): Toggle in settings  
- **Task Weeks** (calendar-check icon): Toggle in settings
- **Calendar** (calendar icon): Toggle in settings
- **Resources** (users icon): Toggle in settings

> **Note**: Dashboard and Today views are accessible through the command palette or from within other views.

## Troubleshooting

### Common Issues

**Projects not appearing:**
- Ensure project notes have `project: true` in front matter
- Check that the project flag property matches your setting

**Tasks not showing:**
- Verify task format follows the expected pattern
- Check that tasks are properly nested under projects

**Timeline not displaying:**
- Ensure projects have start-date and end-date in front matter
- Check date format (YYYY-MM-DD)

**Performance issues:**
- Consider reducing the number of visible projects
- Use filters to focus on specific subsets

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

- **Issues**: Report bugs on GitHub Issues
- **Feature Requests**: Use GitHub Issues with the "enhancement" label
- **Documentation**: Check the wiki for detailed guides

## License

This project is licensed under the MIT License. See LICENSE file for details

## Changelog

### Latest Version
- **Start Date Mode**: New timeline view mode for chronological task sorting
- **Action Item Creation**: Interactive form to create new tasks from Portfolio and Timeline views
- **Enhanced Tooltips**: Rich tooltips with project context, descriptions, and assignee information
- **Completed Task Styling**: Visual indicators for completed tasks with check icons and green bars
- **Improved Bullet Styling**: Proper indentation and styling for task bullets in start date mode
- **Tooltip Toggle**: Show/hide bar tooltips with toggle button in timeline view
- **Heatmap Improvements**: Heatmap now only counts subtasks for accurate work density
- **Project Grouping**: Removed project headers in start date mode for cleaner chronological view
- **Drag Functionality**: Full drag and resize support in start date mode
- **Task Hierarchy**: Proper grouping of stories under epics and subtasks under stories
- **Ellipsis Truncation**: Dynamic text truncation that responds to available width
- **Icon Tooltip Fixes**: Proper cleanup of icon tooltips to prevent lingering popups

### Previous Versions
- Added Calendar view with monthly task planning interface
- Added task filter input to Progress view
- Improved dark mode styling for project rows
- Fixed weekly top toggle functionality
- Removed clickable links from week headers
- Enhanced Epic/Story/Sub-task visibility controls

---

Made with ❤️ for the Obsidian community
