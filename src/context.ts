export interface VaultContext {
	activeFilePath: string | null;
	activeFolderPath: string | null;
	activeFileName: string | null;
}

export const EMPTY_VAULT_CONTEXT: VaultContext = {
	activeFilePath: null,
	activeFolderPath: null,
	activeFileName: null,
};

export function buildVaultContextPrompt(context: VaultContext): string {
	const filePath = context.activeFilePath ?? "(no current Markdown note identified)";
	const folderPath = context.activeFolderPath ?? "(vault root)";
	const fileName = context.activeFileName ?? "(none)";
	return [
		"Authoritative current Obsidian context:",
		`- Current note: ${filePath}`,
		`- Current note name: ${fileName}`,
		`- Current directory: ${folderPath}`,
		"",
		"When the user says current note, current directory, or 当前目录, use these paths.",
		"All vault tool paths must be vault-relative. A new note requested in the current directory must use the current directory path plus the new filename; do not silently use the vault root.",
		"For any request to create, overwrite, edit, append, rename, or delete a vault note, execute the appropriate vault tool before describing the result. Never say that you are creating or editing a file unless you have issued the tool call and received its result.",
	].join("\n");
}

export function requestsVaultMutation(text: string): boolean {
	const mutation = /(创建|新建|写入|生成一份|生成一个|制作一份|建立一份|修改|编辑|追加|删除|重命名|覆盖|create|write|edit|append|delete|rename|overwrite)/i.test(text);
	if (!mutation) return false;
	return !/(如何|怎么|怎样|能否|是否可以|可不可以|how\s+to|can\s+you\s+explain|what\s+is)/i.test(text);
}
