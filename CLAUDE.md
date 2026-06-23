# ArcAdmin — Builder Portal (repo: arcos-admin)

> Drop this in the repo root as `CLAUDE.md`. Review and prune before committing.
> Target ~200 lines; split overflow into `.claude/rules/*.md` if it grows.

## What this is
The **builder portal** at `admin.arcnode.app` — the B2B side of ArcNode. Van/RV
builders use it to manage their company, clients, vehicles, and per-vehicle config.
Vanilla-JS single-page app, deployed on **Vercel**, backed by the shared Supabase
project.

## Working agreement for Claude Code
- **Edit files in place with targeted diffs.** No full-file regeneration.
- Work on a branch off a clean tree. Show diffs; never auto-push.

## Naming
- Always write **"ArcNode"** in anything user-facing. "ArcOS" lives only in legacy
  code identifiers — don't surface it in UI or copy.

## Backend
- Shared Supabase project: `agpsalkaajjivoytcipb` (`agpsalkaajjivoytcipb.supabase.co`).
- This portal touches the same schema the iPad app uses — be careful with migrations;
  changes here can affect `profiles` / `subscriptions` / `vehicles` / `daily_summaries`
  and the iPad's expectations.

## Known flows & fixes (don't regress)
- **Onboarding**: completed via the `complete_onboarding` RPC (fixes the onboarding
  race condition). Don't reintroduce client-side multi-write onboarding.
- **Company admin flow**: prior fixes covered sidebar routing, client count, the
  invite-flow retry loop, the set-password page, and a session collision. Re-check
  these areas after edits.
- **Battery capacity**: wired from build lines → per-vehicle overrides. Per-vehicle
  override wins.
- **FK cascade migrations** are in place — respect cascade behavior on deletes.
- **Custom company logos** and **mobile-responsive layout** shipped — keep responsive.

## Global Manuals RAG
- 24 Victron PDFs processed into ~655 chunks.
- Use `match_document_chunks_v2` (filter corrected). The
  `document_chunks_scope_exclusive` constraint is in place.
- **RAG working path is a direct `client.rpc()` call.** The `embed-query` Edge
  Function returns empty chunks — do not route retrieval through it.

## Cerbo API keys
- Per-vehicle keys via Postgres trigger `generate_cerbo_api_key`; RPCs
  `get_cerbo_api_key` / `rotate_cerbo_api_key`; auth log. Legacy shared-key fallback
  retired.

## Git
- `cd ~/Desktop/ArcOS-iPad/arcos-admin && git add -A && git commit -m "message" &&
  git push`.
- Stay scoped to this directory — never `git add .` from the parent `ArcOS-iPad` root.

## People
- Co-founders: Chrissy, Jim, Santiago (Arc Energy Labs, Inc., San Diego).
- Alison is Chrissy's partner, NOT in the business — never in marketing/external copy.
