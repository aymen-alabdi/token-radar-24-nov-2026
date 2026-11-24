// token-radar-01 entry: read the sealed snapshot, score every pre-token protocol, and hand the
// grader a board, a dashboard, three screenshots and the dossier built from them.
//
// Node 22, standard library only. In the grader this reads /input/snapshot.json and writes /output.
// Locally: MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
//
// The model lives in lib/model.ts. Every number it prints comes from the snapshot; no protocol name
// is special-cased. The dashboard re-runs the same arithmetic from the constants in data.js, so the
// screenshots and the code agree.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** --name value, --name=value, or a fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const equals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return equals === undefined ? fallback : equals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar: no snapshot at ${inputFile}; pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files, skipping dot names, into another directory. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar: screenshots/ holds ${shots.length} images; hand in the board, a detail view and a filtered view\n`);
  process.exit(1);
}

// The judge reads the dashboard's source whole only while it fits under 64 KiB. A page over that
// cap is cut mid-file in the dossier, so warn here rather than hand in a partly readable page.
const sourceBytes = readdirSync(join(out, 'dashboard'))
  .filter((name) => /\.(html|css|js|json|mjs|svg|md|txt)$/.test(name))
  .reduce((sum, name) => sum + statSync(join(out, 'dashboard', name)).size, 0);
if (sourceBytes > 65_536) {
  process.stderr.write(`radar: dashboard source is ${sourceBytes} bytes; the judge sees only the first 65,536\n`);
}

// buildDossier reads the finished /output, so it must be the last file written. It is byte for byte
// what the scorer rebuilds, including the cap on how much dashboard source the judge sees.
const dossier = buildDossier(out, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(out, 'dossier.json'), dossier);

process.stdout.write(
  `radar: ${radar.totals.protocols} protocols, ${radar.totals.watchlist} on the watchlist, ${radar.totals.rows} rows ` +
    `(${radar.totals.early} early, ${radar.totals.live} live set aside)\n` +
    `radar: rank 1 ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}\n` +
    `radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
