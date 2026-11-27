# Explorations

Ideas we are shaping before they touch the product [ROADMAP.md](../ROADMAP.md). Each track has **its own branch**, its own folder, and its own PR story. Do not mix tracks in one commit or one upstream PR unless Kostya agrees explicitly.

## Tracks

| Track | Question | Branch | Entry point |
| ----- | -------- | ------ | ----------- |
| **UI sound & snap** | Opt-in tick/knock feedback (Fontographer lineage, synthesis engine, snap events) | `explore/ui-sound` | [ui-sound/README.md](ui-sound/README.md) |
| **Strokes & nib** | Skeleton paths, icon strokes, calligraphic nibs, pen input, SVG export | `explore/strokes` | [strokes/ROADMAP.md](strokes/ROADMAP.md) |

## Workflow

```bash
# Sound / haptics / snap feedback
git checkout explore/ui-sound

# Strokes, nibs, path operations
git checkout explore/strokes
```

On a given branch, only add files under that track’s folder (plus this README when it changes). The other folder may still appear in your working tree after switching branches; leave it untracked or remove local copies if it clutters `git status`.

## Upstream

- Exploration docs stay under `explorations/`, not `docs/`.
- Product checklist items (e.g. offset path, snap-to-grid) stay in the root ROADMAP; exploration roadmaps **reference** them, they do not replace them.
- Push exploration branches to your fork only until there is a scoped proposal for upstream.

## Isolation checklist

- [ ] Branch name matches the track you are editing.
- [ ] Commit contains a single track’s paths (or this index only).
- [ ] No cross-track “while we’re here” refactors in exploration PRs.