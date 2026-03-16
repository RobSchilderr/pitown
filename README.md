# Pi Town

<img width="750" height="500" alt="pitown" src="https://github.com/user-attachments/assets/7cc303b7-ae9a-4fa7-ac8d-a68588cc5abb" />


**Multi-agent orchestration system for Pi**

Pi Town is a local-first orchestration system for running Pi against real repositories with durable run state, private plans, and inspectable artifacts.

It is **inspired by [Gas Town](https://github.com/steveyegge/gastown)** and the broader day-shift / night-shift model, but built for the **Pi ecosystem**, implemented in **TypeScript/Node**, and designed around a simpler local-first architecture.

> **Experimental:** Pi Town is still in an early experimental phase. It is not yet production-ready and is not yet recommended for unattended real-world usage without close oversight.

## Why Pi Town exists

Pi Town is:
- **Pi-native** orchestration for Pi agents
- implemented in **TypeScript/Node**
- **local filesystem-first**
- **repo-agnostic** by default, using `--repo` and `--plan`

## Prerequisites

Pi Town currently uses the `pi` CLI as its execution engine.

Before using `pitown run`, make sure Pi is installed and authenticated.

### Install Pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

### Verify Pi works

Configure Pi for your preferred provider or account, then verify it works:

```bash
pi -p "hello"
```

## Quick start

### Check your Pi setup

Before running Pi Town work, verify Pi is ready:

```bash
pitown doctor
```

If Pi is installed but not authenticated yet, authenticate it first by making `pi -p "hello"` work.

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
