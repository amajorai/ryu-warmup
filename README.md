# ryu-warmup

Warmup for Ryu — keeps your subscription agents' rolling usage windows open: a one-word ping to each agent, on its cheapest model, at the local times you choose, so a window is already running when you start work.

> **The public home of `ryu-warmup`.** Source, builds, and releases live here —
> binaries for every platform are attached to each release.
>
> This tree is generated from the Ryu monorepo, so commits pushed here
> directly are replaced on the next sync. **Pull requests are welcome** —
> open them here and they are ported into the monorepo, then flow back out.
> Ryu as a whole: https://github.com/amajorai/ryu

## Source & build

This is the **source of record** for the app UI. It imports Ryu's private
`@ryu/ui` design system, so it does **not** build standalone outside the
monorepo — it **builds inside the amajorai/ryu monorepo workspace**.
The **shipped bundle below is the built artifact**: a prebuilt single-file
companion bundle is included at [`dist/warmup.ui.html`](./dist/warmup.ui.html) —
the runnable UI Ryu loads for this app.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

---

# Warmup

Starts your subscription agents' rolling usage windows on your own schedule.

Claude, Codex, Copilot, Grok and GLM subscriptions meter usage in a **rolling
window** — commonly 5 hours — that begins at your *first* message, not at a fixed
hour. Sit down at 09:00 and your window runs 09:00–14:00; the next one only
starts whenever you next send something. Warmup sends a one-word message at times
you choose, so a window is already open and its boundaries fall where you want
them.

## What it schedules

One scheduled job per agent per time of day, created through Core's scheduler
(`/heartbeat/jobs`) with an `agent` target. They appear in the Calendar app
alongside everything else you have scheduled.

Defaults: **05:00, 10:00, 15:00, 20:00** local.

The daytime spacing is one window-length apart, so each ping covers the run-up to
the next. The 9-hour overnight gap is deliberate: a 01:00 ping opens a window
that expires around 06:00, leaving the morning uncovered — 05:00 is the one still
open when you start. Warmup will flag a *daytime* gap longer than the window, and
never flags the overnight one.

Agents reporting a window longer or shorter than 5 hours get a matching
suggestion (`Use N evenly spaced`); the schedule is built on Core's cron
primitive, so you can add as many times as you like.

## Cheapest model

Subscription caps weight usage by model, so a ping on the flagship model spends
the window it was meant to preserve. Warmup ranks the models each agent
advertises (ACP `session/new`) and preselects the cheapest — Haiku over Sonnet
over Opus, `low` effort over `high`. The pick is shown and overridable per agent.

The model is pinned **per turn** (`JobTarget::Agent.model`), exactly as the chat
composer's model picker does. Your agent's own configuration is untouched.

## Time zone

Ping times are wall-clock times in your zone, stored as an IANA name on the job
(`Schedule::Cron.tz`) and evaluated against live zone rules. A time chosen to sit
a fixed distance from a rate-limit boundary would otherwise drift an hour twice a
year at every DST transition.

## Turning it off

Warmup's jobs record `ownerApp: "com.ryu.warmup"`, and Core's tick loop resolves
the owning app before running an app-created job. So:

- **Disable** pauses the pings. The jobs stay, and re-enabling restores exactly
  the schedule you had.
- **Uninstall** deletes them. It is the stronger statement, and a schedule that
  quietly came back on reinstall would not be one you had agreed to.
- **Clearing every agent and saving** deletes them too, without touching the app.

## Storage

None. The scheduled jobs *are* the configuration: agent, model, times, zone and
message are all read back off the jobs, so the page and what is actually
scheduled cannot disagree. Core has no update route for jobs, so saving replaces
this app's jobs — which resets their run history.
