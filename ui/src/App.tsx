// The Warmup companion root.
//
// The page holds no configuration of its own: it reads the scheduled jobs it
// owns, reconstructs the plan from them, lets the user edit that plan, and
// writes it back as a fresh set of jobs. "What is scheduled" therefore has one
// representation — the jobs — and the page cannot drift from it.

import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import { Button } from "@ryu/ui/components/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@ryu/ui/components/empty.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import { Spinner } from "@ryu/ui/components/spinner.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentRow } from "./AgentRow.tsx";
import {
	applyJobs,
	detect,
	fetchRuntimeCatalog,
	listJobs,
	runNow,
} from "./bridge.ts";
import { cheapestModel } from "./lib/cheapest.ts";
import {
	DEFAULT_PROMPT,
	jobsForPlan,
	ownedJobs,
	planFromJobs,
	type WarmupPlan,
} from "./lib/plan.ts";
import { ASSUMED_WINDOW_SECONDS, DEFAULT_TIMES } from "./lib/windows.ts";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import { TimesEditor } from "./TimesEditor.tsx";

const POLL_MS = 30_000;

/** Per-agent editor state, keyed by agent id. */
interface Selection {
	model: string | null;
	selected: boolean;
}

export function App() {
	const detection = useQuery({
		queryKey: ["warmup-detect"],
		queryFn: () => detect(),
	});
	const jobsQuery = useQuery({
		queryKey: ["warmup-jobs"],
		queryFn: () => listJobs(),
		refetchInterval: POLL_MS,
	});
	const runtimeCatalogQuery = useQuery<RyuCatalogSnapshot>({
		queryKey: ["warmup-runtime-catalog"],
		queryFn: fetchRuntimeCatalog,
	});

	const agents = useMemo(() => detection.data?.agents ?? [], [detection.data]);
	const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
	const nodeTz = detection.data?.tz ?? "UTC";
	const runtimeCatalog = runtimeCatalogQuery.data ?? null;

	const [selections, setSelections] = useState<Record<string, Selection>>({});
	const [times, setTimes] = useState<string[]>([...DEFAULT_TIMES]);
	const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
	const [hydrated, setHydrated] = useState(false);
	const [saving, setSaving] = useState(false);
	const [runningJob, setRunningJob] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Seed the editor once, from the jobs already on the node when they exist and
	// from the recommended defaults when they don't. Re-seeding on every poll
	// would overwrite whatever the user is in the middle of editing.
	useEffect(() => {
		if (hydrated || detection.isLoading || jobsQuery.isLoading) {
			return;
		}
		const names = new Map(agents.map((a): [string, string] => [a.id, a.name]));
		const existing = planFromJobs(jobs, names, nodeTz);
		const seeded: Record<string, Selection> = {};
		for (const agent of agents) {
			const entry = existing.entries.find((e) => e.agentId === agent.id);
			seeded[agent.id] = {
				selected: Boolean(entry),
				model: entry
					? entry.model
					: (cheapestModel(agent.models)?.modelId ?? null),
			};
		}
		setSelections(seeded);
		const firstEntry = existing.entries[0];
		if (firstEntry) {
			// Times are ONE shared value across agents (see TimesEditor) — the thing
			// being scheduled is the user's day, not each agent's. Reading the first
			// entry is therefore the whole answer in the normal case. If a partial
			// apply ever left agents with divergent times, they collapse to the
			// first agent's on the next save; that is the delete-then-create failure
			// mode surfacing, not a separate bug.
			setTimes(firstEntry.times);
			setPrompt(existing.prompt);
		}
		setHydrated(true);
	}, [
		agents,
		jobs,
		nodeTz,
		hydrated,
		detection.isLoading,
		jobsQuery.isLoading,
	]);

	const plan: WarmupPlan = useMemo(
		() => ({
			prompt: prompt.trim() || DEFAULT_PROMPT,
			tz: nodeTz,
			entries: agents
				.filter((agent) => selections[agent.id]?.selected)
				.map((agent) => ({
					agentId: agent.id,
					agentName: agent.name,
					model: selections[agent.id]?.model ?? null,
					times,
				})),
		}),
		[agents, selections, times, prompt, nodeTz]
	);

	/** The shortest window any selected agent reports — what coverage is checked against. */
	const windowSeconds = useMemo(() => {
		const lengths = agents
			.filter((agent) => selections[agent.id]?.selected)
			.flatMap((agent) => agent.windows)
			.map((w) => w.windowSeconds)
			.filter((s): s is number => typeof s === "number" && s > 0);
		return lengths.length > 0 ? Math.min(...lengths) : null;
	}, [agents, selections]);

	const save = useCallback(async () => {
		setSaving(true);
		setError(null);
		setMessage(null);
		try {
			const inputs = jobsForPlan(plan);
			await applyJobs(inputs);
			setMessage(
				inputs.length === 0
					? "Warmup is off — no pings are scheduled."
					: `Scheduled ${inputs.length} ping${inputs.length === 1 ? "" : "s"} a day.`
			);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "The schedule could not be saved."
			);
		} finally {
			setSaving(false);
			jobsQuery.refetch();
		}
	}, [plan, jobsQuery]);

	// Runs the SAVED job, so what it proves is what the schedule will do — same
	// agent, same pinned model, same message. A ping the user has edited but not
	// saved is deliberately not runnable: it does not exist yet.
	const sendOne = useCallback(
		async (jobId: string, label: string) => {
			setRunningJob(jobId);
			setError(null);
			setMessage(null);
			try {
				await runNow(jobId);
				setMessage(`Sent “${label}”.`);
			} catch (e) {
				setError(
					e instanceof Error ? e.message : "That ping did not go through."
				);
			} finally {
				setRunningJob(null);
				jobsQuery.refetch();
			}
		},
		[jobsQuery]
	);

	if (detection.isLoading) {
		return (
			<div className="flex h-dvh items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (detection.isError) {
		return (
			<Empty className="h-dvh">
				<EmptyHeader>
					<EmptyTitle>We couldn&rsquo;t read your agents</EmptyTitle>
					<EmptyDescription>
						Warmup needs to see which agents you have before it can schedule
						anything. Try refreshing.
					</EmptyDescription>
				</EmptyHeader>
				<Button onClick={() => detection.refetch()} type="button">
					Try again
				</Button>
			</Empty>
		);
	}

	const scheduled = ownedJobs(jobs);

	return (
		<div className="mx-auto max-w-3xl p-6">
			<header>
				<h1 className="font-semibold text-xl">Warmup</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Sends a one-word message to your subscription agents at set times, so
					a rolling usage window is already open when you sit down to work.
					Pings run on the cheapest model each agent offers.
				</p>
			</header>

			{agents.length === 0 ? (
				<Empty className="mt-8">
					<EmptyHeader>
						<EmptyTitle>No subscription agents yet</EmptyTitle>
						<EmptyDescription>
							Warmup works with agents that run on a subscription with a rolling
							usage window — Claude Code, Codex, Copilot, Grok, GLM. Install and
							sign in to one, then come back.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					<section className="mt-8 space-y-3">
						<h2 className="font-medium text-sm">Agents</h2>
						{agents.map((agent) => (
							<AgentRow
								agent={agent}
								catalog={runtimeCatalog}
								key={agent.id}
								model={selections[agent.id]?.model ?? null}
								onModelChange={(model) =>
									setSelections((prev) => {
										const current = prev[agent.id] ?? {
											model: null,
											selected: false,
										};
										return {
											...prev,
											[agent.id]: { ...current, model },
										};
									})
								}
								onSelectedChange={(selected) =>
									setSelections((prev) => {
										const current = prev[agent.id] ?? {
											model: null,
											selected: false,
										};
										return {
											...prev,
											[agent.id]: { ...current, selected },
										};
									})
								}
								selected={Boolean(selections[agent.id]?.selected)}
							/>
						))}
					</section>

					<section className="mt-8 rounded-lg border border-border p-4">
						<TimesEditor
							onChange={setTimes}
							times={times}
							windowSeconds={windowSeconds ?? ASSUMED_WINDOW_SECONDS}
						/>
						<p className="mt-3 text-muted-foreground text-xs">
							Times are read in {nodeTz}, so they stay put across daylight
							saving.
						</p>

						<div className="mt-4">
							<Label className="text-xs" htmlFor="warmup-prompt">
								Ping message
							</Label>
							<Input
								className="mt-1 max-w-xs"
								id="warmup-prompt"
								onChange={(e) => setPrompt(e.target.value)}
								placeholder={DEFAULT_PROMPT}
								value={prompt}
							/>
						</div>
					</section>

					<div className="mt-6 flex items-center gap-3">
						<Button disabled={saving} onClick={save} type="button">
							{saving ? "Saving…" : "Save schedule"}
						</Button>
						<span className="text-muted-foreground text-xs">
							{scheduled.length === 0
								? "Nothing scheduled yet."
								: `${scheduled.length} ping${scheduled.length === 1 ? "" : "s"} scheduled.`}
						</span>
					</div>

					{message ? (
						<p className="mt-3 text-muted-foreground text-sm">{message}</p>
					) : null}
					{error ? (
						<p className="mt-3 text-destructive text-sm">{error}</p>
					) : null}

					{scheduled.length > 0 ? (
						<section className="mt-8">
							<h2 className="font-medium text-sm">Scheduled pings</h2>
							<ul className="mt-3 space-y-1">
								{scheduled.map((job) => (
									<li
										className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm"
										key={job.id}
									>
										<span className="truncate">{job.name}</span>
										<span className="flex shrink-0 items-center gap-3">
											<span className="text-muted-foreground text-xs">
												{job.lastRunAt
													? `last ran ${new Date(job.lastRunAt).toLocaleString()}${
															job.lastOutcome === "failure" ? " — failed" : ""
														}`
													: "not run yet"}
											</span>
											<Button
												disabled={runningJob === job.id}
												onClick={() => sendOne(job.id, job.name)}
												size="sm"
												type="button"
												variant="outline"
											>
												{runningJob === job.id ? "Sending…" : "Run now"}
											</Button>
										</span>
									</li>
								))}
							</ul>
						</section>
					) : null}
				</>
			)}
		</div>
	);
}
