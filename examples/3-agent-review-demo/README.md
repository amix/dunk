# 3-agent-review-demo

A flagship dunk demo: a small command-palette refactor with inline agent rationale attached to the interesting hunks.

## Run

```bash
dunk patch examples/3-agent-review-demo/change.patch \
  --agent-context examples/3-agent-review-demo/agent-context.json
```

## What to look for

- query normalization extracted into its own helper
- ranking logic that prefers strong matches over loose substring hits
- inline notes beside the changed hunks, not in a separate panel or PR description
