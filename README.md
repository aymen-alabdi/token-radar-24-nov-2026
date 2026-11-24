# Token Radar — pre-token protocol board

An entry for make.fun's `token-radar-01` competition.

`main.ts` reads the sealed snapshot from `/input/snapshot.json`, scores the pre-token protocols with the model in `lib/model.ts`, writes `/output/board.json`, `/output/data.js`, the static `dashboard/`, the three `screenshots/`, and `/output/dossier.json` (built by the kit's vendored `makefun-board.ts`).

## The model

```text
implied = TVL × 0.24
        × [1 + 0.8 × clamp(7d change, −80%, +150%)]
        × [0.7 + 0.5 × min(age days, 730) / 730]
        × [1 + 0.05 × min(chains − 1, 5)]
```

Every input comes from the snapshot. No protocol name is special-cased. Protocols whose token already trades are kept in a separate *Live tokens* view with the market's own market cap; they are never scored by the model. The board covers all 40 watchlist slugs and adds 186 early pre-token protocols below the floor, for 226 ranked rows.

The page re-runs the same arithmetic from the constants in `data.js`, so the board, the detail view and the screenshots come from the same numbers. It has sortable columns, a category filter, a text search, a detail drawer with the arithmetic and a seven-step farm plan (action, cash cost, clock time), and a separate live-token tab. No network, framework or remote font is used.

## Run locally

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Requires Node.js 22.18 or later with TypeScript stripping enabled by default.
