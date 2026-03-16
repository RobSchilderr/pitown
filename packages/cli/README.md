# @schilderlabs/pitown

The installable Pi Town CLI.

Pi Town is an experimental orchestration tool for Pi.

For the full project overview, roadmap, and architecture context, see the main repo:

- https://github.com/schilderlabs/pitown

## Install

```bash
npm install -g @schilderlabs/pitown
```

## Usage

```bash
pitown --help
pitown run --repo /path/to/repo --plan /path/to/private/plans --goal "continue from current scaffold state"
pitown status
```

## Runtime storage

By default, Pi Town stores local runtime state under `~/.pi-town` and keeps private plans outside the target repo.
