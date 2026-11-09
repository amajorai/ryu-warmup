import { describe, expect, it } from "bun:test";
import { formatMessage, type MessageValuesInput } from "@ryu/i18n/core";
import { usedWindowText } from "./usage-status.ts";

const english = (source: string, values: MessageValuesInput) =>
	formatMessage(source, values, "en");

/** A French catalog that knows the one message under test. */
const french = (_source: string, values: MessageValuesInput) =>
	formatMessage("{windowLabel} · {usedPercent} utilisés", values, "fr");

describe("usedWindowText", () => {
	it("reads as before in English", () => {
		expect(
			usedWindowText({ label: "5h", usedPercent: 41.6 }, english, "en")
		).toBe("5h · 42% used");
	});

	it("formats the percent for the reader's locale", () => {
		const text = usedWindowText(
			{ label: "5 h", usedPercent: 42 },
			french,
			"fr"
		);
		// French puts a (narrow) no-break space before the percent sign.
		expect(text).toMatch(/^5 h · 42\s%\sutilisés$/u);
		expect(text).not.toContain("42%");
	});

	it("never shows a negative percent", () => {
		expect(
			usedWindowText({ label: "5h", usedPercent: -3 }, english, "en")
		).toBe("5h · 0% used");
	});
});
