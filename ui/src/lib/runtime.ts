import type {
	RyuCatalogSnapshot,
	RyuRuntimeSelection,
} from "@ryu/app-host/app-bridge";
import type { ModelOption } from "./cheapest.ts";

/**
 * Warmup jobs execute a subscription agent, not a Gateway model request. Keep
 * the shared picker honest by projecting only the subscription provider lanes
 * that advertise one of that agent's own models. BYOK and managed model lanes
 * belong to the model-generating apps whose requests carry a provider id.
 */
export function subscriptionCatalogForAgent(
	catalog: RyuCatalogSnapshot | null,
	models: readonly ModelOption[]
): RyuCatalogSnapshot | null {
	if (!catalog) {
		return null;
	}

	const modelIds = new Set(
		models.map((model) => model.modelId).filter((modelId) => modelId.length > 0)
	);
	if (modelIds.size === 0) {
		return null;
	}

	const providers = catalog.providers.flatMap((provider) => {
		if (
			provider.authKind !== "subscription" ||
			!(provider.active || provider.configured || provider.managed)
		) {
			return [];
		}
		const suggestedModels = (provider.suggestedModels ?? []).filter(
			(modelId) =>
				modelIds.has(modelId) && provider.modelOverrides?.[modelId] !== false
		);
		return suggestedModels.length > 0 ? [{ ...provider, suggestedModels }] : [];
	});

	return providers.length > 0 ? { ...catalog, providers } : null;
}

export function runtimeSelectionForModel(
	catalog: RyuCatalogSnapshot | null,
	modelId: string | null
): RyuRuntimeSelection | undefined {
	if (!(catalog && modelId)) {
		return undefined;
	}
	const provider = catalog.providers.find((candidate) =>
		candidate.suggestedModels?.includes(modelId)
	);
	return provider
		? { kind: "model", modelId, providerId: provider.id }
		: undefined;
}
