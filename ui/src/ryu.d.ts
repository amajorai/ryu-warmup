// The `window.ryu` bridge surface this app consumes. The host installs it inline
// (Path B bootstrap) BEFORE this module runs; every method is a capability-gated
// RPC over a MessagePort — no tokens, no direct network (the frame's CSP is
// `connect-src 'none'`). Calls made before the host port arrives are queued and
// flushed on connect. This app needs only the `warmup` surface (grant
// `warmup:crud`); the host holds the node token and drives Core's `/api/agents`,
// `/api/agents/:id/usage`, `/api/agents/:id/acp-config` and `/heartbeat/jobs`
// behind it.
//
// Return shapes mirror the desktop clients the host reuses verbatim, so
// `bridge.ts` re-declares the concrete types and casts these `unknown`s.

import type {
	RyuCatalogModels,
	RyuCatalogSnapshot,
} from "@ryu/app-host/app-bridge";

export interface RyuWarmup {
	/**
	 * Replace this app's scheduled jobs with exactly `jobs`.
	 *
	 * Core has no update route, so the host deletes every job owned by
	 * `@ryu/warmup` and creates the given set. Rejects with Core's own
	 * validation message (a bad cron or an unknown zone), leaving the previous
	 * jobs deleted — the page refetches after every apply so what it shows is
	 * what survived.
	 */
	apply(jobs: unknown[]): Promise<unknown>;
	/**
	 * The subscription agents on this node, each with its readable usage
	 * windows and advertised models, plus the node's IANA zone.
	 */
	detect(): Promise<unknown>;
	/** Every scheduled job on the node, so the page can find the ones it owns. */
	list(): Promise<unknown>;
	/**
	 * Run one already-scheduled ping right now — the "does this actually work"
	 * button. Naming a saved job rather than describing a turn is what makes it
	 * prove the real thing: same agent, same model, same message the schedule
	 * will use. Resolves when the turn completes; rejects with Core's message if
	 * the job failed.
	 */
	runNow(args: { jobId: string }): Promise<unknown>;
}

export interface RyuBridge {
	catalog: {
		models(input: { providerId: string }): Promise<RyuCatalogModels>;
		snapshot(): Promise<RyuCatalogSnapshot>;
	};
	context: { spaceId?: string; docId?: string } | null;
	warmup: RyuWarmup;
}

declare global {
	interface Window {
		ryu?: RyuBridge;
	}
}
