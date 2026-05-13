import { runStructuredStep } from "./structured-output";
import type { PipelineEvent, PipelineHelpers, PipelineResult, PipelineStep } from "./types";

export interface RunPipelineOptions<TContext> {
	initialContext: TContext;
	steps: PipelineStep<TContext>[];
	onEvent?: (event: PipelineEvent) => void | Promise<void>;
}

export async function runPipeline<TContext>(opts: RunPipelineOptions<TContext>): Promise<PipelineResult<TContext>> {
	const helpers: PipelineHelpers = {};
	let context = opts.initialContext;

	for (const step of opts.steps) {
		await opts.onEvent?.({ kind: "step", stepId: step.id, label: step.label, state: "pending" });
	}

	for (const step of opts.steps) {
		await opts.onEvent?.({ kind: "step", stepId: step.id, label: step.label, state: "running" });
		try {
			if (step.kind === "structured") {
				const request = await step.prepare(context, helpers);
				const result = await runStructuredStep({
					...request,
					onRetry: async (failure) => {
						await opts.onEvent?.({
							kind: "structured_retry",
							stepId: step.id,
							label: step.label,
							attempt: failure.attempt + 1,
							maxAttempts: 1,
							reason: failure.reason,
						});
					},
				});
				if (!result.ok) {
					await opts.onEvent?.({
						kind: "step",
						stepId: step.id,
						label: step.label,
						state: "failed",
						message: result.reason,
					});
					return { ok: false, context, failedStepId: step.id, error: result };
				}
				context = await step.apply(context, result.value);
			} else {
				const output = await step.run(context, helpers);
				context = await step.apply(context, output);
			}
			await opts.onEvent?.({ kind: "step", stepId: step.id, label: step.label, state: "complete" });
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			await opts.onEvent?.({
				kind: "step",
				stepId: step.id,
				label: step.label,
				state: "failed",
				message: err.message,
			});
			return { ok: false, context, failedStepId: step.id, error: err };
		}
	}

	return { ok: true, context };
}
