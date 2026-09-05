// Weekly advance: increment week, reopen voting, close season at final week
import { getSettings, updateSetting } from '../db/queries.js';
import { computeSchemer, computeAmbassador, writePodiumBlock, assignStandardRanks } from '../lib/awards.js';
import { fetchSeasonStandings } from '../lib/scraping.js';

async function findPlayerByMelee(DB, meleeName) {
  const row = await DB.prepare(
    'SELECT id FROM players WHERE LOWER(melee_name) = LOWER(?)'
  ).bind(meleeName).first();
  return row ? row.id : null;
}

export async function advanceWeek(env) {
  const { DB } = env;
  console.log('[AdvanceWeek] Starting weekly advance...');

  const settings = await getSettings(DB);
  const votingOpen = settings.VOTING_OPEN === 'TRUE';
  const activeSeasonId = settings.ACTIVE_SEASON_ID ? Number(settings.ACTIVE_SEASON_ID) : null;
  const currentWeek = settings.CURRENT_WEEK ? parseInt(settings.CURRENT_WEEK.replace(/\D/g, ''), 10) : 1;
  const seasonLength = settings.SEASON_LENGTH ? Number(settings.SEASON_LENGTH) : 11;

  if (!votingOpen || !activeSeasonId) {
    console.log('[AdvanceWeek] No active season or voting not open; skipping.');
    return;
  }

  const nextWeek = currentWeek + 1;

  if (nextWeek > seasonLength) {
    // Season ended — close voting and materialize all awards
    console.log('[AdvanceWeek] Season ended. Materializing awards...');

    await updateSetting(DB, 'VOTING_OPEN', 'FALSE');
    await updateSetting(DB, 'CURRENT_WEEK', 'Season Ended');

    // Vote-based awards
    const schemer = await computeSchemer(DB, activeSeasonId);
    if (schemer.length > 0) await writePodiumBlock(DB, activeSeasonId, 'Galactic Schemer', schemer);

    const ambassador = await computeAmbassador(DB, activeSeasonId);
    if (ambassador.length > 0) await writePodiumBlock(DB, activeSeasonId, 'Galactic Ambassador', ambassador);

    // Site-based awards (Galactic Ruler, A New Hope)
    const finalStandings = await fetchSeasonStandings(activeSeasonId, seasonLength);
    if (finalStandings) {
      // Galactic Ruler: rank 1
      const rank1 = finalStandings.filter(s => s.rank === 1);
      const rulerEntries = [];
      for (const s of rank1) {
        const resolvedId = await findPlayerByMelee(DB, s.username);
        if (resolvedId) rulerEntries.push({ playerId: resolvedId, score: s.points, name: s.name });
      }
      if (rulerEntries.length > 0) {
        await writePodiumBlock(DB, activeSeasonId, 'Galactic Ruler', rulerEntries.slice(0, 3));
      }

      // A New Hope: biggest climb from mid-season to final
      const midRound = Math.floor(seasonLength / 2);
      const midStandings = await fetchSeasonStandings(activeSeasonId, midRound);
      if (midStandings) {
        const midMap = new Map(midStandings.map(s => [s.username, s.rank]));
        const climbers = finalStandings
          .map(s => ({
            username: s.username,
            name: s.name,
            climb: (midMap.get(s.username) || 0) - s.rank,
          }))
          .filter(c => c.climb > 0)
          .sort((a, b) => b.climb - a.climb)
          .slice(0, 3);

        if (climbers.length > 0) {
          const hopeEntries = [];
          for (const c of climbers) {
            const resolvedId = await findPlayerByMelee(DB, c.username);
            if (resolvedId) hopeEntries.push({ playerId: resolvedId, score: c.climb, name: c.name });
          }
          if (hopeEntries.length > 0) {
            await writePodiumBlock(DB, activeSeasonId, 'A New Hope', hopeEntries.slice(0, 3));
          }
        }
      }
    }

    // Bounty Hunter placeholder (manual entry)
    const existingBH = await DB.prepare(
      "SELECT 1 FROM awards WHERE season_id = ? AND award_name = 'Bounty Hunter'"
    ).bind(activeSeasonId).first();
    if (!existingBH) {
      await DB.prepare(
        "INSERT INTO awards (season_id, award_name, player_id, score) VALUES (?, 'Bounty Hunter', '', NULL)"
      ).bind(activeSeasonId).run();
    }

    console.log('[AdvanceWeek] Season closed and awards materialized.');
  } else {
    // Advance to next week and reopen voting
    await updateSetting(DB, 'CURRENT_WEEK', `Week ${nextWeek}`);
    await updateSetting(DB, 'VOTING_OPEN', 'TRUE');
    console.log(`[AdvanceWeek] Advanced to Week ${nextWeek}. Voting reopened.`);
  }
}
