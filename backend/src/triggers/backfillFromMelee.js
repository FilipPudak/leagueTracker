import { MeleeClient } from '../lib/melee.js';
import { getSettings, parseSeasonId, parseWeek, isSeasonStarted } from '../db/queries.js';
import { fetchLeagueTournaments, buildWeekMap } from '../lib/meleeLeague.js';
import { syncSeasonData } from '../lib/leagueSync.js';

export async function backfillFromMelee(env, deps = {}) {
  const { DB } = env;
  const ClientClass = deps.MeleeClient || MeleeClient;
  const targetSeasonId = deps.seasonId || null;
  const maxTournaments = deps.maxTournaments || 5;
  const resync = deps.resync || false;
  const allowActiveSeason = deps.allowActiveSeason || false;

  console.log('[Backfill] Starting backfill...');

  const settings = await getSettings(DB);
  const activeSeasonId = parseSeasonId(settings.ACTIVE_SEASON_ID);
  const currentWeek = parseWeek(settings.CURRENT_WEEK);
  const seasonRunning = isSeasonStarted(settings.SEASON_STARTED);

  if (targetSeasonId != null && targetSeasonId === activeSeasonId && seasonRunning && !allowActiveSeason) {
    console.log(`[Backfill] Refused: season ${targetSeasonId} is active; pass allowActiveSeason to backfill it anyway.`);
    return {
      seasonId: targetSeasonId,
      refused: true,
      reason: 'active-season',
      tournaments: 0,
      standings: 0,
      matches: 0,
    };
  }

  const clientId = env.MELEE_CLIENT_ID || '';
  const clientSecret = env.MELEE_CLIENT_SECRET || '';
  const client = new ClientClass(clientId, clientSecret);

  let allTournaments;
  try {
    allTournaments = await fetchLeagueTournaments(client, { targetSeason: targetSeasonId });
  } catch (err) {
    console.error(`[Backfill] Tournament list fetch failed; aborting: ${err.message}`);
    return { seasonId: targetSeasonId, fetchFailed: true, tournaments: 0, standings: 0, matches: 0, error: err.message };
  }

  const seasonGroups = new Map();
  for (const t of allTournaments) {
    if (!seasonGroups.has(t.seasonNum)) seasonGroups.set(t.seasonNum, []);
    seasonGroups.get(t.seasonNum).push(t);
  }
  const orderedGroups = [...seasonGroups.entries()].sort((a, b) => b[0] - a[0]);

  let budget = maxTournaments;
  let totalTournaments = 0;
  let totalStandings = 0;
  let totalMatches = 0;

  for (const [seasonNum, tournaments] of orderedGroups) {
    await DB.prepare('INSERT OR IGNORE INTO seasons (id, name, created_date) VALUES (?, ?, ?)')
      .bind(seasonNum, `Season ${seasonNum}`, null).run();

    const isResyncTarget = resync && targetSeasonId === seasonNum;
    if (isResyncTarget) {
      await DB.prepare('DELETE FROM melee_tournaments WHERE season_id = ?').bind(seasonNum).run();
      await DB.prepare('DELETE FROM season_standings WHERE season_id = ?').bind(seasonNum).run();
      await DB.prepare('DELETE FROM match_results WHERE season_id = ?').bind(seasonNum).run();
      await DB.prepare('DELETE FROM attendance WHERE season_id = ?').bind(seasonNum).run();
      console.log(`[Backfill] Resync: wiped tournaments/standings/matches/attendance for season ${seasonNum}`);
    }

    const existingTournaments = await DB.prepare(
      'SELECT melee_id, round FROM melee_tournaments WHERE season_id = ?'
    ).bind(seasonNum).all();
    const existingRoundMap = new Map((existingTournaments.results || []).map(t => [t.melee_id, t.round]));
    const weekMap = buildWeekMap(tournaments, existingRoundMap);

    const capActiveSeason = seasonNum === activeSeasonId && allowActiveSeason;
    const maxAttendanceWeek = capActiveSeason && currentWeek != null ? currentWeek : Infinity;

    const engineResult = await syncSeasonData(DB, client, {
      seasonId: seasonNum,
      weekMap,
      budget,
      force: isResyncTarget,
      reactivate: false,
      auditVotes: false,
      maxAttendanceWeek,
      logPrefix: '[Backfill]',
    });

    budget -= engineResult.roundsProcessed;
    totalTournaments += engineResult.tournamentsInserted;
    totalStandings += engineResult.standingsRows;
    totalMatches += engineResult.matchesRows;
  }

  console.log(`[Backfill] Complete: ${totalTournaments} tournaments, ${totalStandings} standings, ${totalMatches} matches`);
  return { seasonId: targetSeasonId, tournaments: totalTournaments, standings: totalStandings, matches: totalMatches };
}
