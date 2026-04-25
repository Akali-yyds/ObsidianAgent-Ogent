export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export class ToolTimeoutError extends Error {
	constructor(toolName: string, ms: number) {
		super(`Tool '${toolName}' exceeded ${ms}ms timeout`);
		this.name = "ToolTimeoutError";
	}
}

export async function runWithTimeout<T>(
	promise: Promise<T>,
	ms: number,
	toolName: string,
	signal?: AbortSignal,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new ToolTimeoutError(toolName, ms)), ms);
		if (signal) {
			const abortHandler = () => {
				if (timer) clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			};
			if (signal.aborted) abortHandler();
			else signal.addEventListener("abort", abortHandler, { once: true });
		}
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
