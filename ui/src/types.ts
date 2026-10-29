// The shapes the host forwards over the `warmup:crud` bridge.
//
// `ScheduledJob` mirrors the desktop client `apps/desktop/src/lib/api/schedules.ts`
// (the camelCase form `fetchJobs` maps Core's snake_case wire into), extended
// with the two fields this app added to the scheduler kernel: the schedule's
// IANA `tz` and the job's `ownerApp`. `WarmupAgent` is assembled host-side from
// `GET /api/agents`, `GET /api/agents/:id/usage` and `GET /api/agents/:id/acp-config`;
// `WarmupProvider` from `GET /api/pi-config/catalog` and each saved account's
// `GET /api/pi-config/providers/:id/accounts/:account_id/usage`.

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

/**
 * A ping pinned to one saved login of a provider pool. The host projects these
 * jobs' `target` as an agent row (as it does every non-workflow target) and
 * carries the real target here.
 */
export interface ProviderAccountTarget {
	accountId: string;
	model: string;
	prompt: string;
	providerId: string;
}

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
	/** Set when the job pings one provider account. */
	providerAccount?: ProviderAccountTarget | null;
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

/** One saved login of a provider, with its own usage windows. */
export interface WarmupAccount {
	/** False when the login reports no readable window right now. */
	available: boolean;
	id: string;
	label: string;
	/** Core blocked this login until the user signs in again. */
	needsReauth: boolean;
	plan: string | null;
	reason: string | null;
	windows: UsageWindow[];
}

/**
 * A subscription provider holding one or more saved logins. Each login has its
 * own rolling window, so each is warmed (and pinged) separately.
 */
export interface WarmupProvider {
	accounts: WarmupAccount[];
	id: string;
	/** Models the provider offers; a provider ping always pins one. */
	models: ModelOption[];
	name: string;
}

/** What the host reports when the page loads. */
export interface WarmupDetection {
	agents: WarmupAgent[];
	providers: WarmupProvider[];
	/** The node's own IANA zone, used when no job has recorded one yet. */
	tz: string;
}

/** A job to create, as `warmup.apply` accepts it. */
export interface WarmupJobInput {
	name: string;
	ownerApp: string;
	schedule: Schedule;
	target:
		| Extract<JobTarget, { type: "agent" }>
		| ({ type: "provider_account" } & ProviderAccountTarget);
}
