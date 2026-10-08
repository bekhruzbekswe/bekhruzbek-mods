# bekhruzbek-mods

Personal Claude Code plugins, shared as a small marketplace.

| Plugin | What it does |
|---|---|
| [figma-cost](figma-cost) | Read-only pane that shows what Figma design work costs in a session: spend, screens, iterations per screen, failures and tokens by agent. |

## Install

In Claude Code:

```
/plugin marketplace add <owner>/<repo>
/plugin install figma-cost@bekhruzbek-mods
```

Then open the pane with `/figma-cost`. See [figma-cost/README.md](figma-cost/README.md) for what the numbers mean and what the plugin does and does not touch.

## Requirements

The plugin looks up screens through the `figma-console` MCP server, so that server (and its Desktop Bridge plugin in Figma) needs to be connected. Without it the pane still shows session cost, and shows "Not connected" when Figma calls fail.
