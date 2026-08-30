// The client layer the page calls. Every call goes over the `window.ryu` bridge
// rather than a direct `fetch`: the sandboxed frame has no node token and its
// CSP forbids network access, so the host performs the HTTP and forwards the
// result. Shapes match the desktop clients the host reuses.

import type {
	RyuCatalogModels,
	RyuCatalogSnapshot,
} from "@ryu/app-host/app-bridge";
import type { RyuBridge } from "./ryu.d.ts";
import type { ScheduledJob, WarmupDetection, WarmupJobInput } from "./types.ts";

function ryu(): RyuBridge {
	const bridge = typeof window === "undefined" ? undefined : window.ryu;
	if (!bridge) {
		throw new Error(
			"The warmup capability is not available for this app (grant warmup:crud)."
		);
	}
	return bridge;
}

/** Subscription agents on this node, with usage windows, models, and the zone. */
export function detect(): Promise<WarmupDetection> {
	return ryu().warmup.detect() as Promise<WarmupDetection>;
}

/** Read the shared Ryu provider/model catalog used by every runtime picker. */
export function fetchRuntimeCatalog(): Promise<RyuCatalogSnapshot> {
	return ryu().catalog.snapshot();
}

export function discoverRuntimeModels(
	providerId: string
): Promise<RyuCatalogModels> {
	return ryu().catalog.models({ providerId });
}

/** Every scheduled job on the node (`GET /heartbeat/jobs`). */
export function listJobs(): Promise<ScheduledJob[]> {
	return ryu().warmup.list() as Promise<ScheduledJob[]>;
}

/** Replace this app's jobs with `jobs`. Rejects with Core's validation message. */
export async function applyJobs(jobs: WarmupJobInput[]): Promise<void> {
	await ryu().warmup.apply(jobs);
}

/** Run one already-scheduled ping now. Rejects with Core's message on failure. */
export async function runNow(jobId: string): Promise<void> {
	await ryu().warmup.runNow({ jobId });
}
