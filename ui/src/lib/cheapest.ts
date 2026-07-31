// Picking the cheapest model an agent advertises.
//
// A warmup ping is a one-word errand whose only job is to open a rolling usage
// window. Running it on the agent's flagship model spends the same window it is
// trying to preserve — subscription caps weight usage by model, so a Haiku ping
// costs a fraction of an Opus one. This module ranks the models the agent
// itself advertised (ACP `session/new`) and picks the least expensive.
//
// The ranking is a keyword table, not a live price lookup, on purpose: it must
// work offline, it must be deterministic, and the pick is always shown and
// overridable in the UI. A model whose name matches nothing lands in the middle
// rather than at either extreme, so an unrecognised entry never silently wins
// (which would pick an unknown-cost model) or is never eligible.

/** One model an agent advertises. Mirrors the ACP `availableModels` entry. */
export interface ModelOption {
	description?: string | null;
	modelId: string;
	name: string;
}

/**
 * Model families, cheapest first. Matched against the id + name + description,
 * so "Haiku 4.5", `claude-haiku-4-5` and "fast, cheap" all land together.
 */
const FAMILY_TIERS: readonly (readonly string[])[] = [
	// Tier 0 — the small/fast tier every vendor ships.
	["haiku", "nano", "mini", "flash", "lite", "small", "air", "instant"],
	// Tier 1 — mid.
	["sonnet", "codex", "medium", "standard", "plus", "base"],
	// Tier 2 — flagship.
	["opus", "pro", "max", "ultra", "large", "heavy"],
];

/**
 * Reasoning-effort words, cheapest first. Many agents expose one family at
 * several efforts (`gpt-5-codex low` / `medium` / `high`), and effort moves cost
 * as much as family does — so it is a second, finer sort key rather than a
 * separate table.
 */
const EFFORT_TIERS: readonly (readonly string[])[] = [
	["minimal", "none"],
	["low", "fast"],
	["medium", "balanced"],
	["high", "thinking", "reasoning", "extended"],
];

/** Rank used for a model no keyword matched: mid-table, never a winner by default. */
const UNKNOWN_FAMILY_RANK = 1.5;
const UNKNOWN_EFFORT_RANK = 1.5;

function haystack(model: ModelOption): string {
	return `${model.modelId} ${model.name} ${model.description ?? ""}`.toLowerCase();
}

function tierRank(
	text: string,
	tiers: readonly (readonly string[])[],
	fallback: number
): number {
	for (let tier = 0; tier < tiers.length; tier++) {
		if (tiers[tier].some((word) => text.includes(word))) {
			return tier;
		}
	}
	return fallback;
}

/**
 * A model's relative cost. Lower is cheaper. Family dominates (a high-effort
 * Haiku is still cheaper than a low-effort Opus), with effort breaking ties
 * inside a family.
 */
export function costRank(model: ModelOption): number {
	const text = haystack(model);
	const family = tierRank(text, FAMILY_TIERS, UNKNOWN_FAMILY_RANK);
	const effort = tierRank(text, EFFORT_TIERS, UNKNOWN_EFFORT_RANK);
	return family * 10 + effort;
}

/**
 * The cheapest of `models`, or `null` when there is nothing to choose from.
 *
 * Ties keep the order the agent advertised them in, which is the agent's own
 * preference order — so equal-cost candidates resolve to the one it would have
 * used anyway.
 */
export function cheapestModel(
	models: readonly ModelOption[]
): ModelOption | null {
	let best: ModelOption | null = null;
	let bestRank = Number.POSITIVE_INFINITY;
	for (const model of models) {
		if (!model.modelId) {
			continue;
		}
		const rank = costRank(model);
		if (rank < bestRank) {
			best = model;
			bestRank = rank;
		}
	}
	return best;
}

/**
 * `models` sorted cheapest-first for a picker, preserving the agent's order
 * within a cost tier.
 */
export function byCostAscending(models: readonly ModelOption[]): ModelOption[] {
	return models
		.map((model, index) => ({ model, index, rank: costRank(model) }))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.model);
}
