// Turning the warmup configuration into scheduler jobs, and reading it back.
//
// There is no separate settings store: the jobs ARE the configuration. Every
// field the UI needs — which agents, which model, which times, which zone, what
// the ping says — is already carried by the `JobTarget::Agent` + `Schedule::Cron`
// pair Core persists, so the page reconstructs its state by reading the jobs it
// owns. That removes the class of bug where a saved config and the jobs it was
// supposed to produce disagree.
//
// Core has no update route for jobs, so applying a change is delete-then-create
// over the app's own jobs. The cost is the per-job run history; the benefit is
// that "what is scheduled" has exactly one representation.

import type { ScheduledJob, WarmupJobInput } from "../types.ts";
import { cronForTime, normalizeTimes, timeFromCron } from "./windows.ts";

/** The manifest id recorded as each job's owner (see `ScheduledJob.ownerApp`). */
export const WARMUP_APP_ID = "com.ryu.warmup";

/** What the ping says. Short on purpose — the reply is irrelevant, the window is the point. */
export const DEFAULT_PROMPT = "hi";

/** One agent's warmup configuration. */
export interface WarmupEntry {
	agentId: string;
	agentName: string;
	/** Model to pin the ping to; `null` runs the agent's configured model. */
	model: string | null;
	/** Local `"HH:MM"` times this agent is pinged at. */
	times: string[];
}

/** The whole configuration the page edits and applies. */
export interface WarmupPlan {
	entries: WarmupEntry[];
	prompt: string;
	/** IANA zone the times are read in (`"Europe/Lisbon"`). */
	tz: string;
}

/** Jobs this app owns, out of every job on the node. */
export function ownedJobs(jobs: readonly ScheduledJob[]): ScheduledJob[] {
	return jobs.filter((job) => job.ownerApp === WARMUP_APP_ID);
}

/**
 * The job name. Human-readable because it is what the Calendar app and the
 * sidebar show; it is NOT parsed to recover configuration (the target and
 * schedule are), so renaming it breaks nothing.
 */
export function jobName(entry: WarmupEntry, time: string): string {
	return `Warmup: ${entry.agentName} at ${time}`;
}

/** The create-job bodies a plan expands to — one per agent per time. */
export function jobsForPlan(plan: WarmupPlan): WarmupJobInput[] {
	const inputs: WarmupJobInput[] = [];
	for (const entry of plan.entries) {
		for (const time of normalizeTimes(entry.times)) {
			inputs.push({
				name: jobName(entry, time),
				schedule: { kind: "cron", expr: cronForTime(time), tz: plan.tz },
				target: {
					type: "agent",
					agentId: entry.agentId,
					prompt: plan.prompt,
					model: entry.model,
				},
				ownerApp: WARMUP_APP_ID,
			});
		}
	}
	return inputs;
}

/**
 * Rebuild the plan from the jobs on the node — the inverse of
 * {@link jobsForPlan}.
 *
 * `agentNames` supplies display names, since a job records the agent id. Jobs
 * that are not daily agent crons are skipped rather than guessed at: they were
 * not written by this app's UI, and inventing a representation for them would
 * mean the next save silently rewrote them.
 */
export function planFromJobs(
	jobs: readonly ScheduledJob[],
	agentNames: ReadonlyMap<string, string>,
	fallbackTz: string
): WarmupPlan {
	const byAgent = new Map<string, WarmupEntry>();
	let prompt = DEFAULT_PROMPT;
	let tz = "";

	for (const job of ownedJobs(jobs)) {
		if (job.schedule.kind !== "cron" || job.target.type !== "agent") {
			continue;
		}
		const time = timeFromCron(job.schedule.expr);
		if (!time) {
			continue;
		}
		tz = tz || job.schedule.tz || "";
		prompt = job.target.prompt || prompt;
		const existing = byAgent.get(job.target.agentId);
		if (existing) {
			existing.times.push(time);
			// A per-agent model is one value; the first job wins, and a
			// disagreement is collapsed on the next save rather than surfaced —
			// the UI cannot express two models for one agent.
			existing.model = existing.model ?? job.target.model ?? null;
		} else {
			byAgent.set(job.target.agentId, {
				agentId: job.target.agentId,
				agentName: agentNames.get(job.target.agentId) ?? job.target.agentId,
				model: job.target.model ?? null,
				times: [time],
			});
		}
	}

	return {
		prompt,
		tz: tz || fallbackTz,
		entries: [...byAgent.values()].map((entry) => ({
			...entry,
			times: normalizeTimes(entry.times),
		})),
	};
}

/** True when the plan schedules nothing (no agent selected, or no times). */
export function isEmptyPlan(plan: WarmupPlan): boolean {
	return jobsForPlan(plan).length === 0;
}
