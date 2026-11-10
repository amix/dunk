# 6-readme-screenshot

A screenshot-optimized demo for the main README: a multi-file UI refactor.

## Run

```bash
dunk patch examples/6-readme-screenshot/change.patch \
  --mode split \
  --theme midnight
```

## Screenshot setup

- use a wide terminal so the sidebar and split diff are both visible
- keep the first file selected: `src/components/ReviewSummaryCard.tsx`
- capture the first hunk with the diff in focus

## What it shows well

- a clear mix of removed and added lines in one hunk
- a visible multi-file sidebar
- TSX prop renames, copy edits, and helper extraction with strong syntax color
