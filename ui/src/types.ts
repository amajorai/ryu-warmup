// The shapes the host forwards over the `warmup:crud` bridge.
//
// `ScheduledJob` mirrors the desktop client `apps/desktop/src/lib/api/schedules.ts`
// (the camelCase form `fetchJobs` maps Core's snake_case wire into), extended
// with the two fields this app added to the scheduler kernel: the schedule's
// IANA `tz` and the job's `ownerApp`. `WarmupAgent` is assembled host-side from
// `GET /api/agents`, `GET /api/agents/:id/usage` and `GET /api/agents/:id/acp-config`.

import type { ModelOption } from "./lib/cheapest.ts";

export type { ModelOption };

/** How a job is scheduled. `tz` reads a cron in that IANA zone instead of UTC. */
export type Schedule =
	| { kind: "cron"; expr: string; tz?: string | null }
	| { kind: "every"; interval: string };

/** What a job runs. `model` pins the turn's model without changing the agent. */
export type JobTarget =
	| { type: "workflow"; workflowId: string; input?: Record<string, string> }
	| {
			type: "agent";
			agentId: string;
			prompt: string;
			model?: string | null;
	  };

/** Outcome of a single recorded job execution. */
export type ExecOutcome = "success" | "failure";

/** One recorded execution of a job (newest last in {@link ScheduledJob.history}). */
export interface ExecRecord {
	error: string | null;
	finishedAt: string;
	outcome: ExecOutcome;
	runId: string | null;
	startedAt: string;
}

/** A persisted scheduled job as Core returns it. */
export interface ScheduledJob {
	createdAt: string;
	enabled: boolean;
	history: ExecRecord[];
	id: string;
	lastOutcome: ExecOutcome | null;
	lastRunAt: string | null;
	name: string;
	/** Manifest id of the App that created the job, when one did. */
	ownerApp: string | null;
	requireApproval: boolean;
	schedule: Schedule;
	target: JobTarget;
	updatedAt: string;
}

/** One rolling rate-limit window an agent reports (`GET /api/agents/:id/usage`). */
export interface UsageWindow {
	label: string;
	resetsAt: string | null;
	usedPercent: number;
	/** The window's own length, when the vendor reports it — 5h, 7d, … */
	windowSeconds: number | null;
}

/**
 * A subscription agent the host detected, with everything needed to schedule a
 * warmup for it: whether its usage is actually readable right now, the windows
 * it reports, and the models it advertises.
 */
export interface WarmupAgent {
	/** False when the agent reports no readable window (not logged in, no plan…). */
	available: boolean;
	id: string;
	/** Models the agent advertises; empty when it exposes no model picker. */
	models: ModelOption[];
	name: string;
	plan: string | null;
	/** Core's `UsageReason` when `available` is false — why there is no window. */
	reason: string | null;
	windows: UsageWindow[];
}

/** What the host reports when the page loads. */
export interface WarmupDetection {
	agents: WarmupAgent[];
	/** The node's own IANA zone, used when no job has recorded one yet. */
	tz: string;
}

/** A job to create, as `warmup.apply` accepts it. */
export interface WarmupJobInput {
	name: string;
	ownerApp: string;
	schedule: Schedule;
	target: JobTarget;
}
