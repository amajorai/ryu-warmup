import { describe, expect, it } from "bun:test";
import type { ScheduledJob } from "../types.ts";
import {
	DEFAULT_PROMPT,
	isEmptyPlan,
	jobsForPlan,
	ownedJobs,
	planFromJobs,
	WARMUP_APP_ID,
	type WarmupPlan,
} from "./plan.ts";
import { DEFAULT_TIMES } from "./windows.ts";

const TZ = "Europe/Lisbon";

function plan(overrides: Partial<WarmupPlan> = {}): WarmupPlan {
	return {
		prompt: DEFAULT_PROMPT,
		tz: TZ,
		entries: [
			{
				agentId: "claude-code",
				agentName: "Claude Code",
				model: "claude-haiku-4-5",
				times: [...DEFAULT_TIMES],
			},
		],
		...overrides,
	};
}

function job(overrides: Partial<ScheduledJob>): ScheduledJob {
	return {
		createdAt: "2026-07-31T00:00:00Z",
		enabled: true,
		history: [],
		id: "job_1",
		lastOutcome: null,
		lastRunAt: null,
		name: "Warmup: Claude Code at 05:00",
		ownerApp: WARMUP_APP_ID,
		requireApproval: false,
		schedule: { kind: "cron", expr: "0 5 * * *", tz: TZ },
		target: {
			type: "agent",
			agentId: "claude-code",
			prompt: "hi",
			model: "claude-haiku-4-5",
		},
		updatedAt: "2026-07-31T00:00:00Z",
		...overrides,
	};
}

describe("jobsForPlan", () => {
	it("expands to one job per agent per time, all owned by this app", () => {
		const jobs = jobsForPlan(plan());
		expect(jobs).toHaveLength(DEFAULT_TIMES.length);
		expect(jobs.every((j) => j.ownerApp === WARMUP_APP_ID)).toBe(true);
	});

	it("carries the zone and the pinned model onto every job", () => {
		const [first] = jobsForPlan(plan());
		expect(first.schedule).toEqual({ kind: "cron", expr: "0 5 * * *", tz: TZ });
		expect(first.target).toEqual({
			type: "agent",
			agentId: "claude-code",
			prompt: "hi",
			model: "claude-haiku-4-5",
		});
	});

	it("normalizes the times, so a duplicate never becomes a duplicate job", () => {
		const jobs = jobsForPlan(
			plan({
				entries: [
					{
						agentId: "a",
						agentName: "A",
						model: null,
						times: ["05:00", "5:00", "10:00"],
					},
				],
			})
		);
		expect(jobs.map((j) => j.schedule)).toEqual([
			{ kind: "cron", expr: "0 5 * * *", tz: TZ },
			{ kind: "cron", expr: "0 10 * * *", tz: TZ },
		]);
	});

	it("schedules nothing for an agent with no times", () => {
		expect(
			jobsForPlan(
				plan({
					entries: [{ agentId: "a", agentName: "A", model: null, times: [] }],
				})
			)
		).toEqual([]);
	});
});

describe("ownedJobs", () => {
	it("takes only this app's jobs, never Core's or another app's", () => {
		const mine = job({ id: "mine" });
		const core = job({ id: "core", ownerApp: null });
		const other = job({ id: "other", ownerApp: "@ryu/monitors" });
		expect(ownedJobs([mine, core, other]).map((j) => j.id)).toEqual(["mine"]);
	});
});

describe("planFromJobs", () => {
	const names = new Map([["claude-code", "Claude Code"]]);

	it("round-trips a plan through the jobs it produced", () => {
		const original = plan();
		const jobs = jobsForPlan(original).map((input, i) =>
			job({
				id: `job_${i}`,
				name: input.name,
				ownerApp: input.ownerApp,
				schedule: input.schedule,
				target: input.target,
			})
		);
		expect(planFromJobs(jobs, names, "UTC")).toEqual(original);
	});

	it("round-trips two agents without either one's model or prompt bleeding", () => {
		// The single-agent round-trip cannot catch a per-agent field being read
		// from the wrong entry, and `planFromJobs` folds `prompt` across every
		// job — so this pins that each agent keeps its own model.
		const original: WarmupPlan = {
			prompt: "hi",
			tz: TZ,
			entries: [
				{
					agentId: "claude-code",
					agentName: "Claude Code",
					model: "claude-haiku-4-5",
					times: ["05:00", "10:00"],
				},
				{
					agentId: "codex",
					agentName: "Codex",
					model: "gpt-5-codex-low",
					times: ["05:00", "10:00"],
				},
			],
		};
		const jobs = jobsForPlan(original).map((input, i) =>
			job({
				id: `job_${i}`,
				name: input.name,
				ownerApp: input.ownerApp,
				schedule: input.schedule,
				target: input.target,
			})
		);
		const twoNames = new Map([
			["claude-code", "Claude Code"],
			["codex", "Codex"],
		]);
		expect(planFromJobs(jobs, twoNames, "UTC")).toEqual(original);
	});

	it("ignores jobs this app does not own", () => {
		const foreign = job({ id: "f", ownerApp: null });
		expect(planFromJobs([foreign], names, "UTC").entries).toEqual([]);
	});

	it("skips a cron it cannot represent as a time, rather than guessing", () => {
		// A hand-edited every-5-minutes job must not be silently rewritten to
		// some nearby time on the next save.
		const odd = job({
			schedule: { kind: "cron", expr: "*/5 * * * *", tz: TZ },
		});
		expect(planFromJobs([odd], names, "UTC").entries).toEqual([]);
	});

	it("falls back to the node zone when no job recorded one", () => {
		const zoneless = job({ schedule: { kind: "cron", expr: "0 5 * * *" } });
		expect(planFromJobs([zoneless], names, "America/New_York").tz).toBe(
			"America/New_York"
		);
	});

	it("labels an agent by id when its display name is unknown", () => {
		expect(planFromJobs([job({})], new Map(), "UTC").entries[0].agentName).toBe(
			"claude-code"
		);
	});

	it("groups every time for one agent into a single entry", () => {
		const five = job({
			id: "a",
			schedule: { kind: "cron", expr: "0 5 * * *", tz: TZ },
		});
		const ten = job({
			id: "b",
			schedule: { kind: "cron", expr: "0 10 * * *", tz: TZ },
		});
		const entries = planFromJobs([ten, five], names, "UTC").entries;
		expect(entries).toHaveLength(1);
		expect(entries[0].times).toEqual(["05:00", "10:00"]);
	});
});

describe("isEmptyPlan", () => {
	it("is true when nothing would be scheduled", () => {
		expect(isEmptyPlan(plan({ entries: [] }))).toBe(true);
		expect(
			isEmptyPlan(
				plan({
					entries: [{ agentId: "a", agentName: "A", model: null, times: [] }],
				})
			)
		).toBe(true);
		expect(isEmptyPlan(plan())).toBe(false);
	});
});
