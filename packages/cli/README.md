# @schilderlabs/pitown

The installable Pi Town CLI.

Pi Town is an experimental orchestration tool for Pi.

For the full project overview, roadmap, and architecture context, see the main repo:

- https://github.com/schilderlabs/pitown

## Install

```bash
npm install -g @schilderlabs/pitown
npm install -g @mariozechner/pi-coding-agent
```

`pitown run` requires Pi to be installed and authenticated.
Verify Pi first:

```bash
pitown doctor
pi -p "hello"
```

## Usage

```bash
pitown --help
pitown
pitown mayor
pitown mayor "plan the next milestones"
pitown run --repo /path/to/repo --plan /path/to/private/plans --goal "continue from current scaffold state"
pitown status
```

If you are already inside a repo, `pitown` and `pitown mayor` use the current working repo by default.

The main workflow is:

1. `cd` into a repo
2. run `pitown` or `pitown mayor`
3. use `/plan` inside the mayor session when you want a read-only plan first
4. use `pitown board`, `pitown peek mayor`, or `pitown msg mayor "..."` as needed

Inside the mayor session:

- `/plan` toggles read-only planning mode
- `/todos` shows the captured numbered plan
- leaving `/plan` returns the mayor to normal execution and delegation mode

## Runtime storage

By default, Pi Town stores local runtime state under `~/.pi-town` and keeps private plans outside the target repo.
