import { type App, Modal, TFile } from "obsidian";
import type { ToolDef } from "../types";
import { splitFrontmatter, mergeFrontmatter, stitchFrontmatter } from "../tools/vault/frontmatter";
import { renderAppendDiff, renderEditDiff, renderWriteDiff } from "./render-diff";

export type ConsentChoice = "approve" | "reject" | "approve-session";

interface VaultEditArgs {
	path: string;
	oldString: string;
	newString: string;
}
interface VaultAppendArgs {
	path: string;
	content: string;
	ensureNewline?: boolean;
}
interface VaultWriteArgs {
	path: string;
	body: string;
	frontmatter?: Record<string, unknown>;
}

export class ConsentModal extends Modal {
	private resolve: (choice: ConsentChoice) => void = () => undefined;
	private decided = false;

	constructor(
		app: App,
		private readonly tool: ToolDef,
		private readonly args: unknown,
	) {
		super(app);
	}

	open(): void {
		super.open();
	}

	prompt(): Promise<ConsentChoice> {
		return new Promise<ConsentChoice>((res) => {
			this.resolve = res;
		});
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("open-agent-consent-modal");

		contentEl.createEl("h3", { text: "Approve tool action?" });
		const meta = contentEl.createDiv({ cls: "open-agent-consent-meta" });
		meta.createEl("div", { text: `Tool: ${this.tool.name}` });
		meta.createEl("div", { text: `Category: ${this.tool.category}` });

		const diffEl = contentEl.createDiv({ cls: "open-agent-consent-diff" });
		await this.renderDiff(diffEl);

		const buttons = contentEl.createDiv({ cls: "open-agent-consent-buttons" });
		const reject = buttons.createEl("button", { text: "Reject" });
		reject.addEventListener("click", () => this.decide("reject"));
		const session = buttons.createEl("button", { text: "Approve all this session" });
		session.addEventListener("click", () => this.decide("approve-session"));
		const approve = buttons.createEl("button", { text: "Approve", cls: "mod-cta" });
		approve.addEventListener("click", () => this.decide("approve"));
	}

	onClose(): void {
		// If closed without an explicit decision, treat as reject.
		if (!this.decided) this.resolve("reject");
		this.contentEl.empty();
	}

	private decide(choice: ConsentChoice): void {
		this.decided = true;
		this.resolve(choice);
		this.close();
	}

	rejectExternally(): void {
		if (!this.decided) {
			this.decided = true;
			this.resolve("reject");
			this.close();
		}
	}

	private async renderDiff(parent: HTMLElement): Promise<void> {
		try {
			if (this.tool.name === "vault_edit") {
				const a = this.args as VaultEditArgs;
				const file = this.app.vault.getAbstractFileByPath(a.path);
				const before = file instanceof TFile ? await this.app.vault.read(file) : "";
				const after = before.split(a.oldString).join(a.newString);
				renderEditDiff(parent, before, after);
				return;
			}
			if (this.tool.name === "vault_append") {
				const a = this.args as VaultAppendArgs;
				const file = this.app.vault.getAbstractFileByPath(a.path);
				const existing = file instanceof TFile ? await this.app.vault.read(file) : "";
				const sep = (a.ensureNewline ?? true) && existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
				renderAppendDiff(parent, existing, sep + a.content);
				return;
			}
			if (this.tool.name === "vault_write") {
				const a = this.args as VaultWriteArgs;
				const file = this.app.vault.getAbstractFileByPath(a.path);
				let beforeFm: Record<string, unknown> | null = null;
				let beforeBody = "";
				if (file instanceof TFile) {
					const raw = await this.app.vault.read(file);
					const split = splitFrontmatter(raw);
					beforeFm = split.frontmatter;
					beforeBody = split.body;
				}
				const afterFm = a.frontmatter ? mergeFrontmatter(beforeFm ?? {}, a.frontmatter) : beforeFm;
				renderWriteDiff(parent, beforeFm, afterFm, beforeBody, a.body);
				const _stitched = stitchFrontmatter(afterFm, a.body);
				void _stitched;
				return;
			}
			parent.createEl("pre", { text: JSON.stringify(this.args, null, 2) });
		} catch (e) {
			parent.createEl("div", { text: `Could not render diff: ${e instanceof Error ? e.message : String(e)}` });
		}
	}
}
