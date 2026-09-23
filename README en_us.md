# Monstrare

**English** | [繁體中文](README.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A cloneable workflow layer that stops AI coding agents from shipping non-trivial changes based on vague requirements.**

Copy this repo into any project. Claude Code, Codex, and other agentic tools
then follow the same gated process — spec, plan, task cards, implementation,
verification, review — before code reaches production.

## Preview

The kit ships a local, zero-dependency Kanban board (`tools/kanban/`, `npm run kanban`)
that visualizes every task's progress through the gates below.

![Kanban board](tools/kanban/docs/board-screenshot.png)
![Roadmap view](tools/kanban/docs/roadmap-screenshot.png)

## What This Fork Changes

Starting from Monstrare `a187710`, this repository adds a set of working system
improvements:

- Replaces the vertical roadmap list with an Epic navigator and a focused tree
  that supports zoom, pan, fit-to-view, and branch collapse.
- Adds keyboard and touch interaction, ARIA support, a responsive layout, and
  loading, empty, error, and read-only states.
- Adds local SSE synchronization so open tabs refresh after API writes, direct
  JSON edits, or git-style file replacement.
- Protects against reconnect failures, stale GET responses, and external updates
  overwriting unsaved modal input.
- Makes agent governance proportional to task size and risk instead of forcing
  every small change through the full specification workflow.
- Adds comprehensive Kanban and upgrader tests, retained UI evidence, and stable `npm test` and
  `npm run check` entry points.

See [`CUSTOMIZATIONS.md`](CUSTOMIZATIONS.md) for the complete change inventory,
affected files, verification steps, and known limitations. The completed tasks
have been removed from the active board; their specifications and evidence remain
under `ai/artifacts/看板體驗改善/` as historical records.

## The Problem

- Agents start coding from vague prompts and produce large, unreviewable diffs.
- "Looks right" ships without tests, screenshots, or evidence.
- Architecture and security get reviewed after the code is already written, if at all.
- Every project reinvents its own ad-hoc process for working with agents.

## How It Works

Every non-trivial change moves through these phases, defined in full in
`ai/process/workflow.md`:

| Phase | Output | Gate |
| --- | --- | --- |
| 0. Intake | Problem statement, goal, constraints, unknowns | Vague request -> go to Clarification |
| 1. Context Discovery | Task-specific context pack: files, patterns, risks, verification commands | — |
| 2. Clarification | `feature-spec.md`, non-goals, acceptance criteria | Human approval |
| 3. UI Mockup *(if UI)* | Screen/state maps, 2-3 variants, trade-offs | Human picks a variant |
| 4. Architecture Plan | Files touched, data/API contracts, rollback plan | High-risk -> architect + security + test review |
| 5. Task Cards | AI-ready cards meeting `definition-of-ready.md` | — |
| 6. Implementation | One approved card at a time, small diffs | Scope change -> stop and ask |
| 7. Verification | Tests, typecheck, lint, build, security scan, screenshots | — |
| 8. Review | Product / UX / architecture / security / test / code review | `review-gates.md` |
| 9. Human Acceptance | What changed, evidence, residual risk, follow-ups | No evidence -> not done |

New project with no Epic/User Story backlog yet? Run the `project-kickoff`
skill first — it splits the project into Epics -> User Stories -> Tasks and
seeds `tools/kanban/`.

## Design Quality: Two Layers

UI work is governed by two complementary layers — process alone produces
compliant-but-ugly screens, so the kit ships both:

1. **Design system (what to use)** — Epic 0 builds the design system in five
   human-gated stages (framework -> style direction -> design tokens ->
   component library -> page layouts), persisted to
   `ai/context/design-system.md`. Every later UI task must reuse those
   tokens/components; missing components are built in the same style and
   registered back into the inventory.
2. **Design craft (how to make it good)** — `ai/skills/design-craft.md`
   carries the visual-quality discipline (Refactoring UI principles, type
   scale, 4px spacing grid, layered color systems, depth rules, five
   interactive states) plus a curated list of high-quality open-source
   references to compare against before designing. Deliverables are checked
   against `ai/checklists/design-review-checklist.md`.

Both live in the repository, so every machine and every agent (Claude Code,
Codex, ...) that clones the repo gets the same design standard — no hidden
dependency on skills installed in someone's home directory.

## Rules Enforced On Every Agent

From `AGENTS.md`, read before any agent touches this repository:

- Small, explicit changes may be handled directly; ambiguous, cross-system, or
  non-trivial work uses the full governance workflow.
- Start with the smallest useful context search and reuse existing architecture,
  style, tokens, and components.
- Create tasks only when the board already tracks the work or the user requests it.
- New screens and major interaction flows need specs and mockups; small UI fixes
  may be implemented directly with proportionate verification.
- High-risk changes require security, backup, and rollback planning before any
  irreversible action.
- Preserve the user's existing work, avoid unrelated edits, and do not add
  production dependencies without explicit approval.
- Deliver tests, lint, builds, screenshots, or residual-risk notes in proportion
  to the change.

Agent output is never itself an approval — humans sign off at every gate in
`ai/process/review-gates.md`.

## What This Replaces

| Inspiration | Borrowed idea |
| --- | --- |
| BMAD Method | Role-based AI agile workflows |
| GitHub Spec Kit | Spec-first: clarify -> plan -> tasks -> implement |
| Kiro Specs | Requirements, design, and task artifacts |
| Task Master | PRD-to-task decomposition, model routing |
| Serena | Semantic project search and context retrieval |
| SuperClaude | Slash-command style repeatable workflows |
| Archon | Deterministic, gate-based workflow execution |
| Plandex | Large-context planning, diff review, controlled execution |
| CodeRabbit / Qodo | Review-first quality gates |

Not vendored — this kit is a process layer that can call or coexist with any
of them.

## Repository Layout

```text
AGENTS.md                     # Codex entrypoint
CLAUDE.md                     # Claude Code entrypoint
.claude/skills/               # Claude Code skills
.claude/agents/               # Claude Code subagents
.codex/skills/                # Codex skills
.codex/config.toml            # Optional Codex local defaults
ai/process/                   # Shared workflow rules
ai/templates/                 # Specs, task cards, review reports
ai/context/                   # Project map, design system, and search guides
ai/checklists/                # Security, testing, and design review gates
ai/skills/                    # Canonical skill content shared by .claude/skills and .codex/skills
ai/artifacts/                 # Completed specs, mockups, task cards, verification reports (one folder per Epic)
ai/examples/                  # Example task and feature artifacts
tools/kanban/                 # Local Kanban board implementing ai/process/kanban.md
CUSTOMIZATIONS.md             # Complete inventory of this fork's custom changes
```

## Quick Start

**Starting a new project?** Clone this repo and build directly inside it —
`AGENTS.md`, `CLAUDE.md`, and the whole `ai/` toolkit are already at the root.

```bash
git clone https://github.com/ttrrdfx/Monstrare.git my-project
cd my-project
rm -rf .git && git init   # start your own history
```

Then make it yours: replace `README.md`/`README en_us.md` with your own
project's readme, rename `package.json`'s `name`, and optionally delete
`scripts/install-into-project.sh` and the board-design history under
`tools/kanban/` (`mockups/`, `mockup-decision.md`, `screen-spec.md`) — those
belong to Monstrare itself, not your project.

Then open Claude Code or Codex in that folder and just describe what you want
to build:

```bash
claude
```

```text
I want to build an online booking system.
```

Since there's no Epic/User Story backlog yet, this triggers the
`project-kickoff` skill: it breaks the idea into Epics -> User Stories ->
Tasks and seeds `tools/kanban/`. Each task then walks through the phases in
[How It Works](#how-it-works) on its own.

**Adding this to an existing codebase instead?** Skip to
[Install Into An Existing Project](#install-into-an-existing-project) below,
then start from context discovery instead of `project-kickoff`:

```text
Use the project-search skill to create ai/context/project-map.md and ai/context/code-search-guide.md.
Do not implement anything yet.
```

```text
Use spec-interrogation for: <feature idea>.
Create a feature spec, screen specs if UI is involved, and AI-ready task cards.
Stop before implementation for human review.
```

## Install Into An Existing Project

```bash
scripts/install-into-project.sh /path/to/your/project
```

The equivalent direct command is:

```bash
node scripts/monstrare.mjs install /path/to/your/project
```

Copies process files, templates, checklists, Claude/Codex skills and agents,
the governance self-check, GitHub PR/issue templates, and the kanban tool
(minus Monstrare's own board-design history) into the target project.

Never overwritten: existing `AGENTS.md`, `CLAUDE.md`, `ai/context/` files,
`ai/artifacts/`, `.codex/config.toml`, and an existing `tools/kanban/`.
Always updated to the kit's latest version: `ai/process/`, `ai/templates/`,
`ai/checklists/`, `ai/skills/`, and the skill stubs — if you've locally
modified those kit files, commit before re-running the installer.

```bash
scripts/check-governance.sh   # self-check from the repo root
```

## Upgrade an Existing Installation

Node.js 20 or newer is required. Keep the new source and the target project in separate directories. Fetch and select the release first, then run the upgrader from that source checkout:

The local board's update flow accepts only the fixed-name `monstrare-vX.Y.Z.bundle.json` asset from a **published GitHub Release**, with its digest verified—not a draft, prerelease, or arbitrary checkout. Preview the dry run, inspect conflicts and backups, then confirm the apply separately; run verification and **restart the local board server** afterward. The CLI example below is the existing local-source upgrade path, not the source used by the board. Maintainer instructions for publishing and recovery are in [the release runbook](tools/kanban/docs/releasing.md).

```bash
monstrare_source=/absolute/path/to/Monstrare
target_project=/absolute/path/to/project

git -C "$monstrare_source" fetch --tags
git -C "$monstrare_source" checkout v1.0.0
node "$monstrare_source/scripts/monstrare.mjs" status "$target_project"
node "$monstrare_source/scripts/monstrare.mjs" upgrade "$target_project" --dry-run
node "$monstrare_source/scripts/monstrare.mjs" upgrade "$target_project"
node "$monstrare_source/scripts/monstrare.mjs" verify "$target_project"
```

`status` and `upgrade --dry-run` are read-only. The dry run lists `add`, `update`, `remove`, `preserve`, and `conflict` actions. A conflict returns exit code 1, and an actual `upgrade` stops before creating a lock or backup, without overwriting the customized file. Commit local work first, then choose whether to retain, port, or revert each conflicting file and rerun the dry run. The first release does not perform automatic merges.

A successful upgrade prints its `.monstrare/backups/<timestamp>-<from>-to-<to>/` path. `journal.json` records every `add`/`update`/`remove` and transaction state, `files/` contains pre-update or pre-removal copies, and `manifest.json` contains the prior manifest when the project already had one. Ordinary JavaScript failures roll back automatically and mark the journal `rolled-back`. After power loss, `SIGKILL`, or `rollback-failed`, stop writes and preserve the entire backup: copy every journal `update`/`remove` entry back from `files/`, delete paths recorded as `add`, then restore the backed-up manifest for an existing installation; for a legacy project that had no manifest, remove the newly written `.monstrare/manifest.json`. When migrations ran, also restore each declared scope from `migrations/<id>/snapshot.json`. Rerun `verify` and inspect the Git diff. The upgrader never runs `git reset`, `git clean`, or an automatic commit.

`verify` runs the governance self-check, `tools/kanban/*.test.mjs`, every CLI/server Node syntax check, and shell syntax checks in the target. A failed check or a missing script in an older project is named explicitly and returns a non-zero status. These tests are code from the target project and run with the current user's permissions; use `verify` only on a checkout you trust. It is not a sandbox.

## AI Kanban

`ai/process/kanban.md` is the board policy — it tracks whether a task is
ready for safe agent execution, not just its status. `tools/kanban/` is one
implementation of it: a zero-dependency local board that simplifies the
policy's 12 stages down to 6 lanes (Backlog -> Blocked -> Ready ->
Implementing -> Verify -> Done). The tool is optional; the policy doesn't
require it.

```bash
npm run kanban   # open http://127.0.0.1:4420
```

![Kanban board](tools/kanban/docs/board-screenshot.png)

- **Add a card** — click "+ 新增卡片" at the bottom of any lane; the server assigns the ID.
- **Move a card** — drag it into another lane to change its stage, or reorder it within a lane.
- **Edit details** — click a card to open its panel: owner, risk, agent, Readiness checklist, Review Gates, comments.
- **Track by Epic/User Story** — switch to the "藍圖" (Roadmap) tab and use
  the focused tree to zoom, pan, and collapse branches.
- **Stay synchronized** — tabs connected to the same local server refresh after
  API or JSON-file changes without overwriting unsaved modal input.

![Roadmap view](tools/kanban/docs/roadmap-screenshot.png)

Every action writes straight back to `cards/*.json` — no save button, no
database; `git commit`/`git push` is how state is persisted and shared. Full
schema and API reference: [`tools/kanban/README.md`](tools/kanban/README.md).

## Verification

Node.js 20 or later is required. There are no production dependencies.

```bash
npm test        # run all Kanban and upgrader tests
npm run check   # tests + all Node/shell syntax + governance-file integrity
```

## Maintainer Release Checklist

Only a maintainer explicitly publishes a release; this checklist never pushes or tags automatically.

- Update strict SemVer in both `VERSION` and `monstrare-package.json`, and confirm `minimumNode`.
- Review `managed`, `seedOnly`, `projectData`, and `sourceOnly` ownership. To keep supporting a prior manifest-less release, add and test its `scripts/manifests/` baseline before changing managed files.
- If the data schema changes, register a complete, continuous, rerunnable migration chain in `scripts/migrations/index.mjs`. Keep the registry empty when no data migration is required.
- Run `npm run check`; confirm legacy, conflict, project-data, fault-injection, migration, `verify`, and post-upgrade API E2E coverage passes.
- Check both READMEs' commands and local links, keeping version, backup, conflict, and recovery guidance in sync.
- Review the release diff and `git status`. Create an annotated tag manually (for example, `git tag -a v1.0.0 -m "Monstrare v1.0.0"`) and push it through the team's release process. Do not publish from the upgrader.
- Pushing the version tag triggers the GitHub Actions published-release bundle workflow. Before pushing, follow [the release runbook](tools/kanban/docs/releasing.md) for version, deterministic build, and asset digest checks; this checklist never creates or pushes a tag automatically.
