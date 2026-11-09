import { z } from "zod";
import type { ScheduledJob, WarmupDetection } from "./types.ts";

const scheduleSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("cron"),
		expr: z.string(),
		tz: z.string().nullable().optional(),
	}),
	z.object({ kind: z.literal("every"), interval: z.string() }),
]);
const targetSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("workflow"),
		workflowId: z.string(),
		input: z.record(z.string(), z.string()).optional(),
	}),
	z.object({
		type: z.literal("agent"),
		agentId: z.string(),
		prompt: z.string(),
		model: z.string().nullable().optional(),
	}),
]);
const outcomeSchema = z.enum(["success", "failure"]);
export const scheduledJobsSchema: z.ZodType<ScheduledJob[]> = z.array(
	z.object({
		createdAt: z.string(),
		enabled: z.boolean(),
		history: z.array(
			z.object({
				error: z.string().nullable(),
				finishedAt: z.string(),
				outcome: outcomeSchema,
				runId: z.string().nullable(),
				startedAt: z.string(),
			})
		),
		id: z.string(),
		lastOutcome: outcomeSchema.nullable(),
		lastRunAt: z.string().nullable(),
		name: z.string(),
		ownerApp: z.string().nullable(),
		providerAccount: z
			.object({
				accountId: z.string(),
				model: z.string(),
				prompt: z.string(),
				providerId: z.string(),
			})
			.nullable()
			.optional(),
		requireApproval: z.boolean(),
		schedule: scheduleSchema,
		target: targetSchema,
		updatedAt: z.string(),
	})
);
const usageWindowSchema = z.object({
	label: z.string(),
	resetsAt: z.string().nullable(),
	usedPercent: z.number(),
	windowSeconds: z.number().nullable(),
});
const modelOptionSchema = z.object({
	description: z.string().nullable().optional(),
	modelId: z.string(),
	name: z.string(),
});
export const warmupDetectionSchema: z.ZodType<WarmupDetection> = z.object({
	agents: z.array(
		z.object({
			available: z.boolean(),
			id: z.string(),
			models: z.array(modelOptionSchema),
			name: z.string(),
			plan: z.string().nullable(),
			reason: z.string().nullable(),
			windows: z.array(usageWindowSchema),
		})
	),
	// Absent from a host that predates per-account warmups.
	providers: z
		.array(
			z.object({
				accounts: z.array(
					z.object({
						available: z.boolean(),
						id: z.string(),
						label: z.string(),
						needsReauth: z.boolean(),
						plan: z.string().nullable(),
						reason: z.string().nullable(),
						windows: z.array(usageWindowSchema),
					})
				),
				id: z.string(),
				models: z.array(modelOptionSchema),
				name: z.string(),
			})
		)
		.default(() => []),
	tz: z.string(),
});
export const persistedWarmupJobsSchema = z.object({
	jobs: scheduledJobsSchema.optional(),
});
