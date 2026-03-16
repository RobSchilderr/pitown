# Pi Town

<img width="750" height="500" alt="pitown" src="https://github.com/user-attachments/assets/7cc303b7-ae9a-4fa7-ac8d-a68588cc5abb" />

Multi-agent orchestration layer built on top of [Pi](https://shittycodingagent.ai/).

Pi is the single-agent coding CLI. Pi Town adds multi-agent coordination, persistent sessions, autonomous loops, and durable state.

## Credits

Pi Town is built on top of Pi. Credit to [Mario Zechner](https://github.com/badlogic) and the Pi project for the underlying coding agent runtime Pi Town orchestrates.

Pi Town was also inspired by [Gastown](https://github.com/steveyegge/gastown). Credit to [Steve Yegge](https://github.com/steveyegge) for pushing on multi-agent orchestration ideas that made this project worth exploring.

> **Experimental:** Pi Town is in early development. Not yet recommended for unattended usage without close oversight.

## Pi Town vs Pi

| | Pi | Pi Town |
|---|---|---|
| Agents | Single | Multi-agent (mayor, workers, reviewers, etc.) |
| Sessions | Ephemeral or manual | Persistent per agent, auto-resumed |
| Coordination | None — one agent, one task | Mayor delegates to workers/reviewers via board |
| Loops | Single invocation | Autonomous loop runner with stop conditions |
| State | No durable orchestration state | Durable board, mailbox, tasks, agent state under `~/.pi-town` |
| Planning | Inline | `/plan` mode (read-only), `/todos` (captured steps) |

## Install

Pi is a prerequisite:

```bash
npm install -g @mariozechner/pi-coding-agent
```

Then install Pi Town:

```bash
npm install -g @schilderlabs/pitown
```

## Quick start

Verify Pi is installed and authenticated:

```bash
pitown doctor
```

Start the mayor inside a repo:

```bash
cd /path/to/repo
pitown mayor
```

Or send a one-off message:

```bash
pitown mayor "plan the next milestones for this repository"
```

## Packages

Pi Town ships as three npm packages:

- **`@schilderlabs/pitown`** — CLI. The thing users install. All commands.
- **`@schilderlabs/pitown-core`** — Runtime engine. Agent state, controller, loop runner, repo identity, metrics, leases.
- **`@schilderlabs/pitown-package`** — Pi integration layer. Extensions + agent prompts that give Pi sessions "Pi Town awareness."

## Extensions & Agent Roles

Pi Town ships a Pi extension (`@schilderlabs/pitown-package`) that registers:

### 5 orchestration tools

Given to the mayor automatically:

| Tool | Description |
|---|---|
| `pitown_board` | Show agent statuses |
| `pitown_delegate` | Spawn a worker/reviewer with a bounded task |
| `pitown_message_agent` | Send durable messages between agents |
| `pitown_peek_agent` | Inspect agent state and mailbox |
| `pitown_update_status` | Update own status on the board |

### 2 interactive commands

| Command | Description |
|---|---|
| `/plan` | Toggle read-only planning mode |
| `/todos` | Show captured plan steps |

### 7 bundled agent roles

| Role | Description |
|---|---|
| **mayor** (leader) | Human-facing coordinator, owns planning & delegation |
| **worker** | Implements one bounded task |
| **reviewer** | Reviews changes against intent and quality |
| **planner** | Turns a task into a concrete plan |
| **scout** | Fast codebase recon with handoff |
| **supervisor** | Selects next unit of overnight work |
| **docs-keeper** | Summarizes outcomes into human-readable updates |

### 1 test enforcement extension

- **require-tests** — Enforces test presence before task completion.

## Loop runner

`pitown loop` runs the mayor repeatedly with automatic stop conditions. This is the key differentiator from plain Pi — it enables autonomous overnight work.

```bash
pitown loop
pitown loop --max-iterations 20 --max-time 7200
```

### Stop conditions

The loop exits when any of these triggers:

- **Max iterations** reached (default: 10)
- **Max wall time** exceeded (default: 1 hour)
- **All tasks completed**
- **Leader blocked**
- **All remaining tasks blocked**
- **Pi exits non-zero**
- **High interrupt rate**

Each iteration writes durable artifacts (manifest, events, stdout/stderr, agent state) under `~/.pi-town/repos/<repo-slug>/runs/`.

## Golden signals / KPIs

Pi Town tracks five metrics per run, inspired by [Structure Dictates Behavior: Golden Signals for Agentic Development Teams](https://ambient-code.ai/2026/03/10/structure-dictates-behavior-golden-signals-for-agentic-development-teams/). These are the KPIs the mayor reports on to help you iterate on your repo's agent-readiness.

| KPI | What it measures | Goal |
|---|---|---|
| **Interrupt Rate** | Interrupts per agent-task | ↓ Lower is better |
| **Autonomous Completion Rate** | Tasks completed with zero interrupts | ↑ Higher is better |
| **Mean Time to Correct (MTTC)** | Time from interrupt to human response | ↓ Lower is better |
| **Context Coverage Score** | % of interrupt categories with a structural fix | ↑ Higher is better |
| **Feedback-to-Demo Cycle Time** | Time from feedback to working demo | ↓ Lower is better |

Every run writes metrics to `~/.pi-town/repos/<repo-slug>/latest/metrics.json`. The loop runner aggregates metrics across iterations. The idea: each morning the mayor shows you the previous day's results and what to iterate on — which interrupt categories need structural fixes, which tasks ran autonomously, and where agents got stuck.

## Command guide

### Core workflow

```bash
pitown                                  # alias for pitown mayor
pitown mayor                            # start the mayor session
pitown mayor "plan the next milestones" # mayor with an initial message
```

### Planning (inside a mayor session)

```bash
/plan                                   # toggle read-only planning mode
/todos                                  # show captured plan steps
```

### Agent management

```bash
pitown board                            # show what the town is doing
pitown peek mayor                       # inspect mayor state and mailbox
pitown attach mayor                     # reopen interactive mayor session
pitown continue mayor "follow up"       # resume mayor session with a message
pitown msg mayor "focus on auth"        # send one non-interactive message
pitown delegate --task "fix regression" # delegate a task to a new agent
```

### Autonomous loop

```bash
pitown loop                             # run the mayor loop with defaults
```

### Diagnostics

```bash
pitown doctor                           # verify Pi install and auth
pitown status                           # check latest local run
pitown status --repo /path/to/repo      # status for a specific repo
```

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

## Current status

**v0.2.1** is published on npm.

Pi Town is in the early local-first orchestration phase. It should be understood as an experimental scaffold, not yet a mature production workflow system.

Current focus:
- Mayor-first orchestration
- Persistent Pi sessions per agent
- Durable board, mailbox, and task artifacts
- Autonomous loop runner with stop conditions
- Explicit repo and plan targeting

Planned:
- Supervision and intervention workflows
- Richer Pi package integration
- Homebrew install

## Notes

- Detailed working plans are intentionally kept outside the repo
- Runtime state defaults to `~/.pi-town`
- Target repos do not need to install Pi Town
- Private plan contents should not be copied into public-safe artifacts by default
