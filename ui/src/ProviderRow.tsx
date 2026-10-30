// One subscription provider and its saved logins. Each login has its own
// rolling window, so each has its own switch; the ping model is one choice per
// provider because the logins differ in quota, not in what they can run.

import { useLiteralMessages } from "@ryu/i18n/react";
import { Badge } from "@ryu/ui/components/badge.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "@ryu/ui/components/native-select.tsx";
import { Switch } from "@ryu/ui/components/switch.tsx";
import { REASON_TEXT } from "./AgentRow.tsx";
import { byCostAscending, cheapestModel } from "./lib/cheapest.ts";
import { formatDuration } from "./lib/windows.ts";
import type { WarmupAccount, WarmupProvider } from "./types.ts";

export interface ProviderRowProps {
	isSelected: (accountId: string) => boolean;
	/** The model every ping for this provider pins, or `null` when it lists none. */
	model: string | null;
	onModelChange: (model: string) => void;
	onSelectedChange: (accountId: string, selected: boolean) => void;
	provider: WarmupProvider;
}

function accountStatus(account: WarmupAccount): string {
	if (account.needsReauth) {
		return "This login needs a new sign-in before it can be warmed.";
	}
	if (!account.available) {
		return (
			REASON_TEXT.get(account.reason ?? "error") ??
			"Its usage window could not be read just now."
		);
	}
	const window =
		account.windows.find((w) => w.windowSeconds) ?? account.windows[0];
	return window
		? `${window.label} · ${Math.round(window.usedPercent)}% used`
		: "Ready to warm up.";
}

export function ProviderRow({
	isSelected,
	model,
	onModelChange,
	onSelectedChange,
	provider,
}: ProviderRowProps) {
	const tl = useLiteralMessages();
	const models = byCostAscending(provider.models);
	const automatic = cheapestModel(provider.models);
	const anySelected = provider.accounts.some((account) =>
		isSelected(account.id)
	);
	const modelSelectId = `provider-model-${provider.id}`;

	return (
		<div className="rounded-lg border border-border p-4">
			<div className="flex items-center gap-2">
				<span className="truncate font-medium text-sm" title={provider.name}>
					{provider.name}
				</span>
				<Badge variant="outline">
					{tl("{count, plural, one {# account} other {# accounts}}", {
						count: provider.accounts.length,
					})}
				</Badge>
			</div>

			<ul className="mt-3 space-y-2">
				{provider.accounts.map((account) => {
					const window =
						account.windows.find((w) => w.windowSeconds) ?? account.windows[0];
					return (
						<li
							className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2"
							key={account.id}
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm" title={account.label}>
										{account.label}
									</span>
									{account.plan ? (
										<Badge variant="secondary">{account.plan}</Badge>
									) : null}
									{window?.windowSeconds ? (
										<Badge variant="outline">
											{tl("{duration} window", {
												duration: formatDuration(
													Math.round(window.windowSeconds / 60)
												),
											})}
										</Badge>
									) : null}
								</div>
								<p className="mt-1 text-muted-foreground text-xs">
									{accountStatus(account)}
								</p>
							</div>
							<Switch
								aria-label={tl(
									"Warm up {providerName} account {accountLabel}",
									{
										providerName: provider.name,
										accountLabel: account.label,
									}
								)}
								checked={isSelected(account.id)}
								disabled={
									model === null ||
									(account.needsReauth && !isSelected(account.id))
								}
								onCheckedChange={(selected) =>
									onSelectedChange(account.id, selected)
								}
							/>
						</li>
					);
				})}
			</ul>

			{model === null ? (
				<p className="mt-3 text-muted-foreground text-xs">
					{tl(
						"{providerName} lists no models yet, so its accounts cannot be pinged.",
						{ providerName: provider.name }
					)}
				</p>
			) : null}

			{anySelected && model !== null ? (
				<div className="mt-4 max-w-sm">
					<Label htmlFor={modelSelectId}>Ping model</Label>
					<NativeSelect
						id={modelSelectId}
						onChange={(e) => onModelChange(e.target.value)}
						value={model}
					>
						{models.map((m) => (
							<NativeSelectOption key={m.modelId} value={m.modelId}>
								{m.modelId === automatic?.modelId
									? tl("{modelName} — cheapest", { modelName: m.name })
									: m.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
			) : null}
		</div>
	);
}
