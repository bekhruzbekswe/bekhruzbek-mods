# figma-cost

A read-only pane that tells the story of Figma design work in a session, top to bottom:

1. **Spent**: Figma cost against the whole session's cost.
2. **Bought**: screens in Figma and the cost per screen.
3. **Took**: iterations per screen (green up to 1.5, amber up to 2.5, red above).
4. **Held back by**: failed Figma calls and edits never checked by a screenshot.
5. **Spent by**: tokens per agent, named by the task each subagent was given.

## Use

- `/figma-cost` opens the pane.
- `/figma-cost reset` starts the counters again.
- `/figma-cost json` prints the raw counters, for checking the numbers.

## What it does and does not do

- It only observes. It never changes a prompt, a model step or a tool call, and it spends no model tokens.
- After each Figma screenshot it asks Figma one read-only question (which frames does this node show?) through the figma-console MCP server.
- The session total is the session's own ledger (the figure `/cost` shows). The Figma share is our token estimate scaled to that ledger, so treat it as good to about 10 percent.
- A screen is a frame inside a section (or a top-level frame on the page), counted by name, so a rebuilt screen is one screen with more rounds.
- Numbers live in the session. They are not saved when it ends.
