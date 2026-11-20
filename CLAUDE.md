# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repository is at the concept stage. It contains no source code, build system, package manifest, or tests, and it is not a git repository yet. The only content is:

- `dev_tools_definition.md` — the project definition, written in Korean. It is an unfinished draft (the text stops mid-sentence).
- `docs/` — empty.

There are no build, lint, or test commands yet. Do not assume a language, framework, or directory layout; none has been chosen. When one is introduced, update this file with the real commands.

## What the project is meant to be

Per `dev_tools_definition.md`, the goal is a tool for multiple developers working on one project at the same time, each using generative AI coding tools (Codex, Claude, KIMI, etc.):

- **Dev_Dashboard**: a real-time view of project status across all developers and their AI tools.
- **Gap detection**: AI is used to identify which parts of the project are missing or unowned.
- **Human-decided assignment**: a developer sees a gap on the dashboard, claims it, completes it, then moves on to the next part. The human decides what to take on; the AI surfaces the gaps and does not assign work.

Treat this as the intent, not a spec. The definition is incomplete, so confirm scope with the user before making architectural decisions that depend on details it does not state.

## Conventions

- Project documentation is written in Korean. Keep additions to `dev_tools_definition.md` and `docs/` in Korean unless told otherwise.
