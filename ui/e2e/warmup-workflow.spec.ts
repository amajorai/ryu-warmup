import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import { persistedWarmupJobsSchema } from "../src/schemas.ts";
import type {
	ScheduledJob,
	WarmupDetection,
	WarmupJobInput,
} from "../src/types.ts";

const MODELS = [
	{ modelId: "claude-opus-4", name: "Opus 4" },
	{ modelId: "claude-haiku-4-5", name: "Haiku 4.5" },
];

const DETECTION: WarmupDetection = {
	agents: [
		{
			available: true,
			id: "agent-claude",
			models: MODELS,
			name: "Claude",
			plan: "Pro",
			reason: null,
			windows: [
				{
					label: "5-hour window",
					resetsAt: "2026-09-28T15:00:00.000Z",
					usedPercent: 18,
					windowSeconds: 18_000,
				},
			],
		},
	],
	tz: "America/Los_Angeles",
};

const OTHER_JOB: ScheduledJob = {
	createdAt: "2026-09-01T00:00:00.000Z",
	enabled: true,
	history: [],
	id: "manual-job",
	lastOutcome: null,
	lastRunAt: null,
	name: "Other app schedule",
	ownerApp: null,
	requireApproval: false,
	schedule: { kind: "cron", expr: "0 9 * * *", tz: "America/Los_Angeles" },
	target: {
		type: "agent",
		agentId: "agent-other",
		prompt: "status",
		model: null,
	},
	updatedAt: "2026-09-01T00:00:00.000Z",
};

const CATALOG: RyuCatalogSnapshot = {
	agents: [],
	apiTypes: [],
	current: {
		provider: "gateway",
		providerRouting: {},
		routing: "gateway",
	},
	hookEvents: [],
	hooks: [],
	plugins: [],
	providers: [],
	thinkingLevels: [],
	version: 1,
};

const SUBSCRIPTION_CATALOG: RyuCatalogSnapshot = {
	...CATALOG,
	providers: [
		{
			active: true,
			api: "anthropic",
			authKind: "subscription",
			configured: true,
			id: "claude-subscription",
			label: "Claude subscription",
			suggestedModels: ["claude-haiku-4-5", "claude-opus-4"],
		},
	],
};

interface BridgeCall {
	args?: { available?: boolean; jobId?: string; providerId?: string };
	jobs?: WarmupJobInput[];
	method: string;
}

interface FixtureState {
	calls: BridgeCall[];
	detectionAvailable: boolean;
	initiallyUnavailable: boolean;
}

type FailureFlags = Partial<Record<"apply" | "runNow", number>>;

interface FixtureOptions {
	catalog?: RyuCatalogSnapshot;
	detectionInitiallyUnavailable?: boolean;
	failures?: FailureFlags;
	jobs?: ScheduledJob[];
}

declare global {
	interface Window {
		__parseWarmupJobs(raw: string): Promise<ScheduledJob[] | null>;
		__warmupTestState?: FixtureState;
	}
}

async function installBridge(page: Page, options: FixtureOptions = {}) {
	await page.exposeFunction(
		"__parseWarmupJobs",
		(raw: string) =>
			persistedWarmupJobsSchema.parse(JSON.parse(raw)).jobs ?? null
	);
	await page.addInitScript(
		(seed: {
			catalog: RyuCatalogSnapshot;
			detection: WarmupDetection;
			detectionInitiallyUnavailable: boolean;
			failures: FailureFlags;
			jobs: ScheduledJob[];
			storageKey: string;
			timestamp: string;
		}) => {
			const seededKey = `${seed.storageKey}.seeded`;
			if (sessionStorage.getItem(seededKey) !== "1") {
				localStorage.removeItem(seed.storageKey);
				sessionStorage.setItem(seededKey, "1");
			}
			const readJobs = async (): Promise<ScheduledJob[]> => {
				try {
					const raw = localStorage.getItem(seed.storageKey);
					const saved = raw ? await window.__parseWarmupJobs(raw) : null;
					return saved ?? structuredClone(seed.jobs);
				} catch {
					return structuredClone(seed.jobs);
				}
			};
			const saveJobs = (jobs: ScheduledJob[]) => {
				localStorage.setItem(seed.storageKey, JSON.stringify({ jobs }));
			};
			const state: FixtureState = {
				calls: [],
				detectionAvailable: !seed.detectionInitiallyUnavailable,
				initiallyUnavailable: seed.detectionInitiallyUnavailable,
			};
			const failures = { ...seed.failures };
			const failOnce = (method: keyof FailureFlags) => {
				const remaining = failures[method] ?? 0;
				if (remaining > 0) {
					failures[method] = remaining - 1;
					throw new Error(`Fixture ${method} failed once; retry is safe.`);
				}
			};
			const bridge = {
				catalog: {
					models: async ({ providerId }: { providerId: string }) => {
						state.calls.push({
							args: { providerId },
							method: "catalog.models",
						});
						return { models: [] };
					},
					snapshot: async () => {
						state.calls.push({ method: "catalog.snapshot" });
						return seed.catalog;
					},
				},
				warmup: {
					apply: async (jobs: WarmupJobInput[]) => {
						state.calls.push({ jobs: structuredClone(jobs), method: "apply" });
						failOnce("apply");
						const otherJobs = (await readJobs()).filter(
							(job) => job.ownerApp !== "@ryu/warmup"
						);
						const scheduled: ScheduledJob[] = jobs.map((job, index) => ({
							...structuredClone(job),
							createdAt: seed.timestamp,
							enabled: true,
							history: [],
							id: `warmup-job-${index + 1}`,
							lastOutcome: null,
							lastRunAt: null,
							requireApproval: false,
							updatedAt: seed.timestamp,
						}));
						saveJobs([...otherJobs, ...scheduled]);
					},
					detect: async () => {
						state.calls.push({
							args: { available: state.detectionAvailable },
							method: "detect",
						});
						if (!state.detectionAvailable) {
							throw new Error(
								"Fixture subscription provider is temporarily unavailable."
							);
						}
						return seed.detection;
					},
					list: async () => {
						state.calls.push({ method: "list" });
						return readJobs();
					},
					runNow: async ({ jobId }: { jobId: string }) => {
						state.calls.push({ args: { jobId }, method: "runNow" });
						failOnce("runNow");
						const nextJobs = (await readJobs()).map((job) =>
							job.id === jobId
								? {
										...job,
										lastOutcome: "success" as const,
										lastRunAt: seed.timestamp,
									}
								: job
						);
						saveJobs(nextJobs);
					},
				},
			};
			Object.assign(window, {
				__warmupTestState: state,
				ryu: { catalog: bridge.catalog, context: null, warmup: bridge.warmup },
			});
		},
		{
			catalog: options.catalog ?? CATALOG,
			detection: DETECTION,
			detectionInitiallyUnavailable:
				options.detectionInitiallyUnavailable ?? false,
			failures: options.failures ?? {},
			jobs: options.jobs ?? [OTHER_JOB],
			storageKey: "ryu.warmup.test-state.v1",
			timestamp: "2026-09-28T09:00:00.000Z",
		}
	);
}

async function callsFor(page: Page): Promise<BridgeCall[]> {
	return page.evaluate(() => {
		const current = window;
		return current.__warmupTestState?.calls ?? [];
	});
}

async function screenshotPath(
	testInfo: { outputPath(name: string): string },
	name: string
): Promise<string> {
	const configured = process.env.RYU_APPS_STORE_PROOF_DIR;
	const destination = configured
		? path.join(configured, name)
		: testInfo.outputPath(name);
	await mkdir(path.dirname(destination), { recursive: true });
	return destination;
}

test("detects a local usage failure and recovers through Try again", async ({
	page,
}) => {
	await installBridge(page, { detectionInitiallyUnavailable: true });
	await page.goto("/");
	const fixtureState = await page.evaluate(() => {
		const current = window;
		return current.__warmupTestState;
	});
	expect(fixtureState?.initiallyUnavailable).toBe(true);
	expect(fixtureState?.detectionAvailable).toBe(false);
	await expect(
		page.getByText("We couldn’t read your subscriptions", { exact: true })
	).toBeVisible();
	const callsBeforeRetry = (await callsFor(page)).filter(
		(call) => call.method === "detect"
	).length;
	await page.evaluate(() => {
		const current = window;
		if (current.__warmupTestState) {
			current.__warmupTestState.detectionAvailable = true;
		}
	});
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByRole("heading", { name: "Warmup" })).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Warm up Claude" })
	).toBeVisible();
	const callsAfterRetry = (await callsFor(page)).filter(
		(call) => call.method === "detect"
	);
	expect(callsAfterRetry).toHaveLength(callsBeforeRetry + 1);
});

test("uses the agent’s advertised models when no shared subscription lane exists", async ({
	page,
}) => {
	await installBridge(page, { catalog: CATALOG, jobs: [] });
	await page.goto("/");
	await page.getByRole("switch", { name: "Warm up Claude" }).click();
	await page.getByLabel("Ping model").selectOption("claude-opus-4");
	await page.getByRole("button", { name: "Save schedule" }).click();
	await expect(page.getByText("Scheduled 4 pings a day.")).toBeVisible();
	const applyCall = (await callsFor(page)).find(
		(call) => call.method === "apply"
	);
	expect(applyCall?.jobs).toHaveLength(4);
	for (const job of applyCall?.jobs ?? []) {
		expect(job).toMatchObject({
			ownerApp: "@ryu/warmup",
			target: {
				agentId: "agent-claude",
				model: "claude-opus-4",
				prompt: "hi",
				type: "agent",
			},
		});
	}
});

test("saves the exact schedule, restores it, and retries a failed manual run", async ({
	page,
}, testInfo) => {
	await installBridge(page, {
		catalog: SUBSCRIPTION_CATALOG,
		failures: { apply: 1, runNow: 1 },
		jobs: [OTHER_JOB],
	});
	await page.goto("/");
	await expect(
		page.getByText("Times are read in America/Los_Angeles")
	).toBeVisible();
	await page.getByRole("switch", { name: "Warm up Claude" }).click();
	const pingModelPicker = page.getByRole("combobox", {
		name: "Choose the ping model for Claude",
	});
	await pingModelPicker.click();
	await page.getByRole("option", { name: /claude-opus-4/ }).click();
	await expect(pingModelPicker).toContainText("claude-opus-4");
	await page.getByRole("button", { name: "Remove 10:00" }).click();
	await expect(
		page.getByRole("button", { name: "Use 4 evenly spaced" })
	).toBeVisible();
	await page.getByRole("button", { name: "Use 4 evenly spaced" }).click();
	for (const time of ["10:00", "15:00", "20:00"]) {
		await page.getByRole("button", { name: `Remove ${time}` }).click();
	}
	await page.getByLabel("Add a ping time").fill("25:99");
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(page.getByText("'25:99' is not a time of day")).toBeVisible();
	await page.getByLabel("Add a ping time").fill("07:30");
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await page.getByLabel("Add a ping time").fill("09:00");
	await page.getByLabel("Add a ping time").press("Enter");
	await expect(
		page.getByRole("button", { name: "Remove 09:00" })
	).toBeVisible();
	await page.getByRole("button", { name: "Remove 09:00" }).click();
	await page.getByLabel("Ping message").fill("hello");
	await page.getByRole("button", { name: "Save schedule" }).click();
	await expect(
		page.getByText("Fixture apply failed once; retry is safe.")
	).toBeVisible();
	await expect(page.getByLabel("Ping message")).toHaveValue("hello");
	await page.getByRole("button", { name: "Save schedule" }).click();
	await expect(page.getByText("Scheduled 2 pings a day.")).toBeVisible();
	await expect(page.getByText("Other app schedule")).toBeHidden();
	const writes = (await callsFor(page)).filter(
		(call) => call.method === "apply"
	);
	const expectedJobs: WarmupJobInput[] = [
		{
			name: "Warmup: Claude at 05:00",
			ownerApp: "@ryu/warmup",
			schedule: { kind: "cron", expr: "0 5 * * *", tz: "America/Los_Angeles" },
			target: {
				type: "agent",
				agentId: "agent-claude",
				prompt: "hello",
				model: "claude-opus-4",
			},
		},
		{
			name: "Warmup: Claude at 07:30",
			ownerApp: "@ryu/warmup",
			schedule: { kind: "cron", expr: "30 7 * * *", tz: "America/Los_Angeles" },
			target: {
				type: "agent",
				agentId: "agent-claude",
				prompt: "hello",
				model: "claude-opus-4",
			},
		},
	];
	expect(writes).toEqual([
		{ jobs: expectedJobs, method: "apply" },
		{ jobs: expectedJobs, method: "apply" },
	]);
	await page.reload();
	await expect(
		page.getByRole("switch", { name: "Warm up Claude" })
	).toHaveAttribute("aria-checked", "true");
	await expect(page.getByLabel("Ping message")).toHaveValue("hello");
	await expect(
		page.getByRole("combobox", { name: "Choose the ping model for Claude" })
	).toContainText("claude-opus-4");
	await expect(
		page.getByRole("button", { name: "Remove 05:00" })
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Remove 07:30" })
	).toBeVisible();
	const runButton = page.getByRole("button", { name: "Run now" }).first();
	await runButton.click();
	await expect(
		page.getByText("Fixture runNow failed once; retry is safe.")
	).toBeVisible();
	await page.getByRole("button", { name: "Run now" }).first().click();
	await expect(page.getByText("Sent “Warmup: Claude at 05:00”.")).toBeVisible();
	expect(
		(await callsFor(page)).filter((call) => call.method === "runNow")
	).toEqual([
		{ args: { jobId: "warmup-job-1" }, method: "runNow" },
		{ args: { jobId: "warmup-job-1" }, method: "runNow" },
	]);
	await page.screenshot({
		animations: "disabled",
		fullPage: true,
		path: await screenshotPath(testInfo, "warmup-schedule-saved-and-run.png"),
	});
});
