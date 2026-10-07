import type { App } from "obsidian";
import { defineTool, fail, ok } from "./define";
import type { JsonSchema, ToolContext, ToolDef, ToolResult } from "../types";
import { isDesktop } from "../platform";
import { PathError, safeVaultPath } from "./vault/path-safe";

const MAX_OUTPUT_CHARS = 30_000;
const MAX_DIFF_CHARS = 50_000;

interface DirectoryArgs {
	path?: string;
}

interface DiffArgs extends DirectoryArgs {
	staged?: boolean;
	file?: string;
	maxChars?: number;
}

interface LogArgs extends DirectoryArgs {
	limit?: number;
	file?: string;
}

interface StageArgs extends DirectoryArgs {
	files?: string[];
}

interface CommitArgs extends DirectoryArgs {
	message: string;
}

interface BranchArgs extends DirectoryArgs {
	branch: string;
	create?: boolean;
}

interface RemoteOperationArgs extends DirectoryArgs {
	remote?: string;
	branch?: string;
}

interface GitTarget {
	root: string;
	cwd: string;
	relativePath: string;
	repositoryRoot?: string;
}

interface GitResolveFailure {
	code: "UnsupportedCapability" | "VaultPathUnavailable" | "InvalidPath" | "PathNotFound" | "PathNotDirectory" | "PathOutsideVault" | "NotGitRepository" | "RepositoryOutsideVault" | "GitProbeFailed";
	requestedPath: string;
	resolvedPath?: string;
	nextStep: string;
}

interface SpawnedProcess {
	stdout: { on(event: "data", listener: (chunk: unknown) => void): void };
	stderr: { on(event: "data", listener: (chunk: unknown) => void): void };
	on(event: "error", listener: (error: Error) => void): void;
	on(event: "close", listener: (code: number | null) => void): void;
	kill(signal?: string): boolean;
}

type Spawn = (
	command: string,
	args: string[],
	options: { cwd: string; shell: false; windowsHide: boolean },
) => SpawnedProcess;

interface GitRunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	aborted: boolean;
}

export function gitTools(app: App): ToolDef[] {
	return [
		gitStatusTool(app),
		gitDiffTool(app),
		gitLogTool(app),
		gitBranchListTool(app),
		gitRemoteTool(app),
		gitInitTool(app),
		gitStageTool(app),
		gitCommitTool(app),
		gitSwitchTool(app),
		gitPullTool(app),
		gitPushTool(app),
	];
}

function gitStatusTool(app: App): ToolDef<DirectoryArgs> {
	return defineTool({
		name: "git_status",
		description: "Read Git status for a repository at a path relative to the current Obsidian vault. Read-only; use this before Git write operations.",
		category: "vault_read",
		mutates: false,
		schema: directorySchema(),
		async run(args, ctx) {
			return runGitTool(app, args.path, ["status", "--short", "--branch"], ctx);
		},
	});
}

function gitDiffTool(app: App): ToolDef<DiffArgs> {
	return defineTool({
		name: "git_diff",
		description: "Read unstaged or staged Git changes. The path is relative to the current Obsidian vault and file is relative to that path.",
		category: "vault_read",
		mutates: false,
		schema: {
			type: "object",
			properties: {
				path: pathProperty(),
				staged: { type: "boolean", description: "Read the staged index diff instead of the working-tree diff." },
				file: { type: "string", description: "Optional vault-relative file path under path." },
				maxChars: { type: "integer", description: "Maximum diff characters, default 20000.", minimum: 1000, maximum: MAX_DIFF_CHARS },
			},
			required: ["path"],
			additionalProperties: false,
		},
		async run(args, ctx) {
			const file = safeOptionalPath(args.file);
			if (!file.ok) return fail(file.error);
			const command = ["diff", ...(args.staged ? ["--cached"] : []), "--", ...(file.path ? [file.path] : [])];
			return runGitTool(app, args.path, command, ctx, clampOutput(args.maxChars, 20_000));
		},
	});
}

function gitLogTool(app: App): ToolDef<LogArgs> {
	return defineTool({
		name: "git_log",
		description: "Read recent Git commits for a repository inside the current Obsidian vault.",
		category: "vault_read",
		mutates: false,
		schema: {
			type: "object",
			properties: {
				path: pathProperty(),
				limit: { type: "integer", description: "Number of commits, default 20.", minimum: 1, maximum: 100 },
				file: { type: "string", description: "Optional vault-relative file path under path." },
			},
			required: ["path"],
			additionalProperties: false,
		},
		async run(args, ctx) {
			const file = safeOptionalPath(args.file);
			if (!file.ok) return fail(file.error);
			const limit = clampInteger(args.limit, 20, 100);
			return runGitTool(app, args.path, ["log", "--oneline", "--decorate", "-n", String(limit), ...(file.path ? ["--", file.path] : [])], ctx);
		},
	});
}

function gitBranchListTool(app: App): ToolDef<DirectoryArgs> {
	return defineTool({
		name: "git_branches",
		description: "List local and remote Git branches for a repository inside the current Obsidian vault. Read-only.",
		category: "vault_read",
		mutates: false,
		schema: directorySchema(),
		async run(args, ctx) {
			return runGitTool(app, args.path, ["branch", "--all", "--no-color"], ctx);
		},
	});
}

function gitRemoteTool(app: App): ToolDef<DirectoryArgs> {
	return defineTool({
		name: "git_remotes",
		description: "List configured Git remotes for a repository inside the current Obsidian vault. Read-only; credentials in URLs are redacted.",
		category: "vault_read",
		mutates: false,
		schema: directorySchema(),
		async run(args, ctx) {
			return runGitTool(app, args.path, ["remote", "-v"], ctx);
		},
	});
}

function gitInitTool(app: App): ToolDef<DirectoryArgs> {
	return defineTool({
		name: "git_init",
		description: "Create a Git repository in a Vault-relative directory. This only runs on desktop and requires external-write approval.",
		category: "external_write",
		mutates: true,
		schema: directorySchema(),
		async run(args, ctx) {
			return runGitTool(app, args.path, ["init"], ctx);
		},
	});
}

function gitStageTool(app: App): ToolDef<StageArgs> {
	return defineTool({
		name: "git_stage",
		description: "Stage Git changes under a Vault-relative directory. If files is omitted, stage all changes under path. Requires external-write approval.",
		category: "external_write",
		mutates: true,
		schema: {
			type: "object",
			properties: {
				path: pathProperty(),
				files: { type: "array", description: "Optional file paths relative to path.", items: { type: "string", minLength: 1 }, },
			},
			required: ["path"],
			additionalProperties: false,
		},
		async run(args, ctx) {
			const files = safePathList(args.files);
			if (!files.ok) return fail(files.error);
			return runGitTool(app, args.path, ["add", "--all", "--", ...(files.paths.length > 0 ? files.paths : ["."])], ctx);
		},
	});
}

function gitCommitTool(app: App): ToolDef<CommitArgs> {
	return defineTool({
		name: "git_commit",
		description: "Create a Git commit from currently staged changes. Never adds files implicitly. Requires external-write approval.",
		category: "external_write",
		mutates: true,
		schema: {
			type: "object",
			properties: {
				path: pathProperty(),
				message: { type: "string", description: "Commit message.", minLength: 1, maxLength: 5000 },
			},
			required: ["path", "message"],
			additionalProperties: false,
		},
		async run(args, ctx) {
			const message = args.message.trim();
			if (!message) return fail("Git commit message is empty.");
			return runGitTool(app, args.path, ["commit", "-m", message], ctx);
		},
	});
}

function gitSwitchTool(app: App): ToolDef<BranchArgs> {
	return defineTool({
		name: "git_switch",
		description: "Switch Git branches, optionally creating a new branch. Force checkout is intentionally unavailable. Requires external-write approval.",
		category: "external_write",
		mutates: true,
		schema: {
			type: "object",
			properties: {
				path: pathProperty(),
				branch: { type: "string", description: "Git branch name.", minLength: 1, maxLength: 250 },
				create: { type: "boolean", description: "Create the branch before switching to it." },
			},
			required: ["path", "branch"],
			additionalProperties: false,
		},
		async run(args, ctx) {
			const branch = safeGitToken(args.branch, "branch");
			if (!branch.ok) return fail(branch.error);
			return runGitTool(app, args.path, args.create ? ["switch", "--create", branch.value] : ["switch", branch.value], ctx);
		},
	});
}

function gitPullTool(app: App): ToolDef<RemoteOperationArgs> {
	return defineTool({
		name: "git_pull",
		description: "Fetch and fast-forward from a Git remote. Merge/rebase flags are intentionally unavailable. Requires external-write approval.",
		category: "external_write",
		mutates: true,
		schema: remoteOperationSchema(),
		async run(args, ctx) {
			const remote = safeGitToken(args.remote ?? "origin", "remote");
			if (!remote.ok) return fail(remote.error);
			const branch = optionalGitToken(args.branch, "branch");
			if (!branch.ok) return fail(branch.error);
			return runGitTool(app, args.path, ["pull", "--ff-only", remote.value, ...(branch.value ? [branch.value] : [])], ctx);
		},
	});
}

function gitPushTool(app: App): ToolDef<RemoteOperationArgs> {
	return defineTool({
		name: "git_push",
		description: "Push the current or named branch to a Git remote. Force push and arbitrary refspecs are intentionally unavailable. Requires external-write approval.",
		category: "external_write",
		mutates: true,
		schema: remoteOperationSchema(),
		async run(args, ctx) {
			const remote = safeGitToken(args.remote ?? "origin", "remote");
			if (!remote.ok) return fail(remote.error);
			const branch = optionalGitToken(args.branch, "branch");
			if (!branch.ok) return fail(branch.error);
			return runGitTool(app, args.path, ["push", remote.value, ...(branch.value ? [branch.value] : [])], ctx);
		},
	});
}

function directorySchema(): JsonSchema {
	return {
		type: "object",
		properties: { path: pathProperty() },
		required: ["path"],
		additionalProperties: false,
	};
}

function remoteOperationSchema(): JsonSchema {
	return {
		type: "object",
		properties: {
			path: pathProperty(),
			remote: { type: "string", description: "Remote name, default origin.", minLength: 1, maxLength: 250 },
			branch: { type: "string", description: "Optional branch name. Defaults to Git's current upstream behavior.", minLength: 1, maxLength: 250 },
		},
		required: ["path"],
		additionalProperties: false,
	};
}

function pathProperty(): JsonSchema["properties"][string] {
	return { type: "string", description: "Vault-relative repository directory taken from the user's request or prior command result. Use '.' when the active Vault root is explicitly intended; do not substitute another directory.", minLength: 1 };
}

function safeOptionalPath(input: string | undefined): { ok: true; path?: string } | { ok: false; error: string } {
	if (input === undefined || input.trim() === "") return { ok: true };
	if (input.trim() === ".") return { ok: true };
	try {
		return { ok: true, path: safeVaultPath(input) };
	} catch (error) {
		if (error instanceof PathError) return { ok: false, error: `PathError: ${error.message}` };
		throw error;
	}
}

function safePathList(files: string[] | undefined): { ok: true; paths: string[] } | { ok: false; error: string } {
	if (!files) return { ok: true, paths: [] };
	const paths: string[] = [];
	for (const file of files) {
		const checked = safeOptionalPath(file);
		if (!checked.ok) return checked;
		if (checked.path) paths.push(checked.path);
	}
	return { ok: true, paths };
}

function safeGitToken(input: string, label: string): { ok: true; value: string } | { ok: false; error: string } {
	const value = input.trim();
	if (!value) return { ok: false, error: `Git ${label} is empty.` };
	if (
		value.length > 250 ||
		/[\0\r\n\t\s]/.test(value) ||
		value.startsWith("-") ||
		value.includes("..") ||
		value.includes("@{") ||
		/[~^:?*\\[\\]\\\\]/.test(value) ||
		value.startsWith("/") ||
		value.endsWith("/") ||
		value.endsWith(".") ||
		value.endsWith(".lock")
	) {
		return { ok: false, error: `Git ${label} contains invalid characters.` };
	}
	return { ok: true, value };
}

function optionalGitToken(input: string | undefined, label: string): { ok: true; value?: string } | { ok: false; error: string } {
	if (input === undefined || input.trim() === "") return { ok: true };
	return safeGitToken(input, label);
}

async function runGitTool(
	app: App,
	pathInput: string | undefined,
	args: string[],
	ctx: ToolContext,
	maxOutput = MAX_OUTPUT_CHARS,
): Promise<ToolResult> {
	const target = await resolveGitTarget(app, pathInput, args[0] === "init");
	if (!target.ok) return fail(target.error, target.details);
	const result = await runGit(args, target.value.cwd, ctx.signal, maxOutput);
	const output = {
		path: target.value.relativePath,
		repositoryPath: target.value.repositoryRoot,
		command: ["git", ...args],
		stdout: redactGitText(result.stdout),
		stderr: redactGitText(result.stderr),
		truncated: result.stdout.length >= maxOutput || result.stderr.length >= maxOutput,
	};
	if (result.aborted) return fail("Git command was cancelled.", output);
	if (result.code !== 0) return fail(`Git command failed with exit code ${result.code ?? "unknown"}.`, output);
	return ok(output);
}

async function resolveGitTarget(app: App, pathInput: string | undefined, allowInit: boolean): Promise<{ ok: true; value: GitTarget } | { ok: false; error: string; details: GitResolveFailure }> {
	const requestedPath = pathInput?.trim() || ".";
	if (!isDesktop()) {
		return {
			ok: false,
			error: "UnsupportedCapability: Git tools are available only in Obsidian Desktop.",
			details: { code: "UnsupportedCapability", requestedPath, nextStep: "Use a Desktop vault or use Vault commands on Mobile." },
		};
	}
	const adapter = app.vault.adapter as { getBasePath?: () => string };
	const root = adapter.getBasePath?.();
	if (!root) {
		return {
			ok: false,
			error: "UnsupportedCapability: The current Obsidian vault does not expose a desktop filesystem path.",
			details: { code: "VaultPathUnavailable", requestedPath, nextStep: "Use a Desktop vault with a filesystem path." },
		};
	}

	const checked = safeOptionalPath(pathInput);
	if (!checked.ok) {
		return {
			ok: false,
			error: checked.error,
			details: { code: "InvalidPath", requestedPath, nextStep: "Use a Vault-relative directory path." },
		};
	}
	const relativePath = checked.path ?? ".";
	try {
		// Obsidian desktop loads plugin bundles as CommonJS. A native dynamic
		// import("node:path") is treated as a browser module fetch by some
		// Electron/Obsidian versions, which fails with "Failed to fetch
		// dynamically imported module". Resolve Node modules only after the
		// desktop guard through the CommonJS loader; mobile never reaches this
		// code path.
		const path = loadNodeModule<typeof import("node:path")>("node:path");
		const fs = loadNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
		const absoluteRoot = path.resolve(root);
		const cwd = path.resolve(absoluteRoot, relativePath === "." ? "" : relativePath);
		const relativeToRoot = path.relative(absoluteRoot, cwd);
		if (path.isAbsolute(relativeToRoot) || relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`)) {
			return {
				ok: false,
				error: "PathOutsideVault: Git path must stay inside the current Obsidian vault.",
				details: { code: "PathOutsideVault", requestedPath, resolvedPath: relativePath, nextStep: "Use a Vault-relative path." },
			};
		}

		// Resolve the vault and every existing path component through the real
		// filesystem. This blocks a symlink inside the vault from redirecting Git
		// to a repository outside the vault.
		const realRoot = await fs.realpath(absoluteRoot);
		const realCwd = await realPathInsideRoot(fs, path, cwd, realRoot);
		if (!realCwd.ok) {
			return {
				ok: false,
				error: realCwd.code === "PathNotFound"
					? `PathNotFound: Git path '${relativePath}' does not exist in the current vault.`
					: realCwd.code === "PathNotDirectory"
						? `PathNotDirectory: Git target '${relativePath}' is not a directory.`
					: "PathOutsideVault: Git path contains a symlink that resolves outside the current vault.",
				details: {
					code: realCwd.code,
					requestedPath,
					resolvedPath: relativePath,
					nextStep: realCwd.code === "PathNotFound" || realCwd.code === "PathNotDirectory" ? "Inspect Vault paths or ask the user to clarify the directory." : "Use a path that stays inside the vault and does not escape through a symlink.",
				},
			};
		}

		const repository = await runGit(["rev-parse", "--show-toplevel"], realCwd.path, undefined, 4096);
		let repositoryRoot: string | undefined;
		if (repository.code === 0) {
			const repoRoot = await fs.realpath(path.resolve(repository.stdout.trim())).catch(() => "");
			if (!repoRoot) {
				return {
					ok: false,
					error: "GitProbeFailed: Could not resolve the Git repository root.",
					details: { code: "GitProbeFailed", requestedPath, resolvedPath: relativePath, nextStep: "Retry the Git operation after checking the repository." },
				};
			}
			const repoRelative = path.relative(realRoot, repoRoot);
			if (path.isAbsolute(repoRelative) || repoRelative === ".." || repoRelative.startsWith(`..${path.sep}`)) {
				return {
					ok: false,
					error: "RepositoryOutsideVault: Git repository root is outside the current Obsidian vault.",
					details: { code: "RepositoryOutsideVault", requestedPath, resolvedPath: relativePath, nextStep: "Use a repository whose root is inside the current vault." },
				};
			}
			repositoryRoot = repoRelative || ".";
		} else if (!allowInit) {
			if (/not a git repository/i.test(repository.stderr)) {
				return {
					ok: false,
					error: `NotGitRepository: '${relativePath}' is not inside a Git repository.`,
					details: { code: "NotGitRepository", requestedPath, resolvedPath: relativePath, nextStep: "Inspect candidate directories or ask the user which repository they mean." },
				};
			}
			return {
				ok: false,
				error: "GitProbeFailed: Could not verify the Git repository root.",
				details: { code: "GitProbeFailed", requestedPath, resolvedPath: relativePath, nextStep: "Retry the Git operation after checking the local Git installation." },
			};
		}
		return { ok: true, value: { root: realRoot, cwd: realCwd.path, relativePath, repositoryRoot } };
	} catch (error) {
		return {
			ok: false,
			error: `GitProbeFailed: Could not resolve Git path: ${error instanceof Error ? error.message : String(error)}`,
			details: { code: "GitProbeFailed", requestedPath, resolvedPath: relativePath, nextStep: "Retry the operation or ask the user to verify the path." },
		};
	}
}

async function realPathInsideRoot(
	fs: typeof import("node:fs/promises"),
	path: typeof import("node:path"),
	candidate: string,
	realRoot: string,
): Promise<{ ok: true; path: string } | { ok: false; code: "PathNotFound" | "PathNotDirectory" | "PathOutsideVault" }> {
	try {
		const resolved = await fs.realpath(candidate);
		const relative = path.relative(realRoot, resolved);
		if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return { ok: false, code: "PathOutsideVault" };
		if (!(await fs.stat(resolved)).isDirectory()) return { ok: false, code: "PathNotDirectory" };
		return { ok: true, path: resolved };
	} catch {
		return { ok: false, code: "PathNotFound" };
	}
}

async function runGit(args: string[], cwd: string, signal: AbortSignal | undefined, maxOutput: number): Promise<GitRunResult> {
	if (signal?.aborted) return { code: null, stdout: "", stderr: "", aborted: true };
	try {
		const childProcess = loadNodeModule<typeof import("node:child_process")>("node:child_process") as unknown as { spawn: Spawn };
		return await new Promise<GitRunResult>((resolve) => {
			let stdout = "";
			let stderr = "";
			let aborted = false;
			let settled = false;
			const append = (current: string, chunk: unknown): string => {
				if (current.length >= maxOutput) return current;
				const remaining = maxOutput - current.length;
				return current + String(chunk).slice(0, remaining);
			};
			const finish = (result: GitRunResult): void => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", abort);
				resolve(result);
			};
			const abort = (): void => {
				aborted = true;
				child.kill();
			};
			let child: SpawnedProcess;
			try {
				child = childProcess.spawn("git", args, { cwd, shell: false, windowsHide: true });
			} catch (error) {
				finish({ code: null, stdout, stderr: error instanceof Error ? error.message : String(error), aborted: false });
				return;
			}
			child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
			child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
			child.on("error", (error) => finish({ code: null, stdout, stderr: error.message, aborted }));
			child.on("close", (code) => finish({ code, stdout, stderr, aborted }));
			signal?.addEventListener("abort", abort, { once: true });
		});
	} catch (error) {
		return { code: null, stdout: "", stderr: error instanceof Error ? error.message : String(error), aborted: false };
	}
}

function loadNodeModule<T>(moduleName: string): T {
	type NodeRequire = (id: string) => unknown;
	// Obsidian's plugin sandbox commonly exposes CommonJS `require` without
	// exposing the Node `module` object. Keep the direct reference guarded so
	// the same bundle remains safe to load on mobile/browser contexts.
	// eslint-disable-next-line @typescript-eslint/no-var-requires -- guarded CommonJS loading is required for Obsidian Desktop's Node modules.
	const directRequire = typeof require === "function" ? require as unknown as NodeRequire : undefined;
	const moduleRequire = directRequire ?? (
		typeof module !== "undefined" && typeof module.require === "function"
			? module.require.bind(module) as NodeRequire
			: undefined
	);
	if (!moduleRequire) {
		throw new Error("Node.js module loader is unavailable in this environment.");
	}
	return moduleRequire(moduleName) as T;
}

function clampInteger(value: number | undefined, fallback: number, maximum: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(maximum, Math.floor(value ?? fallback)));
}

function clampOutput(value: number | undefined, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(1000, Math.min(MAX_DIFF_CHARS, Math.floor(value ?? fallback)));
}

function redactGitText(text: string): string {
	return text.replace(/(https?:\/\/)([^\s/@:]+)(?::[^\s/@]*)?@/gi, "$1[redacted]@");
}
