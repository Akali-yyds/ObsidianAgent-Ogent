import { stringifyYaml } from "obsidian";
import { diffLines, type DiffRow } from "./diff";

const MAX_VISIBLE_ROWS = 200;

export function renderEditDiff(parent: HTMLElement, before: string, after: string): void {
	const rows = diffLines(before, after);
	renderRows(parent, rows);
}

export function renderWriteDiff(
	parent: HTMLElement,
	beforeFm: Record<string, unknown> | null,
	afterFm: Record<string, unknown> | null,
	beforeBody: string,
	afterBody: string,
): void {
	if (beforeFm || afterFm) {
		const fmSection = parent.createDiv({ cls: "ai-agent-diff-section" });
		fmSection.createEl("div", { cls: "ai-agent-diff-label", text: "Frontmatter" });
		const beforeYaml = beforeFm ? stringifyYaml(beforeFm).trim() : "(none)";
		const afterYaml = afterFm ? stringifyYaml(afterFm).trim() : "(none)";
		const fmRows = diffLines(beforeYaml, afterYaml);
		renderRows(fmSection, fmRows);
	}
	const bodySection = parent.createDiv({ cls: "ai-agent-diff-section" });
	bodySection.createEl("div", { cls: "ai-agent-diff-label", text: "Body" });
	renderRows(bodySection, diffLines(beforeBody, afterBody));
}

export function renderAppendDiff(parent: HTMLElement, existing: string, appended: string): void {
	const trailing = existing.split("\n").slice(-5).join("\n");
	if (trailing.length > 0) {
		const ctxEl = parent.createDiv({ cls: "ai-agent-diff-section" });
		ctxEl.createEl("div", { cls: "ai-agent-diff-label", text: "Existing (last 5 lines)" });
		const ctxBody = ctxEl.createDiv({ cls: "ai-agent-diff-context-body" });
		ctxBody.setText(trailing);
	}
	const addEl = parent.createDiv({ cls: "ai-agent-diff-section" });
	addEl.createEl("div", { cls: "ai-agent-diff-label", text: "Appended" });
	const addBody = addEl.createDiv({ cls: "ai-agent-diff-add-block" });
	addBody.setText(appended);
}

function renderRows(parent: HTMLElement, rows: DiffRow[]): void {
	const table = parent.createDiv({ cls: "ai-agent-diff-table" });
	const visible = rows.length > MAX_VISIBLE_ROWS ? rows.slice(0, MAX_VISIBLE_ROWS) : rows;
	for (const r of visible) {
		const row = table.createDiv({ cls: `ai-agent-diff-row ai-agent-diff-${r.kind}` });
		row.createEl("span", {
			cls: "ai-agent-diff-marker",
			text: r.kind === "add" ? "+" : r.kind === "remove" ? "−" : " ",
		});
		row.createEl("span", { cls: "ai-agent-diff-text", text: r.text });
	}
	if (rows.length > MAX_VISIBLE_ROWS) {
		const more = parent.createEl("button", {
			cls: "ai-agent-diff-more",
			text: `Show ${rows.length - MAX_VISIBLE_ROWS} more rows`,
		});
		more.addEventListener("click", () => {
			more.remove();
			for (const r of rows.slice(MAX_VISIBLE_ROWS)) {
				const row = table.createDiv({ cls: `ai-agent-diff-row ai-agent-diff-${r.kind}` });
				row.createEl("span", {
					cls: "ai-agent-diff-marker",
					text: r.kind === "add" ? "+" : r.kind === "remove" ? "−" : " ",
				});
				row.createEl("span", { cls: "ai-agent-diff-text", text: r.text });
			}
		});
	}
}
