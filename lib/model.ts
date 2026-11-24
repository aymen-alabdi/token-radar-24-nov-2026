// The radar model. One sealed snapshot in, one ranked board out.
//
// Nothing here names a protocol. Every number comes from the snapshot's own ten fields: TVL, the
// seven-day TVL change, the day DefiLlama began tracking the protocol and the chain list. The model
// answers one question: if this protocol's record stayed exactly as it is, what would unrewarded
// activity be worth, and what should a reader do about it before a token exists?
//
//   implied = TVL x BASE
//           x momentum(change_7d)     current traction, capped so one week cannot dominate
//           x tenure(listed_at)       unrewarded time served with no token recorded
//           x reach(chains)           breadth of deployment, capped
//
// The live-token protocols are never scored. They are put in a separate view with the market's own
// market cap, so a reader can see what an issued token looks like beside the ones still to come.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The four public constants. The dashboard prints these and recomputes every row from them. */
export interface ModelConstants {
  base: number;
  momentum_weight: number;
  growth_floor: number;
  growth_cap: number;
  tenure_floor: number;
  tenure_span: number;
  tenure_days: number;
  unknown_age_days: number;
  reach_step: number;
  reach_max: number;
}

export const MODEL: ModelConstants = {
  base: 0.24,
  momentum_weight: 0.8,
  growth_floor: -80,
  growth_cap: 150,
  tenure_floor: 0.7,
  tenure_span: 0.5,
  tenure_days: 730,
  unknown_age_days: 365,
  reach_step: 0.05,
  reach_max: 5,
};

export const MODEL_VERSION = 'radar-2';
export const EARLY_ROWS = 200;
export const LIVE_ROWS = 24;

/** One scored row in board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  implied_value_usd: number;
  on_watchlist: boolean;
  tvl_rank: number;
  lift: number;
  parts: {
    base_usd: number;
    growth_pct: number;
    momentum: number;
    tenure: number;
    reach: number;
  };
  farm_steps: string[];
}

/** The compact row the page renders from data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  on_watchlist: boolean;
  tvl_rank: number;
  lift: number;
  momentum: number;
  tenure: number;
  reach: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  totals: { protocols: number; pre_token: number; live: number; watchlist: number; rows: number; early: number };
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Whole days between the snapshot date and the first day DefiLlama tracked this protocol. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The four multipliers, exposed so the page can show the same arithmetic as the board. */
export function parts(p: SnapshotProtocol, asOf: string, model: ModelConstants): { base_usd: number; growth_pct: number; momentum: number; tenure: number; reach: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const momentum = 1 + (growthPct / 100) * model.momentum_weight;
  const days = age ?? model.unknown_age_days;
  const tenure = model.tenure_floor + (clamp(days, 0, model.tenure_days) / model.tenure_days) * model.tenure_span;
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.reach_max);
  const reach = 1 + extraChains * model.reach_step;
  return { base_usd: p.tvl_usd * model.base, growth_pct: growthPct, momentum, tenure, reach, age };
}

/** The implied value in whole dollars. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const v = parts(p, asOf, model);
  return Math.max(1, Math.round(v.base_usd * v.momentum * v.tenure * v.reach));
}

/** DefiLlama records no token exactly when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Rankable means pre-token, not an exchange, and not a version pool of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The capital one position needs scales with the protocol's own TVL, not with its name. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** A younger record needs a longer window to be counted across more than one points snapshot. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 21;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** The primary action follows the protocol's category. No protocol name is special-cased. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string, age: number | null): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const hold = holdDaysFor(age);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC as collateral to ${name} on ${chain}, then borrow a small amount against it and leave both legs open for ${hold} days.`;
  }
  if (c.includes('dex') || c.includes('amm')) {
    return `Provide $${capital} of two-sided liquidity to ${name}'s deepest pool on ${chain}, and leave the position open for ${hold} days.`;
  }
  if (c.includes('yield') || c.includes('allocat') || c.includes('curator')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain}, record the share price at deposit, and keep the shares for ${hold} days.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's native asset through ${name} on ${chain}, keep the receipt token, and hold it for ${hold} days.`;
  }
  if (c.includes('bridge') || c.includes('canonical')) {
    return `Bridge $${capital} of USDC to ${chain} with ${name}, then use the bridged balance once in its destination app and hold for ${hold} days.`;
  }
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name}, open one small hedged position on ${chain}, and keep it for ${hold} days.`;
  }
  if (c.includes('stable')) {
    return `Mint or swap $${capital} of ${name}'s stable asset on ${chain}, hold the pegged position for ${hold} days, and redeem it only at the official app.`;
  }
  if (c.includes('rwa')) {
    return `Deposit $${capital} of USDC into ${name}'s yield product on ${chain} and keep the position for ${hold} days.`;
  }
  if (c.includes('insur')) {
    return `Buy $${capital} of cover through ${name} on ${chain}, keep the policy number, and hold the policy for ${hold} days.`;
  }
  if (c.includes('predict')) {
    return `Fund $${capital} on ${name} and take one small position on ${chain}, then keep the account active for ${hold} days.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain}, make one swap or deposit, and leave the position open for ${hold} days.`;
}

/** A step with its action, cash cost and clock time, as one gate-legal string. */
interface Step {
  text: string;
  cost: string;
  time: string;
}

function stepText(s: Step): string {
  let out = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
  if (out.length > 600) out = `${out.slice(0, 596)}...`;
  if (out.length < 20) out += ' Keep the position until the next check.';
  return out;
}

/** Seven concrete steps, each derived from this protocol's category, chain list, TVL and age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const steps: Step[] = [
    {
      text: `Use one fresh wallet for this farm, fund it with only the ${capital} dollars you are willing to leave idle, and store its seed phrase offline.`,
      cost: 'under $3 in gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Open ${p.name}'s own app and confirm its rewards page publishes no token for this contract; a missing DefiLlama token field is a record, not proof.`,
      cost: 'nothing to check; never pay a claim fee',
      time: '5 minutes',
    },
    {
      text: primaryAction(p, capital, chain, age),
      cost: `$${capital} of capital and roughly $${capital >= 150 ? 8 : 4} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: `Repeat one qualifying action each week on ${chain}: a deposit, a borrow, a swap, a vote or a small top-up, so the address is active in several weekly snapshots.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Leave the position untouched for ${hold} days from the first transaction; ${age === null ? 'the start date is unknown in the snapshot, so use the longer window' : `the snapshot dates tracking to ${p.listed_at}`} and short windows often count for nothing.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s official points or rewards page before you withdraw, and claim only from the link the protocol itself publishes, never from a message or a DM.`,
      cost: 'no fee to check; do not pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the first and last dates and every transaction hash; set an exit rule to unwind if TVL falls 30% or a token is announced before you qualify.`,
      cost: 'nothing but the log and normal exit gas',
      time: '10 minutes a week',
    },
  ];
  return steps.map(stepText);
}

/** The snapshot parsed and checked just far enough to score it. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new SnapshotError('snapshot.json lacks protocols or watchlist');
  const protocols: SnapshotProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, name or TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  if (o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('watchlist holds a non-string');
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** The whole board: every watchlist slug, then the strongest early protocols below the floor. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  const watchlist = new Set(snapshot.watchlist);
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const tvlOrder = snapshot.protocols.slice().sort((a, b) => b.tvl_usd - a.tvl_usd);
  const tvlRanks = new Map(tvlOrder.map((p, i) => [p.slug, i + 1]));

  const scored = [...chosen.values()].map((p) => {
    const v = parts(p, snapshot.as_of, model);
    return {
      p,
      value: Math.max(1, Math.round(v.base_usd * v.momentum * v.tenure * v.reach)),
      v,
    };
  });
  scored.sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map((s, i) => {
    const tvlRank = tvlRanks.get(s.p.slug) ?? 0;
    const rank = i + 1;
    return {
      rank,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.v.age,
      token_status: 'pre-token' as const,
      implied_value_usd: s.value,
      on_watchlist: watchlist.has(s.p.slug),
      tvl_rank: tvlRank,
      lift: tvlRank - rank,
      parts: {
        base_usd: s.v.base_usd,
        growth_pct: round4(s.v.growth_pct),
        momentum: round4(s.v.momentum),
        tenure: round4(s.v.tenure),
        reach: round4(s.v.reach),
      },
      farm_steps: farmSteps(s.p, s.v.age),
    };
  });
}

/** The issued-token view: the market's own market cap, never a model value. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      multiple: Math.round((p.mcap_usd! / Math.max(p.tvl_usd, 1)) * 100) / 100,
    }));
}

function compact(r: BoardRow): RadarRow {
  return {
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    on_watchlist: r.on_watchlist,
    tvl_rank: r.tvl_rank,
    lift: r.lift,
    momentum: r.parts.momentum,
    tenure: r.parts.tenure,
    reach: r.parts.reach,
    farm_steps: r.farm_steps,
  };
}

/** Board plus everything the page needs, in one object for data.js. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    totals: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      live: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      watchlist: snapshot.watchlist.length,
      rows: board.length,
      early: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    },
    rows: board.map(compact),
    live,
  };
  return { board, radar };
}

/** Refuse a board the gate would refuse, before writing it. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} step is ${s.length} characters`;
  }
  return null;
}

/** The page reads this script from beside dashboard/, with no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
