// The times-of-day editor: the chips that decide when a ping fires.
//
// Times are shared across every selected agent — one schedule, several agents —
// because the thing being scheduled is the user's day, not the agent's. Per-agent
// times would be four pickers to answer one question.

import { Badge } from "@ryu/ui/components/badge.tsx";
import { Button } from "@ryu/ui/components/button.tsx";
import { Input } from "@ryu/ui/components/input.tsx";
import { Label } from "@ryu/ui/components/label.tsx";
import { useState } from "react";
import {
	DEFAULT_TIMES,
	formatDuration,
	normalizeTimes,
	parseTime,
	suggestTimes,
	uncoveredGaps,
} from "./lib/windows.ts";

export interface TimesEditorProps {
	onChange: (times: string[]) => void;
	times: string[];
	/**
	 * The shortest window any selected agent reports, used to check coverage and
	 * to offer a matching set of times. `null` when nothing reported one.
	 */
	windowSeconds: number | null;
}

export function TimesEditor({
	onChange,
	times,
	windowSeconds,
}: TimesEditorProps) {
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);

	const gaps = uncoveredGaps(times, windowSeconds ?? undefined);
	const suggested = windowSeconds ? suggestTimes(windowSeconds) : DEFAULT_TIMES;
	const matchesSuggestion =
		normalizeTimes(times).join(",") ===
		normalizeTimes([...suggested]).join(",");

	function add() {
		const value = draft.trim();
		if (!value) {
			return;
		}
		if (parseTime(value) === null) {
			setError(`'${value}' is not a time of day — use HH:MM, like 05:00.`);
			return;
		}
		setError(null);
		setDraft("");
		onChange(normalizeTimes([...times, value]));
	}

	return (
		<div>
			<Label className="text-xs">Ping times</Label>
			<p className="mt-1 text-muted-foreground text-xs">
				Local clock times. Each one starts a fresh usage window.
			</p>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				{times.length === 0 ? (
					<span className="text-muted-foreground text-xs">No times yet.</span>
				) : null}
				{times.map((time) => (
					<Badge className="gap-1 pr-1" key={time} variant="secondary">
						{time}
						<Button
							aria-label={`Remove ${time}`}
							className="size-4 p-0 text-muted-foreground hover:text-foreground"
							onClick={() => onChange(times.filter((t) => t !== time))}
							size="sm"
							type="button"
							variant="ghost"
						>
							×
						</Button>
					</Badge>
				))}
			</div>

			<div className="mt-3 flex items-start gap-2">
				<div>
					<Input
						aria-label="Add a ping time"
						className="w-28"
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								add();
							}
						}}
						placeholder="HH:MM"
						value={draft}
					/>
					{error ? (
						<p className="mt-1 text-destructive text-xs">{error}</p>
					) : null}
				</div>
				<Button onClick={add} size="sm" type="button" variant="outline">
					Add
				</Button>
				{matchesSuggestion ? null : (
					<Button
						onClick={() => onChange(normalizeTimes([...suggested]))}
						size="sm"
						type="button"
						variant="ghost"
					>
						Use {suggested.length} evenly spaced
					</Button>
				)}
			</div>

			{gaps.length > 0 ? (
				<p className="mt-3 text-muted-foreground text-xs">
					{gaps
						.map(
							(g) =>
								`${g.from}–${g.to} is ${formatDuration(g.minutes)}, longer than the window`
						)
						.join("; ")}
					. The overnight gap is intentional — a middle-of-the-night ping opens
					a window that expires before you start work.
				</p>
			) : null}
		</div>
	);
}
