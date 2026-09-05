// One subscription agent's row: whether it is warmed up, on which model, and
// what its live usage says. The model picker is ordered cheapest-first with the
// automatic pick preselected, because the automatic pick is the whole point —
// but it is a picker and not a fixed value, since only the user knows whether
// they would rather spend a better model on the ping.

import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import { ModelAgentPicker } from "@ryu/blocks/composer/runtime-picker";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { byCostAscending, cheapestModel } from "./lib/cheapest.ts";
import {
	runtimeSelectionForModel,
	subscriptionCatalogForAgent,
} from "./lib/runtime.ts";
import { formatDuration } from "./lib/windows.ts";
import type { WarmupAgent } from "./types.ts";

/** Why an agent has no readable window, in words a user can act on. */
const REASON_TEXT: Record<string, string> = {
	unsupported: "This agent has no subscription window to warm up.",
	not_logged_in: "Sign in to this agent to read its usage window.",
	token_expired: "This agent's login expired — sign in again.",
	missing_scope: "This agent's login is missing the usage permission.",
	no_plan: "No subscription plan is active on this agent.",
	rate_limited: "The provider is rate-limiting usage reads; try again later.",
	error: "Its usage window could not be read just now.",
};

export interface AgentRowProps {
	agent: WarmupAgent;
	catalog: RyuCatalogSnapshot | null;
	/** The model currently chosen, or `null` for the agent's configured one. */
	model: string | null;
	onModelChange: (model: string | null) => void;
	onSelectedChange: (selected: boolean) => void;
	selected: boolean;
}

export function AgentRow({
	agent,
	catalog,
	model,
	onModelChange,
	onSelectedChange,
	selected,
}: AgentRowProps) {
	const models = byCostAscending(agent.models);
	const automatic = cheapestModel(agent.models);
	const window = agent.windows.find((w) => w.windowSeconds) ?? agent.windows[0];
	const reason = agent.available ? null : REASON_TEXT[agent.reason ?? "error"];
	const pickerCatalog =
		model === null ? null : subscriptionCatalogForAgent(catalog, agent.models);
	const runtimeSelection = runtimeSelectionForModel(pickerCatalog, model);

	return (
		<div className="rounded-lg border border-border p-4">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="truncate font-medium text-sm">{agent.name}</span>
						{agent.plan ? (
							<Badge variant="secondary">{agent.plan}</Badge>
						) : null}
						{window?.windowSeconds ? (
							<Badge variant="outline">
								{formatDuration(Math.round(window.windowSeconds / 60))} window
							</Badge>
						) : null}
					</div>
					<p className="mt-1 text-muted-foreground text-xs">
						{reason ??
							(window
								? `${window.label} · ${Math.round(window.usedPercent)}% used`
								: "Ready to warm up.")}
					</p>
				</div>
				<Switch
					aria-label={`Warm up ${agent.name}`}
					checked={selected}
					onCheckedChange={onSelectedChange}
				/>
			</div>

			{selected ? (
				<div className="mt-4">
					<div className="max-w-sm">
						<Label className="text-xs" htmlFor={`model-${agent.id}`}>
							Ping model
						</Label>
						{pickerCatalog && runtimeSelection ? (
							<ModelAgentPicker
								ariaLabel={`Choose the ping model for ${agent.name}`}
								catalog={pickerCatalog}
								id={`model-${agent.id}`}
								mode="model"
								onSelectionChange={(selection) => {
									if (selection.kind === "model") {
										onModelChange(selection.modelId);
									}
								}}
								placeholder="Choose a Ryu model"
								value={runtimeSelection}
							/>
						) : (
							<NativeSelect
								id={`model-${agent.id}`}
								onChange={(e) =>
									onModelChange(e.target.value === "" ? null : e.target.value)
								}
								value={model ?? ""}
							>
								<NativeSelectOption value="">
									This agent&rsquo;s usual model
								</NativeSelectOption>
								{models.map((m) => (
									<NativeSelectOption key={m.modelId} value={m.modelId}>
										{m.modelId === automatic?.modelId
											? `${m.name} — cheapest`
											: m.name}
									</NativeSelectOption>
								))}
							</NativeSelect>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
