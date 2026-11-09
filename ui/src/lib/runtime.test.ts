import { describe, expect, it } from "bun:test";
import type { RyuCatalogSnapshot } from "@ryu/app-host/app-bridge";
import {
	runtimeSelectionForModel,
	subscriptionCatalogForAgent,
} from "./runtime.ts";

function catalog(): RyuCatalogSnapshot {
	return {
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
		providers: [
			{
				active: true,
				api: "openai-responses",
				authKind: "subscription",
				configured: true,
				id: "codex-subscription",
				label: "Codex subscription",
				suggestedModels: ["gpt-5-codex-low"],
			},
			{
				api: "openai-responses",
				authKind: "api-key",
				configured: true,
				id: "openai",
				label: "OpenAI",
				suggestedModels: ["gpt-5"],
			},
		],
		thinkingLevels: [],
		version: 1,
	};
}

describe("subscriptionCatalogForAgent", () => {
	it("removes BYOK lanes and models outside the agent advertisement", () => {
		const projected = subscriptionCatalogForAgent(catalog(), [
			{ modelId: "gpt-5-codex-low", name: "Codex low" },
		]);

		expect(projected?.providers).toEqual([
			expect.objectContaining({
				authKind: "subscription",
				id: "codex-subscription",
				suggestedModels: ["gpt-5-codex-low"],
			}),
		]);
	});

	it("returns no shared lane when the subscription model is not published", () => {
		expect(
			subscriptionCatalogForAgent(catalog(), [
				{ modelId: "claude-haiku", name: "Haiku" },
			])
		).toBeNull();
	});
});

describe("runtimeSelectionForModel", () => {
	it("keeps the subscription provider id beside the model", () => {
		expect(
			runtimeSelectionForModel(
				subscriptionCatalogForAgent(catalog(), [
					{ modelId: "gpt-5-codex-low", name: "Codex low" },
				]),
				"gpt-5-codex-low"
			)
		).toEqual({
			kind: "model",
			modelId: "gpt-5-codex-low",
			providerId: "codex-subscription",
		});
	});
});
