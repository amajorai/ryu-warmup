// A minimal `useQuery` shim standing in for `@tanstack/react-query` (the shell's
// react-query cannot cross the sandbox boundary). It runs `queryFn` in an effect
// keyed by the JSON-serialized `queryKey`, exposes the `{ data, isLoading,
// isError, isFetching, refetch }` subset the page reads, and adds a
// BACKGROUND poll (`refetchInterval`).
//
// The poll is deliberately SILENT — a 15s tick updates `data` without flipping
// `isLoading`/`isFetching`, so it never re-shows the spinner or disables the
// Refresh button (the desktop page, which had no interval, never flickered).
// Only the initial load and a manual `refetch()` set `isFetching`; only the
// initial load sets `isLoading`. This is the spec's "15s poll + post-mutation
// refetch, background refetch that doesn't flip isLoading" for the sandbox.

import { useCallback, useEffect, useRef, useState } from "react";

export interface QueryResult<T> {
	data: T | undefined;
	error: unknown;
	isError: boolean;
	isFetching: boolean;
	isLoading: boolean;
	refetch: () => void;
}

export function useQuery<T>(opts: {
	queryKey: unknown[];
	queryFn: () => Promise<T>;
	/** Background poll interval in ms; omit to disable polling. */
	refetchInterval?: number;
}): QueryResult<T> {
	const [data, setData] = useState<T | undefined>(undefined);
	const [error, setError] = useState<unknown>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isFetching, setIsFetching] = useState(true);
	const fnRef = useRef(opts.queryFn);
	fnRef.current = opts.queryFn;
	const key = JSON.stringify(opts.queryKey);
	const { refetchInterval } = opts;

	// Run the query. `silent` (the background poll) updates data/error without
	// touching the loading/fetching flags, so no spinner re-appears and the
	// Refresh button never disables on a tick.
	const run = useCallback((aliveRef: { alive: boolean }, silent: boolean) => {
		if (!silent) {
			setIsFetching(true);
		}
		fnRef
			.current()
			.then((v) => {
				if (aliveRef.alive) {
					setData(v);
					setError(null);
				}
			})
			.catch((e) => {
				if (aliveRef.alive) {
					setError(e);
				}
			})
			.finally(() => {
				if (aliveRef.alive) {
					setIsLoading(false);
					if (!silent) {
						setIsFetching(false);
					}
				}
			});
	}, []);

	const manualRef = useRef<{ alive: boolean }>({ alive: true });

	useEffect(() => {
		const aliveRef = { alive: true };
		manualRef.current = aliveRef;
		run(aliveRef, false);
		let timer: ReturnType<typeof setInterval> | undefined;
		if (refetchInterval && refetchInterval > 0) {
			timer = setInterval(() => run(aliveRef, true), refetchInterval);
		}
		return () => {
			aliveRef.alive = false;
			if (timer) {
				clearInterval(timer);
			}
		};
		// biome-ignore lint/correctness/useExhaustiveDependencies: key is the content hash of queryKey; run is stable.
	}, [key, refetchInterval, run]);

	const refetch = useCallback(() => {
		run(manualRef.current, false);
	}, [run]);

	return {
		data,
		error,
		isError: error !== null && error !== undefined,
		isFetching,
		isLoading,
		refetch,
	};
}
