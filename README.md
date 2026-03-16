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

Start with the mayor from inside a repo:

```bash
cd /path/to/repo
pitown
pitown mayor
```

Or send the mayor a one-off planning message:

```bash
cd /path/to/repo
pitown mayor "plan the next milestones for this repository"
```

If you are already inside a repo, you usually do not need `--repo`. Pi Town will use the current working repo when possible.

Run Pi Town explicitly against any local repository:

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

### Mayor
The main human-facing Pi agent is the **mayor**.

- `mayor` is the user-facing name
- internally it is implemented as the `leader` agent role
- the mayor owns planning, delegation, and status summaries
- workers, reviewers, and other roles are coordinated underneath the mayor

The intended default workflow is:

1. `cd` into a repo
2. run `pitown` or `pitown mayor`
3. use `/plan` inside the mayor session when you want read-only planning first
4. let the mayor delegate to other Pi Town agents when needed

Inside the mayor session:

- `/plan` toggles read-only planning mode
- `/todos` shows the current captured plan
- turning `/plan` off returns the mayor to normal execution and delegation mode

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
 └─ pitown mayor
     ├─ resolves the current repo or --repo override
     ├─ opens the persisted mayor Pi session for that repo
     ├─ gives the mayor Pi Town orchestration tools
     ├─ lets the mayor delegate to workers/reviewers
     └─ persists board, mailbox, session, and task state under ~/.pi-town/repos/<repo-slug>/
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
      agents/
        leader/
          state.json
          session.json
          inbox.jsonl
          outbox.jsonl
          sessions/
        worker-001/
          state.json
          session.json
          inbox.jsonl
          outbox.jsonl
          sessions/
      tasks/
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

## Command guide

```bash
pitown
pitown mayor
pitown mayor "plan the next milestones"
/plan
/todos
pitown msg mayor "focus on the auth regression"
pitown board
pitown peek mayor
pitown delegate --task "fix callback regression"
pitown attach mayor
pitown continue mayor "follow up on the open blockers"
```

The intended conversational loop is:

1. start `pitown`
2. talk to the mayor about the repo
3. enter `/plan` if you want the mayor to stay in read-only planning mode
4. review the numbered plan with `/todos`
5. leave `/plan` when you want the mayor to execute and delegate work

What these do:

- `pitown mayor` opens the main planning/coordinator session
- `pitown msg mayor "..."` sends one non-interactive message and runs one turn
- `pitown board` shows what the town is doing
- `pitown peek mayor` inspects the mayor state and mailbox
- `pitown attach mayor` reopens the interactive mayor Pi session
- `pitown continue mayor "..."` resumes the mayor session with a new message

## Current status

Pi Town is in the early local-first orchestration phase.
It should currently be understood as an experimental scaffold, not yet a mature production workflow system.

Current focus:
- mayor-first orchestration
- persistent Pi sessions per agent
- durable board, mailbox, and task artifacts
- explicit repo and plan targeting
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
