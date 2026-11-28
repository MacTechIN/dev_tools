# AGENTS.md

Guidance for AI coding agents (Codex and others) working in this repository.

## Current state

Planning documents live at the repository root and in `docs/`. Product code lives in `webapp/`, which builds and deploys on its own. Development is in phase 1 of `development_plan.md` (see its "진행 현황" table for what is done and what remains).

`docs/decisions.md` is the source of truth for what is decided (D-xx), which tools were chosen (T-xx), and what is still open (O-xx). Check it before making a choice that a decision covers, and confirm with the user before settling anything listed as open. D-26 (release automation) is confirmed; the first cloud storage and mail provider is still open and will be confirmed once chosen.

Keep `CLAUDE.md` identical in substance to this file.

## Commands

Run from `webapp/` (Node.js 22+, npm workspaces):

```bash
npm install
npm run dev:server        # API on :4100; needs ADMIN_ID and ADMIN_PASSWORD (8+ chars) on first start
npm run dev:web           # Vite on :5173, proxies /api to :4100
npm test                  # all workspaces
npm test -w @devtools/server -- auth              # one test file (name filter)
npm test -w @devtools/server -- -t "REQ-ADM-008"  # tests for one requirement
npm run typecheck
npm run build             # web, then the devtools CLI bundle, then server (tsup)
npm start                 # runs apps/server/dist/index.js, also serves the built web
PASSWORD=<admin pw> npm run sample-events   # fills the dashboard with sample activity
node packages/cli/dist/devtools.mjs connect --server http://localhost:4100   # connect this machine's AI tools
docker compose up -d --build
```

There is no linter yet (ESLint/Prettier are planned, T-06).

## What the project is

A collaboration tool for several developers building one project at the same time, each using a generative AI coding tool (Codex, Claude, KIMI, etc.):

- **Dev_Dashboard**: real-time view of project status across all developers and their AI tool sessions.
- **Gap detection**: AI compares the spec with the code and surfaces missing parts as candidates with evidence.
- **Human-decided claiming**: a developer confirms a gap, claims it, completes it, and moves on. AI never assigns work.
- **Team chat**: one project-wide chat panel docked on every screen; human messages only.
- **Release and delivery**: a release recipe (`release.yml`) executed by a runner on the delivery owner's machine or in CI; a human approves before anything reaches the customer.

Invariants that shape the design:

- The server observes AI coding tools (via their hooks) and exposes functions to them (via MCP). It does not run or orchestrate them.
- The server never builds, deploys, or opens remote connections. Release steps run in the runner, outside the server.
- Two kinds of authentication must not be mixed: members log in to dev_tools with an ID and password; each member authenticates their own AI coding tool with that vendor's account, and dev_tools never receives or stores those credentials. Customer server addresses, accounts, and keys are never stored either.
- Humans decide: claiming, completion approval, and release approval have no automatic path.
- Team size is not fixed (starts at 2); do not hard-code member counts.

## Architecture (`webapp/`)

- `packages/shared` — the common event format as zod schemas (`events.ts`), the status derivation rules (`status.ts`), and types shared by server and web. It ships TypeScript source; the server bundles it with tsup, and Vite/Vitest read it directly.
- `apps/server` — Fastify + better-sqlite3 (hand-written SQL, migrations in `db.ts` keyed on `user_version`). `store.ts` holds all database access and is an EventEmitter: every `addChange` appends to the `changes` table and emits to open SSE streams. `app.ts` wires auth in one `preHandler` hook using three route sets (public, device-token-allowed, allowed-before-password-change); a new route is login-protected by default and unreachable with a device token unless added to `DEVICE_ALLOWED`.
- `packages/adapters` — pure functions converting each AI tool's hook payload into common events, plus real hook payloads recorded from each tool version under `<tool>/fixtures/`. No I/O.
- `packages/cli` — the `devtools` command (`connect`, `disconnect`, `status`, and `hook`, which the AI tools' command hooks run). It does all file, git and network work, bundles into one file (`dist/devtools.mjs`), and the server serves it at `/devtools.mjs`. A hook call only appends to a local queue and spawns a detached `flush`; it never waits on the network, never prints, and always exits 0.
- `apps/web` — React without a router. `live.ts` loads `/api/snapshot` once and then applies `member`/`feed` changes from `/api/stream` (SSE, resumed with `Last-Event-ID`). All UI text is in `strings.ts`.
- Events: the conversion happens on the developer's machine (D-28), because the tools' hook payloads contain prompt text, file contents and replies. Adapters must emit only paths, categories and ids; the server schema also strips unknown keys as a second guard. Do not loosen either. Claude Code hooks go in the project's `.claude/settings.local.json`; Codex hooks go in the user's `~/.codex/hooks.json` (Codex has no personal per-project file) and the hook ignores unconnected projects. Never write Codex's hook trust state for the user.
- The status shown for a work item is derived from two axes (implementation status, ownership status) and never stored.

`docs/tech_design.md` describes the full target design; its section 18 lists what is implemented, and section 19 lists what has and has not been verified against the real AI tools (Codex tool-event payloads are still unverified).

## Documents

All planning documents are in Korean. `README.md` lists them in reading order. The ones most often needed:

- `docs/requirements.md` — 132 requirements with permanent IDs (`REQ-<AREA>-<NNN>`), priority, and phase.
- `docs/tech_design.md` — architecture, event format, data model, claim rules, API, MCP tools, release runner.
- `docs/release_delivery.md` — release automation: recipe format, where the runner executes, safety rules, automation levels.
- `docs/conventions.md` — branch/commit/test naming, AI tool usage rules, definition of done.
- `docs/decisions.md` — decision log. Append rows; mark superseded ones instead of deleting them.
- `research.md` — background survey. Items marked [미확인] were not verified.

## Conventions

- Planning documents and UI text are Korean; code, identifiers, and comments are English.
- UI wording follows the plain-language terms in `docs/ui_concept.html` section 1 (갭 → "빈 곳", claim → "맡기").
- Requirement IDs are permanent. Every test name starts with the requirement ID it verifies; branch names are `req/<ID>-<short-desc>`; commit subjects are English imperative with the ID in parentheses.
- When implementation changes structure, API, or status, update `docs/tech_design.md` (including section 18) and the progress table in `development_plan.md` in the same change.
- Mark unverified claims as [미확인] and label estimates as estimates.
- Commits use a repo-local git identity with a GitHub noreply address, because the remote (`MacTechIN/dev_tools`) is public.
