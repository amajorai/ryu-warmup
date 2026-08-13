import { describe, expect, it } from "bun:test";
import {
	byCostAscending,
	cheapestModel,
	costRank,
	type ModelOption,
} from "./cheapest.ts";

const model = (modelId: string, name = modelId): ModelOption => ({
	modelId,
	name,
});

describe("costRank", () => {
	it("ranks families cheapest-first", () => {
		expect(costRank(model("claude-haiku-4-5", "Haiku 4.5"))).toBeLessThan(
			costRank(model("claude-sonnet-4-5", "Sonnet 4.5"))
		);
		expect(costRank(model("claude-sonnet-4-5", "Sonnet 4.5"))).toBeLessThan(
			costRank(model("claude-opus-4-1", "Opus 4.1"))
		);
	});

	it("lets family dominate effort", () => {
		// A high-effort small model is still cheaper than a low-effort flagship.
		expect(costRank(model("gpt-5-mini-high", "Mini (high)"))).toBeLessThan(
			costRank(model("gpt-5-pro-low", "Pro (low)"))
		);
	});

	it("breaks ties within a family by effort", () => {
		expect(costRank(model("gpt-5-codex-low", "Codex low"))).toBeLessThan(
			costRank(model("gpt-5-codex-high", "Codex high"))
		);
	});

	it("puts an unrecognised model mid-table, never at either extreme", () => {
		const unknown = costRank(model("some-vendor-model-v2", "Model v2"));
		expect(unknown).toBeGreaterThan(
			costRank(model("claude-haiku-4-5", "Haiku"))
		);
		expect(unknown).toBeLessThan(costRank(model("claude-opus-4-1", "Opus")));
	});

	it("reads the description too, so an unhelpful id still ranks", () => {
		const cheap = costRank({
			modelId: "m1",
			name: "Model One",
			description: "Fastest and cheapest — good for simple tasks",
		});
		expect(cheap).toBeLessThan(costRank(model("m2", "Model Two")));
	});
});

describe("cheapestModel", () => {
	it("picks the small model out of a real Claude Code line-up", () => {
		const picked = cheapestModel([
			model("claude-opus-4-1", "Opus 4.1"),
			model("claude-sonnet-4-5", "Sonnet 4.5"),
			model("claude-haiku-4-5", "Haiku 4.5"),
		]);
		expect(picked?.modelId).toBe("claude-haiku-4-5");
	});

	it("picks the lowest effort out of a real Codex line-up", () => {
		const picked = cheapestModel([
			model("gpt-5-codex-high", "gpt-5-codex high"),
			model("gpt-5-codex-medium", "gpt-5-codex medium"),
			model("gpt-5-codex-low", "gpt-5-codex low"),
		]);
		expect(picked?.modelId).toBe("gpt-5-codex-low");
	});

	it("keeps the agent's own order when candidates tie", () => {
		const picked = cheapestModel([model("alpha"), model("beta")]);
		expect(picked?.modelId).toBe("alpha");
	});

	it("skips entries with no model id", () => {
		const picked = cheapestModel([
			{ modelId: "", name: "Default (recommended)" },
			model("claude-haiku-4-5", "Haiku 4.5"),
		]);
		expect(picked?.modelId).toBe("claude-haiku-4-5");
	});

	it("returns null when the agent advertises no models", () => {
		expect(cheapestModel([])).toBeNull();
	});
});

describe("byCostAscending", () => {
	it("orders a picker cheapest-first without dropping anything", () => {
		const models = [
			model("claude-opus-4-1", "Opus 4.1"),
			model("claude-haiku-4-5", "Haiku 4.5"),
			model("claude-sonnet-4-5", "Sonnet 4.5"),
		];
		expect(byCostAscending(models).map((m) => m.modelId)).toEqual([
			"claude-haiku-4-5",
			"claude-sonnet-4-5",
			"claude-opus-4-1",
		]);
		expect(byCostAscending(models)).toHaveLength(models.length);
	});
});
