# dunk agent notes

## purpose

- Personal terminal diff viewer.
- Hard-forked from `hunk` and slimmed down: no daemon, no MCP, no broker — agent integration runs through `.dunk/comments.json` on disk.
- Product target is "modern desktop diff tool in a terminal", not a pager-style TUI.

## major dependencies

- [Bun](https://bun.sh) runtime and package manager
- [OpenTUI](https://github.com/anomalyco/opentui) React terminal UI framework
- [Pierre](https://www.npmjs.com/package/@pierre/diffs) diff engine and terminal renderer

## architecture

```text
CLI input
  -> parse runtime + config-backed view options
  -> normalize into one Changeset / DiffFile model
  -> App shell coordinates state, layout, and review navigation
  -> pane components render review UI
  -> Pierre-backed terminal renderer draws diff rows
```

- CLI entrypoints: `diff`, `show`, `stash show`, `patch`, `pager`, `difftool`.
- All input sources normalize into one internal changeset model.
- Pager mode has two paths: full diff UI for patch-like stdin, plain-text fallback for non-diff pager content.
- View defaults are layered through built-ins, user config, repo `.dunk/config.toml`, command sections, pager sections, and CLI flags.
- Review comments live in one committed `.dunk/comments.json` per repo. Watch mode picks up changes so a coding agent and a human reviewer can ping-pong on the same review.
- Prefer one source of truth for each user-visible behavior. When rendering, navigation, scrolling, or note placement share the same model, derive them from the same planning layer rather than maintaining parallel implementations.
- When UI behavior depends on derived structure or metrics, make that structure explicit in helper modules and reuse it across rendering and interaction code instead of re-deriving it ad hoc in multiple places.
- If a new implementation makes an older path obsolete, remove the dead path instead of keeping two overlapping systems around.

## architectural rules

- Keep the app review-first: the main pane is a single top-to-bottom stream of all visible file diffs.
- The sidebar is for navigation. Selecting a file jumps to that file in the main review stream; it should not collapse the main pane to one file.
- Keep Pierre as the diff engine and renderer foundation. Do not switch the main renderer back to OpenTUI's built-in `<diff>` widget.
- Keep split and stack views terminal-native and driven from the same normalized diff model.
- Preserve mouse + keyboard parity for primary actions.
- Keep the chrome restrained: minimal borders, no top menu bar, no redundant metadata headers.

## component guidance

- `App` should remain the orchestration shell for app state, navigation, layout mode, theme, filtering, and pane coordination.
- Pane rendering should live in dedicated components.
- New UI work should extend existing components or add new ones, not grow `App` back into a monolith.
- Shared formatting, ids, and small derivations belong in helper modules, not repeated inline.
- Prefer one implementation path per feature instead of separate "old" and "new" codepaths that duplicate behavior.
- When refactoring logic that spans helpers and UI components, add tests at the level where the user-visible behavior actually lives, not only at the lowest helper layer.

## testing

- Colocate unit tests with the code they cover (`src/core/foo.ts` + `src/core/foo.test.ts`, `src/ui/AppHost.*.test.tsx`, `src/ui/lib/*.test.ts`).
- Put shared unit-test helpers in `test/helpers/`.
- Name test helpers so they explicitly include `Test` and are clearly test-only (`createTestDiffFile`).
- Use repo-level `test/` directories by intent:
  - `test/cli/` for black-box CLI contract coverage.
  - `test/pty/` for PTY-backed live UI integration tests.
  - `test/smoke/` for opt-in terminal transcript smoke coverage.

## code comments

- Add short JSDoc-style comments to functions and helpers.
- Add inline comments for intent, invariants, or tricky behavior that would not be obvious to a fresh reader.
- Skip comments that only narrate what the code already says.

## naming

- Prefer names that match the role the code plays in the product and architecture.
- Use `layout` for structural placement or arrangement data.
- Use `geometry` for aggregate spatial data used by rendering, scrolling, or interaction.
- Use `bounds` for one concrete visible extent within a larger structure.

## review behavior

- Default behavior is a multi-file review stream in sidebar order.
- Layout modes: `auto`, `split`, `stack`.
- `auto` should choose split on wide terminals and stack on narrow ones.
- Explicit `split` and `stack` choices override responsive `auto` layout selection.
- `[` and `]` navigate hunks across the full review stream. `J`/`K` step within a hunk.
- Comments belong beside the code, not hidden in a separate mode or workflow.
- Comments are hunk-specific: render them in the diff flow near the annotated row, and keep a clear spatial relationship to the code they explain.
- Drifted comments (file removed, line out of range, or anchor mismatch) pin to the top of the diff so they stay visible until resolved or dismissed.
- `dunk diff` working-tree reviews include untracked files by default. Use `--exclude-untracked` if you explicitly want tracked changes only.
- The agent skill at `skills/dunk-review/SKILL.md` describes how a coding agent should read, fix, and prune `.dunk/comments.json`. Don't run interactive TUI commands from agents — they should drive through the file.

## commands

- install deps: `bun install`
- run from source: `bun run src/main.tsx -- diff`
- review a commit from source: `bun run src/main.tsx -- show HEAD~1`
- fast smoke test: `bun run src/main.tsx -- diff /tmp/before.ts /tmp/after.ts`
- typecheck: `bun run typecheck`
- tests: `bun test`
- PTY integration tests: `bun run test:integration`
- TTY smoke test: `bun run test:tty-smoke`
- format: `bun run format`
- lint: `bun run lint`
- build binary: `bun run build:bin`
- install binary: `bun run install:bin`

## binary notes

- The shipped `dunk` is a tiny shell wrapper around `bun run src/main.tsx` for local installs, and a compiled `bun build --compile` binary for prebuilt npm releases.
- After source changes, rebuild/reinstall with `bun run install:bin` for local dev.
- For rendering verification, prefer a real TTY smoke run over redirected stdout capture.

## verification

- For rendering changes: run `bun run typecheck`, `bun test`, `bun run test:integration`, `bun run test:tty-smoke`, and do one real TTY smoke run on an actual diff.
- For interaction, layout, scrolling, navigation, windowing, or other terminal-native behavior: add or update PTY integration coverage in `test/pty/*-integration.test.ts` and run it with `bun run test:integration`.
- For CLI, config, or pager work: make sure the relevant source invocation still works (`diff`, `show`, `patch`, or `pager`).
- Preserve current interaction model unless the user asks to change it explicitly.

## cross-platform support

- `dunk` should work on macOS and Linux. Windows isn't tested.
- In tests, avoid hard-coded POSIX paths when portable APIs exist.

## releases

- Maintain the top-level `CHANGELOG.md` as the source of truth for user-visible changes.
- Keep upcoming work under `## [Unreleased]` with these subsections:
  - `### Added`
  - `### Changed`
  - `### Fixed`
- Append to existing subsections instead of creating duplicates.
- When cutting a release, move the relevant unreleased entries into a new immutable version section and start a fresh `## [Unreleased]` section.
- Use the released changelog section as the starting point for the GitHub release body.
- Prefer `gh release create/edit --notes-file` for multi-line release notes so the exact body is reviewed before posting.
- For patch releases and backports, list only changes actually present between the previous tag and the new tag on that release branch.
- Prefer concise, user-visible entries over internal refactors unless the refactor changes user-visible behavior.

## repo notes

- Local review artifacts under `.dunk/` are gitignored on purpose. Leave them alone unless the user explicitly wants them updated, and do not commit them.
- Keep this doc short and architectural. Fresh-context agents can discover file paths themselves.

## commits

Commit titles should follow Conventional Commits. Format: `<type>[scope]: <description>`. Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`. Use `!` or `BREAKING CHANGE:` footer for breaking changes. Description should explain the "why", not just the "what".
