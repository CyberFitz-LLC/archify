# CyberFitz fork of Archify

Upstream: <https://github.com/tt-a1i/archify> (MIT). Forked from upstream `main`
at `72c750b` (2.17.0-dev.1, ten commits past `v2.16.0`), because that is where
upstream split the viewer into `viewer/*` modules; forking the older monolithic
template would have made every later sync a rewrite.

## Why this fork exists

Upstream optimises for a small diagram that fits one screen. Its guidance tells
the author to keep to about a dozen nodes, sparse labels and one path, its
gates fail a diagram whose viewBox is "too wide to read at 1440px", and its
suggested repair is to remove content or split the diagram. For documenting
real systems that is the wrong trade: the picture gets simpler than the system.

The fork changes two things and nothing else:

1. **The standard reader is an infinite canvas.** The diagram owns the viewport,
   pans freely, zooms from 20% of fit to 400% of real pixels about the cursor,
   and drops to primary labels at overview zoom. Title, chapters and Notes float
   over the plane. `meta.layout_mode: "page"` opts back into upstream's reader.
2. **Size is not a defect.** Authoring guidance asks for the whole subject at
   natural size. The projected-text gate does not apply on the canvas, workflow
   v2 columns / dataflow stages and rows / lifecycle phases follow the authored
   content, and `meta.views` allows twelve chapters. A clean perpendicular
   crossing is a counted warning on the canvas, because a real system is rarely
   planar and upstream's zero-crossing rule can then only be met by deleting
   true relationships. Routes through nodes, ambiguous shared corridors, route
   rhythm and label collisions are unchanged and still fail at `showcase`.

Upstream-sized input renders byte-identical SVG geometry; `fork-canvas.test.mjs`
pins that.

## Fork touchpoints

New files (never conflict): `fork/*`, `.github/workflows/upstream-sync.yml`,
`viewer/fork-canvas.js`, `viewer/fork-canvas.css`,
`archify/renderers/shared/fork-layout.mjs`, `archify/references/page-reader.md`,
`archify/test/fork-canvas.test.mjs`.

Edited upstream files — every edit carries a `CyberFitz fork` comment:

| File | Edit |
|---|---|
| `viewer/viewer-camera.js` | canvas policy branches: clamp, zoom range/anchor, pinch, `zoomAt`/`panBy`/`actualSize`, real-pixel percent and detail level, frame insets |
| `viewer/reader-layout.js`, `viewer/viewer-chrome-layout.js` | stand down when the canvas is active |
| `viewer/template.source.html` | two fragment markers (`FORK_CANVAS`, `FORK_CANVAS_CSS`) |
| `scripts/generate-viewer.mjs` | two optional fragments |
| `scripts/run-tests.mjs` | inherited suite runs with `ARCHIFY_DEFAULT_LAYOUT=page` |
| `archify/renderers/shared/utils.mjs`, `cli.mjs` | `layoutMode` → `data-layout` on `<html>` |
| `archify/scripts/check-render-output.mjs` | projected-text gate skipped on the canvas; perpendicular crossings are warnings there |
| `archify/renderers/shared/geometry.mjs` | `cleanCrossingProblems` stands down on the canvas (checker reports the warnings) |
| `archify/bin/visual-check.mjs` | canvas text measured at real pixels; `readerLayout` in observations |
| `archify/renderers/workflow/workflow-compiler.mjs` | v2 `columnCount` follows content (floor 6) |
| `archify/renderers/dataflow/render-dataflow.mjs` | rows follow viewBox height (floor 5) |
| `archify/renderers/lifecycle/render-lifecycle.mjs` | phase columns follow viewBox width (floor 5) |
| `archify/schemas/*.json` | `meta.layout_mode`; caps: workflow cols 47, dataflow stages 48, lifecycle col 47, guided views 12 |
| `archify/SKILL.md`, `references/authoring-contract.md`, `delivery-contract.md`, `viewer-runtime.md`, `schemas/README.md` | canvas-first, full-size authoring guidance |
| `archify/test/adaptive-reader-layout.test.mjs` | reads the first-screen contract from `references/page-reader.md` |
| `archify/test/golden.mjs`, `archify/test/guided-views.test.mjs` | cap expectations follow the lifted schema maxima (workflow columns, chapters) |

Generated — **never hand-merge, always rebuild with `node fork/regenerate.mjs`**:
`archify/assets/template.html`, `archify/renderers/shared/generated-validators.mjs`,
`examples/*.html`, `archify/examples/*.html`, `examples/checkout-platform-delta.*`,
`docs/gallery*`, `archify.zip` (`--zip`, from a clean committed tree).

## Syncing upstream

`fork/UPSTREAM_VERSION` records the last upstream tag (or commit) merged.

- **Automatic:** `.github/workflows/upstream-sync.yml` runs Mondays 14:00 UTC and
  on demand. When upstream has a newer stable `vX.Y.Z` tag it merges the tag
  into `sync/upstream-vX.Y.Z`, rebuilds generated files, runs `npm test`, and
  opens a pull request listing the upstream commits. Conflicts are committed
  with markers on a draft PR titled `(conflicts)`; nothing reaches `main`
  unreviewed.
- **By hand:** `fork/sync-upstream.sh` (same logic), `--list` to preview,
  `--tag vX.Y.Z` for a specific release, `--pick <sha>...` to cherry-pick
  individual upstream commits instead of a whole release, `--continue` after
  resolving conflicts.

Releases are merged rather than replayed commit by commit: upstream lands
hundreds of squashed commits per release, and a merge keeps true ancestry so the
next sync only sees what is new. Use `--pick` when only part of a release is
wanted; record why in the PR.

### Resolving conflicts

1. Generated files: take either side, then `node fork/regenerate.mjs`.
2. A touchpoint above: keep upstream's new behaviour **and** the fork's branch.
   The fork edits are additive `if (canvas)` branches and floors, so both
   usually survive; re-apply the fork edit on top of upstream's new code.
3. Guidance text (`SKILL.md`, references): take upstream's new material, but
   never reintroduce wording that caps node count, asks for sparse labels,
   requires first-screen fit by default, or repairs by removing content. Put
   page-only rules in `references/page-reader.md`.
4. Upstream tests that pin page-reader behaviour stay untouched; they run in
   page mode. If upstream adds a test that pins a size cap the fork lifted,
   scope it to `layout_mode: "page"` or to upstream-sized input.
5. `cd archify && npm test` must pass, including `test/fork-canvas.test.mjs`,
   which fails loudly if a merge reverted the fork's contract.

## Repository setup (once)

- Push this branch as the fork's default branch `main`. Upstream's tags do not
  need to be pushed; the sync job fetches them into `refs/upstream-tags/*`.
- Actions → enable workflows. Disable upstream's `release.yml`,
  `star-history.yml` and `dsh.yml` in the Actions UI; they publish upstream's
  site and releases and have no job in the fork. Keep `ci.yml`.
- Settings → Actions → General → Workflow permissions: **Read and write**, and
  allow Actions to create pull requests.
- GitHub pauses scheduled workflows in a repository with no activity for 60
  days; a merged sync PR or any push resets that.

## Known gaps

- Canvas-only strings ("Notes", the controls hint in the guide dialog) are
  English only; upstream's `en`/`zh-CN` catalogue was left untouched to keep
  `i18n.mjs` conflict-free.
- Architecture `layout.mode: "grid"` still stops at twelve columns; larger
  planes use free `pos` placement on a regular pitch.
- Lifecycle keeps upstream's three fixed bands (phase, event, outcome).
- `skill-release.json` still points at upstream's update manifest, so the
  in-skill update notice reports upstream releases; SKILL.md tells the agent to
  explain that the fork syncs them itself.
