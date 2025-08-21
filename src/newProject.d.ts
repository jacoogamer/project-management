import { App, TFolder } from "obsidian";
/**
 * Prompt the user for basic metadata and create a new project note
 * in the “Projects/” folder using the standard layout.
 */
export declare function newProject(app: App, targetFolder?: TFolder): Promise<void>;
