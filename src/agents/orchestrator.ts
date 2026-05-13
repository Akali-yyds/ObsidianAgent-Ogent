import { runStructuredStep } from "./structured-output";
import type { PipelineEvent, PipelineResult, PipelineStep, PipelineStructuredStep, PipelineTaskStep } from "./types";

export interface RunPipelineOptions<TContext> {
	initialContext: TContext;
	steps: PipelineStep<TContext>[];
	onEvent?: (event: PipelineEvent) => void | Promise<void>;
}

export async function runPipeline<TContext>(opts: RunPipelineOptions<TContext>): Promise<PipelineResult<TContext>> {
	const helpers = {};
	let context = opts.initialContext;

	for (const step of opts.steps) {
		await opts.onEvent?.({ kind: "step", stepId: step.id, label: step.label, state: "pending" });
	}

	for (const step of opts.steps) {
		await opts.onEvent?.({ kind: "step", stepId: step.id, label: step.label, state: "running" });
		try {
			if (step.kind === "structured") {
				const structuredStep = step as PipelineStructuredStep<TContext, unknown>;
				const request = await structuredStep.prepare(context, helpers);
				const result = await runStructuredStep({
					...request,
					onRetry: async (failure) => {
						await opts.onEvent?.({
							kind: "structured_retry",
							stepId: structuredStep.id,
							label: structuredStep.label,
							attempt: failure.attempt + 1,
							maxAttempts: 1,
							reason: failure.reason,
						});
					},
				});
				if (!result.ok) {
					await opts.onEvent?.({
						kind: "step",
						stepId: structuredStep.id,
						label: structuredStep.label,
						state: "failed",
						message: result.reason,
					});
					return { ok: false, context, failedStepId: structuredStep.id, error: result };
				}
				context = await structuredStep.apply(context, result.value);
			} else {
				const taskStep = step as PipelineTaskStep<TContext, unknown>;
				const output = await taskStep.run(context, helpers);
				context = await taskStep.apply(context, output);
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
