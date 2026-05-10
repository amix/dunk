# Codebase Review: Performance, Abstraction, and Cleanup

Scope: static review of the current source tree, focused on hot-path UI rendering, VCS loading, and cleanup opportunities. I did not run the benchmark suite; the findings below are source-based and prioritized by likely user impact.

## High Severity

### 1. Watch mode runs expensive VCS diff work every 250ms

- **Files:** `src/ui/App.tsx:619-668`, `src/core/watch.ts:32-40`, `src/core/watch.ts:65-98`
- **What's wrong:** `App` starts a fixed 250ms polling loop, and each poll calls `computeWatchSignature`. For Git working-tree input, that signature includes a full `git diff` patch plus untracked-file discovery and stats.
- **Impact:** A watched session can run full diff generation four times per second while idle. On medium or large repos this burns CPU, allocates full patch strings repeatedly, and competes with the renderer. It also makes watch mode scale with patch size instead of with actual filesystem changes.
- **Concrete fix:** Deepen the watch module so it has a cheap invalidation interface. Prefer `fs.watch` or debounced watchers for `.git/index`, `.jj`, `.dunk/comments.json`, patch/file inputs, and the currently relevant changed paths. If polling remains as a fallback, make the signature cheap: use `git status --porcelain=v1 -z`, `git diff --name-only`/`--numstat`, and file stat tuples first, then only reload and build the full patch after the cheap signature changes. Increase idle polling or add exponential backoff for backends where event watching is unreliable.

### 2. Row windowing scans every row on every visible-slice calculation

- **File:** `src/ui/diff/rowWindowing.ts:47-67`
- **What's wrong:** `resolveVisiblePlannedRowWindow` linearly scans all `sectionGeometry.rowBounds` to find the first and last visible rows, even though row bounds are sorted by `top`.
- **Impact:** Scrolling a very large file remains O(total rows) per viewport update. This undercuts the row-windowing module: most rows are not rendered, but every scroll still walks the full row geometry.
- **Concrete fix:** Replace the linear scan with binary searches: find the first row whose `top + height > minVisibleTop`, then find the last row whose `top < maxVisibleBottom`. Keep the existing adjacent zero-height row expansion at the edges. Add tests for empty windows, zero-height hunk headers, and visible slices near EOF.

### 3. Viewport planning scans all files on scroll

- **Files:** `src/ui/lib/fileSectionLayout.ts:99-113`, `src/ui/components/panes/DiffPane.tsx:411-416`, `src/ui/components/panes/DiffPane.tsx:601-640`
- **What's wrong:** `collectIntersectingFileSectionIds` loops through every file section, and `visibleBodyBoundsByFile` then loops through every file again to build a `Map` for visible body bounds.
- **Impact:** Large reviews with hundreds or thousands of files pay O(file count) work on each scroll event, plus new `Set`/`Map` allocations. The cost is independent of the viewport size, so it grows exactly where windowing should keep work bounded.
- **Concrete fix:** Have the file-section layout module return intersecting layouts, not only ids, using binary search over sorted section offsets. In `DiffPane`, iterate only those layouts plus selected/adjacent prefetch sections. Maintain a `fileId -> { file, index, layout }` map for selected and adjacent lookups instead of rescanning `files`.

### 4. Hunk navigation rebuilds derived review state on every selection move

- **Files:** `src/ui/hooks/useReviewController.ts:61-78`, `src/ui/lib/reviewState.ts:36-47`, `src/ui/lib/hunks.ts:10-23`, `src/ui/lib/hunks.ts:27-47`
- **What's wrong:** The `buildReviewState` memo depends on `selectedFileId` and `selectedHunkIndex`, so every `J`/`K` hunk move rebuilds filtered files, sidebar entries, all hunk cursors, and annotated hunk cursors. `findNextHunkCursor` then does another linear `findIndex`.
- **Impact:** Hunk navigation is O(files + hunks) per keypress. This is noticeable in large reviews because navigation should only update selection and reveal state.
- **Concrete fix:** Split the review-state module into stable stream derivation and volatile selection derivation. Memoize `visibleFiles`, `sidebarEntries`, `hunkCursors`, and `annotatedHunkCursors` only on `files` and `deferredFilter`. Build a `cursorIndexByKey` map once and use it in `findNextHunkCursor` so movement is O(1).

## Medium Severity

### 5. Inline note placement is O(notes * rows)

- **File:** `src/ui/diff/reviewRenderPlan.ts:224-246`, `src/ui/diff/reviewRenderPlan.ts:233-262`
- **What's wrong:** For each note, the module searches rows to find the anchor and filters all line rows again to find covered rows. `findInlineNoteAnchorRow` also recomputes line rows and the first header for each note.
- **Impact:** Files with many comments or long hunks become expensive to plan. This cost can be paid in both geometry measurement and actual rendering, so comments increase startup and scroll latency beyond their visible footprint.
- **Concrete fix:** Pre-index line rows once per file by side and line number, for example `old:<line>` and `new:<line>`, and keep hunk-local ordered row arrays for range overlap. Then resolve note anchors and guide rows from the indexes. The planning interface stays the same, but the implementation becomes O(rows + notes + overlaps).

### 6. Horizontal-scroll bounds rescan every code line

- **Files:** `src/ui/App.tsx:317-327`, `src/ui/diff/codeColumns.ts:17-32`
- **What's wrong:** `maxCodeHorizontalOffset` reduces over all filtered files and calls `maxFileCodeLineWidth`, which scans every deletion and addition line. `measureRenderedCodeLineWidth` expands tabs with `replaceAll`, allocating a new string for every line.
- **Impact:** Resizing the terminal, filtering, and layout changes can touch every code line in the review. Large patches can freeze the app even though only a small viewport is visible.
- **Concrete fix:** Compute `maxCodeLineWidth` once when building each `DiffFile`, or cache it in a `WeakMap<DiffFile, number>`. Measure tabs in a single pass without allocating expanded strings. Then `App` only reduces cached per-file numbers.

### 7. Untracked files spawn one Git process per file

- **Files:** `src/core/loaders.ts:963-985`, `src/core/loaders.ts:732-770`, `src/core/git.ts:100-113`
- **What's wrong:** Working-tree reviews list untracked files, then `buildUntrackedDiffFile` calls `git diff --no-index` once for every reviewable untracked file.
- **Impact:** Startup and reload time scale with process count. A repo with hundreds of generated but reviewable untracked files can spend most of its time spawning Git, even before parsing or rendering begins.
- **Concrete fix:** Synthesize new-file patches in-process for regular text files: read the file once, build canonical new-file metadata/patch text, and keep `git diff --no-index` only as a fallback for symlink or edge cases. `createTwoFilesPatch` is already available in `loaders.ts` and can be adapted for `/dev/null`-to-file patches if Pierre's expected headers are preserved.

### 8. Highlight cache keys can collide on same-length edits

- **File:** `src/ui/diff/useHighlightedDiff.ts:61-76`
- **What's wrong:** `patchFingerprint` uses patch length plus three 64-character samples. Two same-length changes outside those samples will share a highlight cache key when the file id and appearance are unchanged.
- **Impact:** Watch reloads can show stale syntax-highlight spans for a changed file. This is especially confusing because the code comment says stale entries are never served.
- **Concrete fix:** Use a full rolling hash over `file.patch`, or store a content hash on `DiffFile` during loading and use that in the highlight cache key. For patchless files, keep the existing metadata/line fingerprint path, but include enough hunk content to make it content-addressed rather than shape-addressed.

### 9. The public OpenTUI component has a separate non-windowed render path

- **Files:** `src/opentui/DunkDiffView.tsx:69-118`, `src/ui/diff/PierreDiffView.tsx:72-113`, `src/ui/diff/PierreDiffView.tsx:131-224`
- **What's wrong:** `DunkDiffView` builds rows and maps every row directly to `DiffRowView`, while the app path goes through planned rows, row visibility checks, note insertion, and row windowing.
- **Impact:** The exported module can be much slower on large diffs than the CLI UI, and future fixes to the app render plan can drift from the public component. This is a shallow duplicate implementation: the interface is similar, but behavior is split.
- **Concrete fix:** Extract a shared diff-body module behind a small interface: file, layout, theme, width, line-number options, optional notes, optional visible body bounds. Have both `PierreDiffView` and `DunkDiffView` use it, with the public component passing empty notes and no app chrome.

### 10. Boolean CLI flag parsing looks at pathspecs after `--`

- **Files:** `src/core/cli.ts:32-48`, `src/core/cli.ts:207-239`
- **What's wrong:** `resolveBooleanFlag` scans the full raw `argv`. In `parseDiffCommand`, pathspecs are split out into `pathspecs`, but `buildCommonOptions(parsedOptions, argv)` still sees pathspec values after `--`.
- **Impact:** A pathspec literally named `--no-wrap`, `--comments`, or another paired flag can change view options instead of being treated only as a pathspec. This is also an abstraction leak: option resolution has to know too much about raw argv shape.
- **Concrete fix:** Pass only `commandTokens` into `buildCommonOptions`, or better, normalize paired booleans from Commander's parsed command options and stop scanning raw argv. Add a regression test for `dunk diff -- --no-wrap`.

## Low Severity

### 11. Text fitting is duplicated and not terminal-cell aware

- **Files:** `src/ui/diff/renderRows.tsx:12-27`, `src/ui/lib/text.ts:1-21`, `src/ui/diff/codeColumns.ts:12-15`
- **What's wrong:** There are two `fitText` helpers with different truncation markers (`…` vs `.`), and both use JavaScript string length instead of terminal cell width. Code-column measurement also uses `.length` after tab expansion.
- **Impact:** Chrome and diff rows can truncate inconsistently, and wide Unicode or combining characters can overflow or underfill terminal cells. The duplicate helpers are shallow modules that make future text fixes easy to apply in one place and miss in another.
- **Concrete fix:** Create one terminal text module with `measureCells`, `sliceCells`, `fitText`, and `padText`. Use OpenTUI's width utilities if available, otherwise a small `wcwidth` dependency. Route both chrome and diff rendering through that module.

### 12. An exported geometry helper appears unused

- **File:** `src/ui/lib/diffSectionGeometry.ts:219-237`
- **What's wrong:** `estimateHunkAnchorBodyRow` is exported but has no references in `src` or `test`.
- **Impact:** It increases the module interface without adding leverage, and it invites future callers to depend on a helper that may no longer represent the preferred geometry path.
- **Concrete fix:** Delete it, or make it private only if a near-term caller exists. Add an unused-export check with the existing `knip.json` setup so this kind of cleanup stays cheap.

