import { describe, expect, it } from "bun:test";
import {
	ASSUMED_WINDOW_SECONDS,
	cronForTime,
	DEFAULT_TIMES,
	formatDuration,
	formatTime,
	gapsBetween,
	normalizeTimes,
	parseTime,
	suggestedPingCount,
	suggestTimes,
	timeFromCron,
	uncoveredGaps,
} from "./windows.ts";

describe("parseTime / formatTime", () => {
	it("round-trips a time of day", () => {
		expect(parseTime("05:00")).toBe(300);
		expect(parseTime("20:30")).toBe(1230);
		expect(formatTime(300)).toBe("05:00");
		expect(formatTime(1230)).toBe("20:30");
	});

	it("accepts a single-digit hour and pads it back", () => {
		expect(parseTime("5:00")).toBe(300);
		expect(formatTime(parseTime("5:00") as number)).toBe("05:00");
	});

	it("rejects anything that is not a time of day", () => {
		expect(parseTime("24:00")).toBeNull();
		expect(parseTime("10:60")).toBeNull();
		expect(parseTime("noon")).toBeNull();
		expect(parseTime("")).toBeNull();
	});
});

describe("normalizeTimes", () => {
	it("sorts, de-duplicates across formats, and drops junk", () => {
		expect(normalizeTimes(["20:00", "5:00", "05:00", "nope", "10:00"])).toEqual(
			["05:00", "10:00", "20:00"]
		);
	});
});

describe("cronForTime / timeFromCron", () => {
	it("builds the daily cron for a time and reads it back", () => {
		expect(cronForTime("05:00")).toBe("0 5 * * *");
		expect(cronForTime("20:30")).toBe("30 20 * * *");
		expect(timeFromCron("0 5 * * *")).toBe("05:00");
		expect(timeFromCron("30 20 * * *")).toBe("20:30");
	});

	it("refuses to read a cron that is not a plain daily time", () => {
		// These are legitimate schedules; they are just not something the page
		// can represent as a time-of-day chip, so it must not guess.
		expect(timeFromCron("*/5 * * * *")).toBeNull();
		expect(timeFromCron("0 5 * * 1")).toBeNull();
		expect(timeFromCron("0 5 1 * *")).toBeNull();
		expect(timeFromCron("nonsense")).toBeNull();
	});

	it("throws rather than emitting a cron for an invalid time", () => {
		expect(() => cronForTime("25:00")).toThrow();
	});
});

describe("gapsBetween", () => {
	it("returns nothing to compare for zero or one time", () => {
		expect(gapsBetween([])).toEqual([]);
		expect(gapsBetween(["05:00"])).toEqual([]);
	});

	it("wraps the last gap across midnight and flags it", () => {
		const gaps = gapsBetween(DEFAULT_TIMES);
		expect(gaps.map((g) => g.minutes)).toEqual([300, 300, 300, 540]);
		expect(gaps.map((g) => g.overnight)).toEqual([false, false, false, true]);
		expect(gaps[3]).toMatchObject({ from: "20:00", to: "05:00" });
	});
});

describe("uncoveredGaps", () => {
	it("does not flag the shipped defaults", () => {
		// The 9h overnight gap is the intended shape — a 01:00 ping would open a
		// window that expires before the working day. A checker that called the
		// recommended configuration invalid would be worse than no checker.
		expect(uncoveredGaps(DEFAULT_TIMES, ASSUMED_WINDOW_SECONDS)).toEqual([]);
	});

	it("flags every waking stretch longer than the window", () => {
		const gaps = uncoveredGaps(
			["05:00", "13:00", "20:00"],
			ASSUMED_WINDOW_SECONDS
		);
		// 05:00→13:00 is 8h and 13:00→20:00 is 7h; both outlast a 5h window.
		// 20:00→05:00 is overnight and never flagged.
		expect(gaps.map((g) => [g.from, g.to, g.minutes])).toEqual([
			["05:00", "13:00", 480],
			["13:00", "20:00", 420],
		]);
	});

	it("stops flagging once the window is long enough to bridge it", () => {
		const eightHours = 8 * 60 * 60;
		expect(uncoveredGaps(["05:00", "13:00", "20:00"], eightHours)).toEqual([]);
	});
});

describe("suggestedPingCount / suggestTimes", () => {
	it("suggests exactly the shipped defaults for a 5h window", () => {
		// The defaults are this function's output, so the two cannot drift.
		expect(suggestedPingCount(ASSUMED_WINDOW_SECONDS)).toBe(4);
		expect(suggestTimes(ASSUMED_WINDOW_SECONDS)).toEqual([...DEFAULT_TIMES]);
	});

	it("asks for fewer pings on a longer window and more on a shorter one", () => {
		expect(suggestedPingCount(10 * 60 * 60)).toBeLessThan(
			suggestedPingCount(ASSUMED_WINDOW_SECONDS)
		);
		expect(suggestedPingCount(3 * 60 * 60)).toBeGreaterThan(
			suggestedPingCount(ASSUMED_WINDOW_SECONDS)
		);
	});

	it("never suggests zero pings, however long the window", () => {
		expect(suggestedPingCount(7 * 24 * 60 * 60)).toBe(1);
		expect(suggestTimes(7 * 24 * 60 * 60)).toEqual(["05:00"]);
	});
});

describe("formatDuration", () => {
	it("renders hours and minutes the way the gaps read", () => {
		expect(formatDuration(45)).toBe("45m");
		expect(formatDuration(300)).toBe("5h");
		expect(formatDuration(540)).toBe("9h");
		expect(formatDuration(330)).toBe("5h 30m");
	});
});
