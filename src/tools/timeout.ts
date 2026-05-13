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
	const timerHost = typeof window !== "undefined" ? window : globalThis;
	let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
	let abortHandler: (() => void) | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = timerHost.setTimeout(() => reject(new ToolTimeoutError(toolName, ms)), ms);
		if (signal) {
			abortHandler = () => {
				if (timer !== undefined) timerHost.clearTimeout(timer);
				reject(new DOMException("Aborted", "AbortError"));
			};
			if (signal.aborted) abortHandler();
			else signal.addEventListener("abort", abortHandler, { once: true });
		}
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer !== undefined) timerHost.clearTimeout(timer);
		if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
	}
}
