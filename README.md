# Pi Town

**Multi-agent orchestration system for Pi**

Pi Town is a local-first orchestration system for running Pi against real repositories with durable run state, private plans, and inspectable artifacts.

It is **inspired by [Gas Town](https://github.com/steveyegge/gastown)** and the broader day-shift / night-shift model, but built for the **Pi ecosystem**, implemented in **TypeScript/Node**, and designed around a simpler local-first architecture.

> **Experimental:** Pi Town is still in an early experimental phase. It is not yet production-ready and is not yet recommended for unattended real-world usage without close oversight.

## Overview

Pi Town is for a workflow where humans do the high-leverage work during the day, and agents do bounded execution during the night.

### Day shift
Humans:
- gather requirements
- define goals
- write specs and private plans
- make architectural decisions
- improve tests and validations
- review what the agent produced

### Night shift
Pi Town + Pi:
- load context
- read private plans
- work inside the target repo
- persist durable local run artifacts
- summarize progress, output, and blockers

The goal is not to babysit a fragile live loop.
The goal is to come back to understandable progress, durable evidence, and a system that can improve over time.

## What problem does this solve?

| Challenge | Pi Town approach |
| --- | --- |
| Agent context disappears between runs | Persist local run state and artifacts on disk |
| Private planning should stay out of public repos | Use `--plan` and user-owned local plan directories |
| Orchestration state should not pollute product repos | Store runtime state under `~/.pi-town` |
| You want to point the tool at arbitrary repos | Use explicit `--repo` targeting |
| You want a Pi-native external runner | Spawn one real Pi invocation from `pitown run` |

## Why Pi Town exists

Pi Town takes inspiration from Gas Town's durable, local-first orchestration model, but intentionally does **not** try to copy Gas Town's implementation stack.

Pi Town is:
- **Pi-native** instead of Claude Code-native
- **TypeScript/Node** instead of Go
- **local filesystem-first** instead of requiring heavier infrastructure
- **repo-agnostic** by default, using `--repo` and `--plan`
- **single-run / single-session** in the MVP instead of multi-agent from day one

For the current MVP, Pi Town is intentionally simple:
- one CLI: `pitown`
- one target repo at a time
- one real Pi subprocess invocation
- one durable local run record
- no Docker backend yet
- no OpenViking dependency yet
- no multi-agent system yet

## Quick start

### Run from source today

```bash
pnpm install
pnpm build
pnpm pitown -- --help
```

Run Pi Town against any local repository:

```bash
pitown run \
  --repo /path/to/repo \
  --plan /path/to/private/plans \
  --goal "continue from current scaffold state"
```

Check the latest local run:

```bash
pitown status
```

Or status for a specific repo:

```bash
pitown status --repo /path/to/repo
```

### Planned public install target

The intended npm install target is:

```bash
npm install -g @schilderlabs/pitown
```

Homebrew support is planned later.

## Core concepts

### Pi Town home
Pi Town stores local runtime state in a user-owned directory:

```text
~/.pi-town/
```

### Target repo
Pi Town works against an arbitrary local repository passed explicitly with:

```bash
--repo /path/to/repo
```

### Private plans
Private plans stay outside the target repo and can be passed explicitly with:

```bash
--plan /path/to/private/plans
```

If no plan path is configured, Pi Town recommends a local private location such as:

```text
~/.pi-town/plans/<repo-slug>/
```

### Durable run artifacts
Each run writes durable local artifacts under a repo-scoped location such as:

```text
~/.pi-town/repos/<repo-slug>/runs/<run-id>/
```

Including files such as:
- `manifest.json`
- `run-summary.json`
- `pi-invocation.json`
- `events.jsonl`
- `stdout.txt`
- `stderr.txt`
- `questions.jsonl`
- `interventions.jsonl`
- `agent-state.json`

## Architecture snapshot

```text
You
 └─ pitown
     ├─ reads config from ~/.pi-town/config.json
     ├─ resolves --repo / --plan / --goal
     ├─ creates a local run directory under ~/.pi-town/repos/<repo-slug>/
     ├─ invokes Pi once against the target repo
     └─ persists run artifacts for later inspection
```

## Local-first runtime layout

```text
~/.pi-town/
  config.json
  latest-run.json
  plans/
    <repo-slug>/
  repos/
    <repo-slug>/
      latest/
      latest-run.json
      runs/
        <run-id>/
          manifest.json
          run-summary.json
          pi-invocation.json
          events.jsonl
          stdout.txt
          stderr.txt
          questions.jsonl
          interventions.jsonl
          agent-state.json
```

## Packages

### `@schilderlabs/pitown`
The primary CLI package. Exposes the `pitown` command.

### `@schilderlabs/pitown-core`
Shared orchestration primitives, repo identity helpers, metrics helpers, and run artifact types.

### `@schilderlabs/pitown-package`
Optional Pi package resources for deeper Pi integration later.

## Monorepo shape

```text
packages/
  eslint-config/     shared workspace ESLint config
  typescript-config/ shared workspace TypeScript config
  core/              orchestration and runtime primitives
  cli/               installable CLI
  pi-package/        optional Pi package resources
skills/
  public/            public repo-owned shared skills
```

## Current status

Pi Town is in the early local-first orchestration phase.
It should currently be understood as an experimental scaffold, not yet a mature production workflow system.

Current focus:
- external runner model
- explicit repo and plan targeting
- first real Pi invocation
- durable local artifacts
- public-safe repo structure

Planned later:
- supervision and intervention workflows
- richer Pi package integration
- improved publishing and distribution
- possible Homebrew install
- more advanced execution backends

## Notes

- detailed working plans are intentionally kept outside the repo
- runtime state defaults to `~/.pi-town`
- target repos do not need to install Pi Town for the MVP
- private plan contents should not be copied into public-safe artifacts by default
