import { beforeEach, vi } from "vitest";

export class MockTFile {
	path: string;
	basename: string;
	extension: string;

	constructor(path: string) {
		this.path = path;
		const parts = path.split("/");
		const fileName = parts[parts.length - 1] ?? path;
		const match = fileName.match(/^(.*?)(?:\.([^.]+))?$/);
		this.basename = match?.[1] ?? fileName;
		this.extension = match?.[2] ?? "md";
	}
}

export interface MockFileCache {
	tags?: Array<{ tag: string }>;
	frontmatter?: { tags?: string | string[] };
}

export interface MockAdapter {
	exists: ReturnType<typeof vi.fn>;
	mkdir: ReturnType<typeof vi.fn>;
	list: ReturnType<typeof vi.fn>;
	read: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
	rename: ReturnType<typeof vi.fn>;
}

export interface MockVaultState {
	files: Map<string, string>;
	fileCaches: Map<string, MockFileCache>;
	resolvedLinks: Record<string, Record<string, number>>;
}

export function createMockAdapter(initialFiles: Record<string, string> = {}): MockAdapter {
	const files = new Map(Object.entries(initialFiles));
	const hasPath = (path: string) =>
		files.has(path) || [...files.keys()].some((file) => file.startsWith(path.endsWith("/") ? path : `${path}/`));
	return {
		exists: vi.fn(async (path: string) => hasPath(path)),
		mkdir: vi.fn(async () => undefined),
		list: vi.fn(async (dir: string) => ({
			files: [...files.keys()].filter((file) => file.startsWith(`${dir}/`)).sort(),
		})),
		read: vi.fn(async (path: string) => {
			if (!files.has(path)) throw new Error(`Missing file: ${path}`);
			return files.get(path);
		}),
		write: vi.fn(async (path: string, text: string) => {
			files.set(path, text);
		}),
		remove: vi.fn(async (path: string) => {
			files.delete(path);
		}),
		rename: vi.fn(async (from: string, to: string) => {
			if (!files.has(from)) throw new Error(`Missing file: ${from}`);
			files.set(to, files.get(from) ?? "");
			files.delete(from);
		}),
	};
}

export function createMockApp(options?: {
	files?: Record<string, string>;
	fileCaches?: Record<string, MockFileCache>;
	resolvedLinks?: Record<string, Record<string, number>>;
}) {
	const fileMap = new Map(Object.entries(options?.files ?? {}));
	const fileCaches = new Map(Object.entries(options?.fileCaches ?? {}));
	const resolvedLinks = options?.resolvedLinks ?? {};
	const markdownFiles = () => [...fileMap.keys()].filter((path) => path.endsWith(".md")).map((path) => new MockTFile(path));

	return {
		vault: {
			adapter: createMockAdapter(options?.files),
			getMarkdownFiles: vi.fn(() => markdownFiles()),
			getAbstractFileByPath: vi.fn((path: string) => (fileMap.has(path) ? new MockTFile(path) : null)),
			cachedRead: vi.fn(async (file: { path: string }) => {
				if (!fileMap.has(file.path)) throw new Error(`Missing file: ${file.path}`);
				return fileMap.get(file.path) ?? "";
			}),
		},
		metadataCache: {
			resolvedLinks,
			getFirstLinkpathDest: vi.fn((linkpath: string) => {
				const direct = [...fileMap.keys()].find((path) => path === linkpath || path === `${linkpath}.md` || path.endsWith(`/${linkpath}.md`));
				return direct ? new MockTFile(direct) : null;
			}),
			getFileCache: vi.fn((file: { path: string }) => fileCaches.get(file.path) ?? null),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
		},
	};
}

export const requestUrlMock = vi.fn(async () => ({ status: 200, json: { data: [] } }));

export const NoticeMock = vi.fn(function Notice(this: { message: string }, message: string) {
	this.message = message;
});

export const Platform = {
	isMobileApp: false,
	isDesktopApp: true,
	isMobile: false,
};

vi.mock("obsidian", () => ({
	Platform,
	Plugin: class Plugin {},
	Notice: NoticeMock,
	TFile: MockTFile,
	WorkspaceLeaf: class WorkspaceLeaf {},
	requestUrl: requestUrlMock,
}));

export function setMobileMode(isMobile: boolean): void {
	Platform.isMobileApp = isMobile;
	Platform.isDesktopApp = !isMobile;
	Platform.isMobile = isMobile;
}

beforeEach(() => {
	setMobileMode(false);
	requestUrlMock.mockClear();
	NoticeMock.mockClear();
});
