import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVotingOpen, parseSeasonId } from '../../backend/src/db/queries.js';
import { renderRecap } from './layout.mjs';
import {
  aspectBreakdown,
  awardLeaders,
  buildSeasonTable,
  leaderPerformance,
  leaderPicks,
  matchTotal,
} from './metrics.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BACKEND_DIR = join(REPO_ROOT, 'backend');
const DB_NAME = 'league-tracker';
const DOCS_APP = join(REPO_ROOT, 'docs', 'app');
const DEFAULT_OUT = join(REPO_ROOT, '.opencode', 'preview');
const PAGE = { width: 1080, height: 1920, scale: 2 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const QUERY = {
  seasons: () => 'SELECT id, name, length, top_results FROM seasons ORDER BY id',
  players: () => 'SELECT id, name, melee_name FROM players',
  standings: (id) =>
    `SELECT season_id, round, player_id, wins, draws, losses, rank FROM season_standings WHERE season_id = ${id} ORDER BY round`,
  tournaments: (id) => `SELECT round, name, date, phase FROM melee_tournaments WHERE season_id = ${id} ORDER BY round`,
  votes: (id) =>
    `SELECT v.player_id, v.week, l.name, l."set" AS set_name, l.aspects FROM votes v JOIN leaders l ON l.id = v.leader_id WHERE v.season_id = ${id}`,
  awards: (id) => `SELECT award_name, player_id, score, rank FROM awards WHERE season_id = ${id}`,
  settings: () =>
    "SELECT key, value FROM settings WHERE key IN ('VOTING_OPEN', 'ACTIVE_SEASON_ID')",
};

const AMBASSADOR_CALLSIGNS = [
  'Gold Leader',
  'Green Leader',
  'Red Leader',
  'Blade Eleven',
  'Rogue One',
  'Phoenix Leader',
];

function maskAmbassador(playerIds) {
  return playerIds.map((_, index) => AMBASSADOR_CALLSIGNS[index] || `Vanguard-${index + 1}`).join(' \u00b7 ');
}

function parseArgs(argv) {
  const opts = {
    season: null,
    out: DEFAULT_OUT,
    shot: true,
    qr: false,
    minPicks: 4,
    topLeaders: 5,
    championshipDate: null,
    revealAmbassador: false,
    liveMask: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--season') opts.season = Number(argv[(i += 1)]);
    else if (arg === '--out') opts.out = resolve(process.cwd(), argv[(i += 1)]);
    else if (arg === '--no-shot') opts.shot = false;
    else if (arg === '--qr') opts.qr = true;
    else if (arg === '--min-picks') opts.minPicks = Number(argv[(i += 1)]);
    else if (arg === '--top-leaders') opts.topLeaders = Number(argv[(i += 1)]);
    else if (arg === '--championship-date') opts.championshipDate = argv[(i += 1)];
    else if (arg === '--reveal-ambassador') opts.revealAmbassador = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (opts.season !== null && !Number.isInteger(opts.season)) throw new Error('--season must be an integer');
  if (!Number.isInteger(opts.minPicks) || opts.minPicks < 1) throw new Error('--min-picks must be a positive integer');
  if (!Number.isInteger(opts.topLeaders) || opts.topLeaders < 1) throw new Error('--top-leaders must be a positive integer');
  if (!normalize(opts.out).startsWith(REPO_ROOT)) throw new Error(`--out must live inside the repo (${REPO_ROOT})`);
  return opts;
}

function usage() {
  return [
    'Usage: node tools/recap/build.mjs --season 7 [options]',
    '',
    '  --season <number>        season to recap (default: newest in D1)',
    '  --out <dir>              output directory (default: .opencode/preview)',
    '  --no-shot                write HTML only, skip the PNG screenshot',
    '  --qr                     add the footer QR and its scan hint (off by default)',
    '  --min-picks <n>          minimum votes for the win-rate card (default 4)',
    '  --top-leaders <n>        rows in the most-played card (default 5)',
    '  --championship-date <d>  championship night label, e.g. "Dec 9" (default: cut phase date)',
    '  --reveal-ambassador      show the real Ambassador name even while voting is live (internal only)',
  ].join('\n');
}

function wranglerBin() {
  const local = join(BACKEND_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(local)) throw new Error('wrangler is not installed — run `npm install` in backend/');
  return local;
}

function query(sql) {
  return new Promise((ok, fail) => {
    execFile(
      process.execPath,
      [wranglerBin(), 'd1', 'execute', DB_NAME, '--remote', '--json', '--command', sql],
      { cwd: BACKEND_DIR, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          fail(new Error(stderr.trim() || err.message));
          return;
        }
        const start = stdout.indexOf('[');
        if (start < 0) {
          fail(new Error('unexpected wrangler output'));
          return;
        }
        ok(JSON.parse(stdout.slice(start))[0].results || []);
      },
    );
  });
}

function shortDate(iso) {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function record(row) {
  return `${row.won}\u2013${row.drawn}\u2013${row.lost}`;
}

function joinNames(playerIds, names) {
  return playerIds.map((id) => names.get(id) || id).join(' \u00b7 ');
}

function leaderLabel(row) {
  return row.set ? `${row.name} - ${row.set}` : row.name;
}

function awardsBlock(awards, names, ruler, boardSize, championshipDate, liveMask) {
  const champion = awardLeaders(awards, 'Galactic Champion');
  const winnerOf = (award, format) => ({
    who: award ? joinNames(award.playerIds, names) : 'TBD',
    value: award ? format(award.score) : '',
  });
  const ambassador = awardLeaders(awards, 'Galactic Ambassador');
  const ambassadorWho = () => {
    if (!ambassador) return 'TBD';
    if (liveMask) return maskAmbassador(ambassador.playerIds);
    return joinNames(ambassador.playerIds, names);
  };

  return {
    awardsNote: champion ? `Crowned ${championshipDate}` : '',
    awards: [
      {
        icon: 'ruler',
        cls: '',
        label: 'Galactic Ruler',
        who: ruler ? ruler.name : 'TBD',
        value: ruler ? `${ruler.points} pts \u00b7 ${record(ruler)}` : '',
      },
      {
        icon: 'schemer',
        cls: '',
        label: 'Galactic Schemer',
        ...winnerOf(awardLeaders(awards, 'Galactic Schemer'), (score) => `${score} different leaders`),
      },
      {
        icon: 'ambassador',
        cls: '',
        label: 'Galactic Ambassador',
        who: ambassadorWho(),
        value: ambassador ? `${ambassador.score} votes received` : '',
      },
      {
        icon: 'newHope',
        cls: '',
        label: 'A New Hope',
        ...winnerOf(awardLeaders(awards, 'A New Hope'), (score) => `+${score} places climbed`),
      },
      {
        icon: 'bountyHunter',
        cls: '',
        label: 'Bounty Hunter',
        ...winnerOf(awardLeaders(awards, 'Bounty Hunter'), (score) => `${score} wins vs last season&rsquo;s top 4`),
      },
      champion
        ? { icon: 'champion', cls: '', label: 'Galactic Champion', ...winnerOf(champion, () => `Crowned ${championshipDate}`) }
        : {
            icon: 'champion',
            cls: ' champ',
            label: 'Galactic Champion',
            who: `Decided at the Top ${boardSize} final`,
            value: `Championship night \u00b7 ${championshipDate}`,
          },
    ],
  };
}

function buildModel(data, opts) {
  const { season, players, standings, tournaments, votes, awards } = data;
  const names = new Map(players.map((p) => [p.id, p.name || p.melee_name || p.id]));
  const regularRounds = new Set(tournaments.filter((t) => t.phase === 'regular').map((t) => t.round));
  const regular = standings.filter((row) => regularRounds.has(row.round));
  const table = buildSeasonTable(regular, players, season.top_results);
  const picks = leaderPicks(votes);
  const aspects = aspectBreakdown(picks);
  if (aspects.unpaired.heroism || aspects.unpaired.villainy) {
    console.warn(
      `warning: ${aspects.unpaired.heroism} heroism and ${aspects.unpaired.villainy} villainy vote(s) have no second (sphere) aspect — they count in the alignment bar but not in its combo row`,
    );
  }
  const performance = leaderPerformance(votes, regular);
  const matchedVotes = performance.reduce((sum, row) => sum + row.picks, 0);
  if (votes.length && matchedVotes < votes.length) {
    console.warn(`warning: ${votes.length - matchedVotes} vote(s) have no standings row for the same round — check week/round alignment`);
  }

  const nightCounts = [...regularRounds]
    .sort((a, b) => a - b)
    .map((round) => ({ label: `W${round}`, value: regular.filter((row) => row.round === round).length }));
  const appearances = nightCounts.reduce((sum, n) => sum + n.value, 0);

  const cut = tournaments.find((t) => t.phase === 'cut');
  const championshipDate =
    opts.championshipDate || (cut && cut.date ? shortDate(cut.date) : null) || 'TBD';
  const regularDates = tournaments.filter((t) => t.phase === 'regular' && t.date).map((t) => t.date).sort();
  const range = regularDates.length
    ? `${shortDate(regularDates[0])} \u2014 ${shortDate(regularDates[regularDates.length - 1])}`
    : '';
  const year = regularDates.length ? new Date(regularDates[regularDates.length - 1]).getUTCFullYear() : '';

  const boardSize = 4;
  const toBoardRow = (row, index, offset = 0) => ({
    pos: index + 1 + offset,
    name: row.name,
    record: record(row),
    points: row.points,
  });

  const mostPlayed = picks.slice(0, opts.topLeaders).map((pick) => ({
    name: leaderLabel(pick),
    aspects: pick.aspects,
    value: pick.count,
    display: pick.count,
  }));
  const bestPerforming = performance
    .filter((row) => row.picks >= opts.minPicks)
    .slice(0, opts.topLeaders)
    .map((row, index) => ({
      name: leaderLabel(row),
      aspects: row.aspects,
      value: Math.round(row.rate * 100),
      display: `${Math.round(row.rate * 100)}%`,
      accent: index < 3 ? 'gold' : '',
    }));

  const comboRows = [
    { label: 'Heroism', total: aspects.heroism, counts: aspects.combos.heroism },
    { label: 'Villainy', total: aspects.villainy, counts: aspects.combos.villainy },
  ].map((row) => ({
    label: row.label,
    total: row.total,
    segments: Object.entries(row.counts)
      .map(([aspect, count]) => ({ aspect, count, share: row.total ? count / row.total : 0 }))
      .sort((a, b) => b.count - a.count || a.aspect.localeCompare(b.aspect)),
  }));
  const setLine = Object.entries(aspects.sets)
    .sort((a, b) => b[1] - a[1])
    .map(([set, count]) => `${set} ${count}`)
    .join(' \u00b7 ');

  return {
    title: `Season ${season.id} Recap`,
    eyebrow: 'SWU Wednesday League \u00b7 Stockholm',
    subtitle: 'The Recap',
    seasonId: season.id,
    nightCount: nightCounts.length,
    range,
    hero: [
      { value: new Set(regular.map((row) => row.player_id)).size, label: 'Players' },
      { value: matchTotal(regular), label: 'Matches' },
      { value: (appearances / Math.max(nightCounts.length, 1)).toFixed(1), label: 'Players / night' },
      { value: picks.length, label: 'Leaders' },
      { value: aspects.total, label: 'Votes' },
    ],
    finalHead: 'Championship Night',
    finalSub: `Top ${boardSize} final &amp; Best of the Rest \u00b7 ${championshipDate}`,
    boards: [
      {
        kind: 'final',
        label: `Top ${boardSize} Final`,
        sub: `Best ${season.top_results} nights`,
        highlightTop: true,
        rows: table.slice(0, boardSize).map((row, index) => toBoardRow(row, index)),
      },
      {
        kind: 'rest',
        label: 'Best of the Rest',
        sub: `Seeds ${boardSize + 1}\u2013${boardSize * 2}`,
        highlightTop: false,
        rows: table.slice(boardSize, boardSize * 2).map((row, index) => toBoardRow(row, index, boardSize)),
      },
    ],
    ...awardsBlock(awards, names, table[0], boardSize, championshipDate, opts.liveMask),
    nights: nightCounts,
    mostPlayed: {
      head: 'Most-played leaders',
      note: `${picks.length} used`,
      rows: mostPlayed,
    },
    bestPerforming: {
      head: 'Best-performing leaders',
      note: `Win rate \u00b7 min ${opts.minPicks} votes`,
      rows: bestPerforming,
    },
    aspects: {
      head: 'Aspects played',
      note: 'bars by votes \u00b7 leaders by printings',
      heroism: aspects.heroism,
      villainy: aspects.villainy,
      neither: aspects.neither,
      total: aspects.total,
      combos: comboRows,
      leaderLine: `Heroism ${aspects.leaders.heroism} \u00b7 Villainy ${aspects.leaders.villainy} \u00b7 Neither ${aspects.leaders.neither}`,
      setLine,
    },
    foot: {
      left: `Season ${season.id} \u00b7 ${year}`,
      url: 'filippudak.github.io/leagueTracker/app',
      qr: opts.qr ? 'https://filippudak.github.io/leagueTracker/app/' : null,
    },
  };
}

function mimeFor(path) {
  return { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.woff2': 'font/woff2', '.js': 'text/javascript; charset=utf-8' }[extname(path)] || 'application/octet-stream';
}

function serveRepo() {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const path = normalize(join(REPO_ROOT, rel));
      try {
        if (!path.startsWith(REPO_ROOT)) throw new Error('outside root');
        const body = await readFile(path);
        res.writeHead(200, { 'content-type': mimeFor(path) });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => ok(server));
  });
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

function screenshot(url, target, chrome) {
  return new Promise((ok, fail) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--force-device-scale-factor=${PAGE.scale}`,
      `--window-size=${PAGE.width},${PAGE.height}`,
      '--virtual-time-budget=8000',
      `--screenshot=${target}`,
      url,
    ];
    execFile(chrome, args, { maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        fail(new Error(stderr.trim() || err.message));
        return;
      }
      ok();
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }

  const seasons = await query(QUERY.seasons());
  const seasonId = opts.season || Math.max(...seasons.map((s) => s.id));
  const season = seasons.find((s) => s.id === seasonId);
  if (!season) throw new Error(`season ${seasonId} not found`);

  const [players, standings, tournaments, votes, awards, settings] = await Promise.all([
    query(QUERY.players()),
    query(QUERY.standings(seasonId)),
    query(QUERY.tournaments(seasonId)),
    query(QUERY.votes(seasonId)).then((rows) =>
      rows.map((row) => ({ player_id: row.player_id, week: row.week, name: row.name, set: row.set_name, aspects: row.aspects })),
    ),
    query(QUERY.awards(seasonId)),
    query(QUERY.settings()),
  ]);

  const setting = Object.fromEntries(settings.map((row) => [row.key, row.value]));
  opts.liveMask =
    !opts.revealAmbassador &&
    isVotingOpen(setting.VOTING_OPEN) &&
    parseSeasonId(setting.ACTIVE_SEASON_ID) === seasonId;
  if (opts.liveMask) {
    console.log(`voting is live for season ${seasonId} — Ambassador masked (pass --reveal-ambassador to override)`);
  }

  const model = buildModel({ season, players, standings, tournaments, votes, awards }, opts);
  const assets = relative(opts.out, DOCS_APP).split(sep).join('/');
  const html = renderRecap(model, assets);

  await mkdir(opts.out, { recursive: true });
  const base = join(opts.out, `season-${seasonId}-recap`);
  await writeFile(`${base}.html`, html, 'utf8');
  await writeFile(`${base}.json`, JSON.stringify(model, null, 2), 'utf8');

  if (opts.shot) {
    const chrome = chromePath();
    if (!chrome) throw new Error('Chrome/Edge not found — set CHROME_PATH or pass --no-shot');
    const server = await serveRepo();
    try {
      const { port } = server.address();
      const url = `http://127.0.0.1:${port}/${relative(REPO_ROOT, `${base}.html`).split(sep).map(encodeURIComponent).join('/')}`;
      await screenshot(url, `${base}.png`, chrome);
    } finally {
      server.close();
    }
  }

  console.log(`season ${seasonId} recap → ${relative(process.cwd(), base)}.{html,json${opts.shot ? ',png' : ''}}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
