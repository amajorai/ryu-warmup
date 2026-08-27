// The clock-time model: the times of day a warmup ping fires, and the cron
// expressions Core stores for them.
//
// Times are wall-clock in the user's own zone (the job carries an IANA `tz`, so
// Core evaluates them against that zone rather than UTC — a schedule chosen to
// sit a fixed distance from a rate-limit boundary cannot absorb a DST hour).
// Everything here is pure so the arithmetic is testable without a Core.

/** A time of day, minutes since local midnight. */
export type Minutes = number;

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_HOUR = 60;

/**
 * The shipped defaults: 05:00, 10:00, 15:00, 20:00 local.
 *
 * Chosen for a 5-hour rolling window. The three daytime gaps are 5h, 5h and 5h,
 * so each ping opens a window that covers the run-up to the next one. The
 * overnight gap is deliberately 9h: the user is asleep, and a 01:00 ping would
 * burn a window that expires at 06:00 — leaving the morning uncovered — rather
 * than the 05:00 one that is still open when they start work. This is the
 * reason the defaults are not evenly spaced, and why the coverage hint below
 * only reports the daytime gaps.
 */
export const DEFAULT_TIMES: readonly string[] = [
	"05:00",
	"10:00",
	"15:00",
	"20:00",
];

/** The window length assumed when an agent reports none (the common 5h plan). */
export const ASSUMED_WINDOW_SECONDS = 5 * 60 * 60;

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** Parse `"HH:MM"` into minutes since midnight, or `null` if it is not a time. */
export function parseTime(value: string): Minutes | null {
	const match = TIME_PATTERN.exec(value.trim());
	if (!match) {
		return null;
	}
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) {
		return null;
	}
	return hour * MINUTES_PER_HOUR + minute;
}

/** Render minutes-since-midnight back as `"HH:MM"`. */
export function formatTime(minutes: Minutes): string {
	const wrapped =
		((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	const hour = Math.floor(wrapped / MINUTES_PER_HOUR);
	const minute = wrapped % MINUTES_PER_HOUR;
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Normalize a user-entered list: drop anything unparseable, de-duplicate, and
 * sort ascending. Returned as `"HH:MM"` strings so the caller never has to
 * decide whether `"5:00"` and `"05:00"` are the same window (they are).
 */
export function normalizeTimes(values: readonly string[]): string[] {
	const minutes = new Set<Minutes>();
	for (const value of values) {
		const parsed = parseTime(value);
		if (parsed !== null) {
			minutes.add(parsed);
		}
	}
	return [...minutes].sort((a, b) => a - b).map(formatTime);
}

/** The 5-field cron expression that fires daily at `time` (`"HH:MM"`). */
export function cronForTime(time: string): string {
	const minutes = parseTime(time);
	if (minutes === null) {
		throw new Error(`'${time}' is not a time of day (expected HH:MM)`);
	}
	return `${minutes % MINUTES_PER_HOUR} ${Math.floor(minutes / MINUTES_PER_HOUR)} * * *`;
}

/** Read a daily `M H * * *` cron back as `"HH:MM"`, or `null` if it is not one. */
export function timeFromCron(expr: string): string | null {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) {
		return null;
	}
	const [minute = "", hour = "", dom, month, dow] = fields;
	if (dom !== "*" || month !== "*" || dow !== "*") {
		return null;
	}
	if (!(/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour))) {
		return null;
	}
	// Compared as numbers, not re-parsed as text: a cron writes its fields
	// unpadded (`0 5 * * *`), so round-tripping through `"5:0"` would fail the
	// zero-padded-minute format that `parseTime` accepts.
	const h = Number(hour);
	const m = Number(minute);
	if (h > 23 || m > 59) {
		return null;
	}
	return formatTime(h * MINUTES_PER_HOUR + m);
}

/** One stretch between consecutive pings, in the order they occur. */
export interface Gap {
	from: string;
	/** Minutes from `from` to `to`, wrapping across midnight for the last one. */
	minutes: number;
	/** True when the gap runs past midnight — the overnight one. */
	overnight: boolean;
	to: string;
}

/**
 * The gaps between consecutive times, wrapping around the day.
 *
 * With fewer than two times there is nothing to compare, so the result is
 * empty. The gap that crosses midnight is flagged rather than dropped: callers
 * report it differently because a long overnight gap is the intended shape, not
 * a mistake.
 */
export function gapsBetween(times: readonly string[]): Gap[] {
	const normalized = normalizeTimes(times);
	if (normalized.length < 2) {
		return [];
	}
	const gaps: Gap[] = [];
	for (let i = 0; i < normalized.length; i++) {
		const from = normalized[i];
		const to = normalized[(i + 1) % normalized.length];
		if (!from || !to) {
			continue;
		}
		const start = parseTime(from) ?? 0;
		const end = parseTime(to) ?? 0;
		const overnight = i === normalized.length - 1;
		gaps.push({
			from,
			to,
			overnight,
			minutes: overnight ? MINUTES_PER_DAY - start + end : end - start,
		});
	}
	return gaps;
}

/**
 * Daytime gaps that are longer than the window they are meant to bridge — the
 * only coverage problem worth reporting.
 *
 * The overnight gap is excluded by design: the shipped defaults leave 9 hours
 * between the 20:00 and 05:00 pings, and flagging that would mean flagging the
 * recommended configuration. What is worth flagging is a *waking* stretch where
 * the window from the earlier ping has expired before the later one arrives.
 */
export function uncoveredGaps(
	times: readonly string[],
	windowSeconds: number = ASSUMED_WINDOW_SECONDS
): Gap[] {
	const windowMinutes = Math.max(1, Math.round(windowSeconds / 60));
	return gapsBetween(times).filter(
		(g) => !g.overnight && g.minutes > windowMinutes
	);
}

/**
 * The span a day's pings are meant to cover: 05:00 until the last window closes
 * at 01:00, i.e. 20 hours. Not "waking hours" — the evening window is the one
 * still open late, and the overnight gap after it is deliberate.
 */
const ACTIVE_SPAN_MINUTES = 20 * MINUTES_PER_HOUR;

/**
 * How many pings a day it takes to cover {@link ACTIVE_SPAN_MINUTES} for a
 * given window length.
 *
 * A 5-hour window needs four, which is exactly {@link DEFAULT_TIMES} — the
 * shipped defaults are this function's output, not a separate opinion. A longer
 * window needs proportionally fewer, which is what "some plans have more than
 * 5h" means in practice.
 */
export function suggestedPingCount(windowSeconds: number): number {
	const windowMinutes = Math.max(1, Math.round(windowSeconds / 60));
	return Math.max(1, Math.ceil(ACTIVE_SPAN_MINUTES / windowMinutes));
}

/**
 * Evenly spaced times covering the active span, anchored at 05:00 — the shape
 * {@link DEFAULT_TIMES} has, generalized to a window of any length. Offered as
 * a one-click suggestion when an agent reports a window that is not 5 hours.
 */
export function suggestTimes(windowSeconds: number): string[] {
	const count = suggestedPingCount(windowSeconds);
	const start = parseTime(DEFAULT_TIMES[0] ?? "05:00") ?? 5 * MINUTES_PER_HOUR;
	const windowMinutes = Math.max(1, Math.round(windowSeconds / 60));
	const times: string[] = [];
	for (let i = 0; i < count; i++) {
		times.push(formatTime(start + i * windowMinutes));
	}
	return normalizeTimes(times);
}

/** `"9h"` / `"5h"` / `"45m"` — a gap or window length, for display. */
export function formatDuration(minutes: number): string {
	if (minutes < MINUTES_PER_HOUR) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / MINUTES_PER_HOUR);
	const rest = minutes % MINUTES_PER_HOUR;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
