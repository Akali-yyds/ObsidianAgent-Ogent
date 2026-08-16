import type { App } from "obsidian";
import type { UndoBuffer } from "../../consent/undo";
import type { ToolDef } from "../../types";
import { appendTool } from "./append";
import { editTool } from "./edit";
import { linksTool } from "./links";
import { listTool } from "./list";
import { metadataTool } from "./metadata";
import { readTool } from "./read";
import { searchTool } from "./search";
import { writeTool } from "./write";
import { deleteTool, moveTool, renameTool, restoreTool } from "./path-ops";

export interface VaultToolDeps {
	undo: UndoBuffer;
}

export function vaultTools(app: App, deps: VaultToolDeps): ToolDef[] {
	return [
		listTool(app),
		readTool(app),
		searchTool(app),
		metadataTool(app),
		linksTool(app),
		writeTool(app, deps.undo),
		appendTool(app, deps.undo),
		editTool(app, deps.undo),
		renameTool(app, deps.undo),
		moveTool(app, deps.undo),
		deleteTool(app, deps.undo),
		restoreTool(app, deps.undo),
	];
}
