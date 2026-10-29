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
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import { formatDateTime } from "@ryu/ui/lib/timezone.ts";
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
	type AccountNames,
	accountKey,
	DEFAULT_PROMPT,
	jobsForPlan,
	ownedJobs,
	planFromJobs,
	type WarmupPlan,
} from "./lib/plan.ts";
import { ASSUMED_WINDOW_SECONDS, DEFAULT_TIMES } from "./lib/windows.ts";
import { ProviderRow } from "./ProviderRow.tsx";
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
	const providers = useMemo(
		() => detection.data?.providers ?? [],
		[detection.data]
	);
	const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data]);
	const nodeTz = detection.data?.tz ?? "UTC";
	const runtimeCatalog = runtimeCatalogQuery.data ?? null;

	const [selections, setSelections] = useState<Record<string, Selection>>({});
	/** Selected provider logins, keyed by {@link accountKey}. */
	const [accountSelections, setAccountSelections] = useState<
		Record<string, boolean>
	>({});
	/** The ping model per provider id. */
	const [providerModels, setProviderModels] = useState<
		Record<string, string | null>
	>({});
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
		const accountNames = new Map(
			providers.flatMap((provider) =>
				provider.accounts.map((account): [string, AccountNames] => [
					accountKey(provider.id, account.id),
					{ providerName: provider.name, accountLabel: account.label },
				])
			)
		);
		const existing = planFromJobs(jobs, names, nodeTz, accountNames);
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
		const seededAccounts: Record<string, boolean> = {};
		const seededModels: Record<string, string | null> = {};
		for (const provider of providers) {
			const saved = existing.accounts.filter(
				(entry) => entry.providerId === provider.id
			);
			for (const account of provider.accounts) {
				seededAccounts[accountKey(provider.id, account.id)] = saved.some(
					(entry) => entry.accountId === account.id
				);
			}
			// One model per provider; a saved job's pick wins over the automatic one.
			seededModels[provider.id] =
				saved[0]?.model ?? cheapestModel(provider.models)?.modelId ?? null;
		}
		setAccountSelections(seededAccounts);
		setProviderModels(seededModels);
		const firstEntry = existing.entries[0] ?? existing.accounts[0];
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
		providers,
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
			accounts: providers.flatMap((provider) =>
				provider.accounts
					.filter(
						(account) => accountSelections[accountKey(provider.id, account.id)]
					)
					.map((account) => ({
						providerId: provider.id,
						providerName: provider.name,
						accountId: account.id,
						accountLabel: account.label,
						model: providerModels[provider.id] ?? "",
						times,
					}))
			),
		}),
		[
			agents,
			providers,
			selections,
			accountSelections,
			providerModels,
			times,
			prompt,
			nodeTz,
		]
	);

	/** The shortest window any selected agent reports — what coverage is checked against. */
	const windowSeconds = useMemo(() => {
		const agentWindows = agents
			.filter((agent) => selections[agent.id]?.selected)
			.flatMap((agent) => agent.windows);
		const accountWindows = providers.flatMap((provider) =>
			provider.accounts
				.filter(
					(account) => accountSelections[accountKey(provider.id, account.id)]
				)
				.flatMap((account) => account.windows)
		);
		const lengths = [...agentWindows, ...accountWindows]
			.map((w) => w.windowSeconds)
			.filter((s): s is number => s !== null && s > 0);
		return lengths.length > 0 ? Math.min(...lengths) : null;
	}, [agents, providers, selections, accountSelections]);

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
					<EmptyTitle>We couldn&rsquo;t read your subscriptions</EmptyTitle>
					<EmptyDescription>
						Warmup needs to see which agents and provider accounts you have
						before it can schedule anything. Try refreshing.
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
				<h1 className="font-medium text-xl">Warmup</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Sends a one-word message to your subscription agents and provider
					accounts at set times, so a rolling usage window is already open when
					you sit down to work. Every saved account of a provider has its own
					window, so each one is pinged on its own, on the cheapest model.
				</p>
			</header>

			{agents.length === 0 && providers.length === 0 ? (
				<Empty className="mt-8">
					<EmptyHeader>
						<EmptyTitle>No subscriptions yet</EmptyTitle>
						<EmptyDescription>
							Warmup works with subscriptions that meter usage in a rolling
							window: Claude Pro/Max and ChatGPT accounts saved in Ryu, or
							agents such as Claude Code, Codex, Copilot, Grok and GLM. Sign in
							to one, then come back.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					{providers.length > 0 ? (
						<section className="mt-8 space-y-3">
							<h2 className="font-medium text-sm">Provider accounts</h2>
							{providers.map((provider) => (
								<ProviderRow
									isSelected={(accountId) =>
										Boolean(
											accountSelections[accountKey(provider.id, accountId)]
										)
									}
									key={provider.id}
									model={providerModels[provider.id] ?? null}
									onModelChange={(model) =>
										setProviderModels((prev) => ({
											...prev,
											[provider.id]: model,
										}))
									}
									onSelectedChange={(accountId, selected) =>
										setAccountSelections((prev) => ({
											...prev,
											[accountKey(provider.id, accountId)]: selected,
										}))
									}
									provider={provider}
								/>
							))}
						</section>
					) : null}

					{agents.length > 0 ? (
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
					) : null}

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
							<Label htmlFor="warmup-prompt">Ping message</Label>
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
						<p className="mt-3 text-sm text-status-destructive">{error}</p>
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
										<span className="truncate" title={job.name}>
											{job.name}
										</span>
										<span className="flex shrink-0 items-center gap-3">
											<span className="text-muted-foreground text-xs">
												{job.lastRunAt
													? `last ran ${formatDateTime(job.lastRunAt)}${
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
