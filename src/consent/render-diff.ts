import { stringifyYaml } from "obsidian";
import { diffLines, trimDiffContext, type DiffRow } from "./diff";

const MAX_VISIBLE_ROWS = 200;
const CONTEXT_LINES = 3;

export function renderEditDiff(parent: HTMLElement, before: string, after: string): void {
	renderRows(parent, diffLines(before, after));
}

export function renderWriteDiff(
	parent: HTMLElement,
	beforeFm: Record<string, unknown> | null,
	afterFm: Record<string, unknown> | null,
	beforeBody: string,
	afterBody: string,
): void {
	if (beforeFm || afterFm) {
		const fmSection = parent.createDiv({ cls: "open-agent-diff-section" });
		fmSection.createEl("div", { cls: "open-agent-diff-label", text: "Frontmatter" });
		const beforeYaml = beforeFm ? stringifyYaml(beforeFm).trim() : "(none)";
		const afterYaml = afterFm ? stringifyYaml(afterFm).trim() : "(none)";
		const fmRows = diffLines(beforeYaml, afterYaml);
		renderRows(fmSection, fmRows);
	}
	const bodySection = parent.createDiv({ cls: "open-agent-diff-section" });
	bodySection.createEl("div", { cls: "open-agent-diff-label", text: "Body" });
	renderRows(bodySection, diffLines(beforeBody, afterBody));
}

export function renderAppendDiff(parent: HTMLElement, existing: string, appended: string): void {
	const trailing = existing.split("\n").slice(-5).join("\n");
	if (trailing.length > 0) {
		const ctxEl = parent.createDiv({ cls: "open-agent-diff-section" });
		ctxEl.createEl("div", { cls: "open-agent-diff-label", text: "Existing (last 5 lines)" });
		const ctxBody = ctxEl.createDiv({ cls: "open-agent-diff-context-body" });
		ctxBody.setText(trailing);
	}
	const addEl = parent.createDiv({ cls: "open-agent-diff-section" });
	addEl.createEl("div", { cls: "open-agent-diff-label", text: "Appended" });
	const addBody = addEl.createDiv({ cls: "open-agent-diff-add-block" });
	addBody.setText(appended);
}

export function renderRows(parent: HTMLElement, rows: DiffRow[]): void {
	const trimmed = trimDiffContext(rows, CONTEXT_LINES);
	const table = parent.createDiv({ cls: "open-agent-diff-table" });
	const visible = trimmed.length > MAX_VISIBLE_ROWS ? trimmed.slice(0, MAX_VISIBLE_ROWS) : trimmed;
	for (const r of visible) {
		if (r.kind === "separator") {
			table.createDiv({ cls: "open-agent-diff-separator", text: "⋮" });
			continue;
		}
		const row = table.createDiv({ cls: `open-agent-diff-row open-agent-diff-${r.kind}` });
		row.createEl("span", {
			cls: "open-agent-diff-marker",
			text: r.kind === "add" ? "+" : r.kind === "remove" ? "−" : " ",
		});
		row.createEl("span", { cls: "open-agent-diff-text", text: r.text });
	}
	if (trimmed.length > MAX_VISIBLE_ROWS) {
		const more = parent.createEl("button", {
			cls: "open-agent-diff-more",
			text: `Show ${trimmed.length - MAX_VISIBLE_ROWS} more rows`,
		});
		more.addEventListener("click", () => {
			more.remove();
			for (const r of trimmed.slice(MAX_VISIBLE_ROWS)) {
				if (r.kind === "separator") { table.createDiv({ cls: "open-agent-diff-separator", text: "⋮" }); continue; }
				const row = table.createDiv({ cls: `open-agent-diff-row open-agent-diff-${r.kind}` });
				row.createEl("span", { cls: "open-agent-diff-marker", text: r.kind === "add" ? "+" : r.kind === "remove" ? "−" : " " });
				row.createEl("span", { cls: "open-agent-diff-text", text: r.text });
			}
		});
	}
}
