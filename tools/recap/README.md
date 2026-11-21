# Season recap slide

Generates the 1080×1920 season recap infographic (HTML + PNG) straight from production D1.

```bash
node tools/recap/build.mjs --season 7
node tools/recap/build.mjs --season 7 --no-shot     # HTML only
node tools/recap/build.mjs --season 7 --out tmp/recap
```

Output defaults to `.opencode/preview/season-<N>-recap.{html,json,png}` (gitignored). The JSON is the
computed model — check it when a number on the slide looks off.

## What it needs

- `npm install` in `backend/` (uses the local `wrangler` to query D1 remotely) and a logged-in
  `wrangler` (`npx wrangler whoami`).
- Chrome or Edge for the screenshot, or `CHROME_PATH=/path/to/chrome`. `--no-shot` skips it, but the
  award icons are CSS masks and **do not render from `file://`** — the script serves the repo over a
  loopback HTTP server for exactly this reason. Always screenshot through the script.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--season <n>` | newest season | season id to recap |
| `--out <dir>` | `.opencode/preview` | output directory |
| `--no-shot` | off | skip the PNG |
| `--qr` | off | add the footer QR and its scan hint; chart and gaps shrink to make room |
| `--min-picks <n>` | 4 | minimum votes for the leader win-rate card |
| `--top-leaders <n>` | 5 | rows in the leader cards |
| `--championship-date <d>` | cut-phase date | label used for championship night (e.g. `"Dec 9"`) |
| `--reveal-ambassador` | off | show the real Ambassador name while voting is live (internal only) |

## Where the numbers come from

- **Boards / Ruler** — `computeSeasonTable` (`backend/src/lib/seasonTable.js`) over regular-phase
  `season_standings`, so ranks, points and best-N-night maths match the site.
- **Matches** — sum of regular-phase W+D+L ÷ 2. `match_results` rows are *not* the source: nights whose
  individual matches were not fully synced are missing there (S7: 299 rows vs 321 games).
- **Players / night** — regular-phase standings rows ÷ nights played.
- **Leader cards** — `votes` joined to `leaders` (name + set + aspects). Votes are submitted picks, which
  can be fewer than appearances; rows print `Name - SET` (as the site's leader picker does) so a name
  played from several sets stays distinguishable. The unit is the printing (name+set card): the hero
  count and the card's "N used" note both count those, so Darth Vader in three sets is three.
- **Win rate** — each vote joined to that player's standings row for the same round; the rate is
  `(3·W + D) / (3·games)`, the share of available league points (a draw pays one of three, exactly like
  `nightPoints` in `backend/src/lib/seasonTable.js`), labelled "Win rate" for readability. Votes below the
  `--min-picks` threshold are dropped as noise.
- **Aspects played** — the top bar is vote-weighted (each vote counts once) and splits Heroism / Villainy /
  Neither. Under it, one row per alignment breaks that alignment down by its other (sphere) aspect:
  Heroism + Command, Heroism + Cunning, … Colours and icons are the official sphere aspects, so the rows
  answer "what did heroism decks pair with". Votes on leaders with no alignment aspect appear only in the
  bar's grey segment; a leader that carries an alignment but no sphere (or both alignments) still counts
  in the bar and is reported by a build warning instead of vanishing silently. A segment under 4% of its
  row renders as a bare colour sliver (no icon or count) so the widths still fill the row. The `Leaders
  used:` line counts distinct printings instead of votes (each printing once), answering "how varied was
  the pool", so it differs whenever a few leaders are picked heavily — the card's note spells the two
  units out.
- **Awards** — `awards` rows, highest score wins, ties joined with `·`; Ruler comes from the table and
  Champion falls back to the dashed "decided at the Top 4 final" tile until it is materialised.
- **Ambassador masking** — while the season is active *and* `VOTING_OPEN` is TRUE, the Ambassador name
  is replaced with the site's callsigns (Gold Leader, …) exactly like `getAwardsData` does. The name
  reappears on its own once voting closes; never override this for anything published.
- **Footer QR** — `qr.mjs` is a self-contained QR encoder (byte mode, level M, versions 1–10, no
  dependencies) that encodes the site URL; nothing is fetched at render time. Its output is verified
  module-for-module against the reference `qrcode` package. Off by default; pass `--qr` to include it.
- **Layout headroom** — the slide is a fixed 1920px with `overflow: hidden`, so a long award-name list
  can push the footer out of frame. After changing anything long, check the PNG bottom edge. Both variants
  are tuned to end the footer exactly on the 1908px content edge (S7): the plain one through
  `margin-top: auto`, the `--qr` one by shrinking the nights chart (`body.with-qr .chart`) because the
  144px QR makes the footer taller. So any extra row/line anywhere above the footer — `--top-leaders`
  above the default 5, another aspect row, a `--min-picks` note — clips it in `--qr` mode first. The CSS
  is inlined, so its own font/icon URLs must stay relative to the render-time `assets` prefix
  (`__ASSETS__`), never to the output folder.

Edit `styles.css` for layout, `layout.mjs` for markup, `metrics.mjs` for maths.
