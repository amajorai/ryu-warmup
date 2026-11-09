// The "<window> · <percent> used" line under a warmup agent or login. The
// percent goes through the host locale's percent format ("42%", "42 %",
// "٪٤٢"), so the sign and spacing follow the reader's language instead of a
// hand-built "%".

import {
	activeLocale,
	type MessageValuesInput,
	translate,
} from "@ryu/i18n/core";
import { formatPercent } from "@ryu/i18n/format-percent";

/** The part of a usage window the status line reads. */
export interface UsedWindow {
	label: string;
	/** Percent of the window already used, 0-100. */
	usedPercent: number;
}

type Translate = (source: string, values: MessageValuesInput) => string;

/** "5-hour window · 42% used", translated as one message. */
export function usedWindowText(
	window: UsedWindow,
	tl: Translate = translate,
	locale: string = activeLocale()
): string {
	const ratio = Math.max(0, window.usedPercent) / 100;
	return tl("{windowLabel} · {usedPercent} used", {
		windowLabel: window.label,
		usedPercent: formatPercent(ratio, 0, locale),
	});
}
