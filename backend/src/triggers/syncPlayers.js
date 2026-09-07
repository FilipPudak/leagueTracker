// Weekly sync: scrape SWU site → update players, attendance, awards
import { getSettings, updateSetting, getAllActivePlayers, parseSeasonId } from '../db/queries.js';
import { isVotingOpen } from '../db/queries.js';
import { fetchPlayerList, fetchSeasonStandings } from '../lib/scraping.js';
import { computeSchemer, computeAmbassador, writePodiumBlock, assignStandardRanks } from '../lib/awards.js';

async function findPlayerByMelee(DB, meleeName) {
  const row = await DB.prepare(
    'SELECT id FROM players WHERE LOWER(melee_name) = LOWER(?)'
  ).bind(meleeName).first();
  return row ? row.id : null;
}

export async function syncPlayers(env) {
  const { DB } = env;
  console.log('[SyncPlayers] Starting weekly sync...');

  const settings = await getSettings(DB);
  const votingOpen = isVotingOpen(settings.VOTING_OPEN);
  const activeSeasonId = parseSeasonId(settings.ACTIVE_SEASON_ID);
  const currentWeek = settings.CURRENT_WEEK ? parseInt(settings.CURRENT_WEEK.replace(/\D/g, ''), 10) : 1;
  const seasonLength = settings.SEASON_LENGTH ? Number(settings.SEASON_LENGTH) : 11;

  if (!votingOpen || !activeSeasonId) {
    console.log('[SyncPlayers] No active season or voting not open; skipping.');
    return;
  }

  // 1. Sync players from SWU site
  const scrapedPlayers = await fetchPlayerList();
  if (!scrapedPlayers) {
    console.error('[SyncPlayers] Site unreachable or no players parsed; skipping sync.');
    return;
  }

  const existingPlayers = await DB.prepare('SELECT * FROM players').all();
  const existingMap = new Map((existingPlayers.results || []).map(p => [p.melee_name?.toLowerCase(), p]));
  const existingEmailMap = new Map((existingPlayers.results || []).filter(p => p.email).map(p => [p.email.toLowerCase(), p]));

  let nextId = (existingPlayers.results || []).reduce((max, p) => {
    const num = parseInt(p.id.replace(/\D/g, ''), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0) + 1;

  let added = 0;
  let updated = 0;

  for (const [meleeKey, data] of scrapedPlayers) {
    const existing = existingMap.get(meleeKey);
    if (existing) {
      if (existing.name !== data.name) {
        await DB.prepare('UPDATE players SET name = ? WHERE id = ?')
          .bind(data.name, existing.id).run();
        updated++;
      }
    } else {
      const newId = 'P' + String(nextId++).padStart(3, '0');
      await DB.prepare(
        'INSERT INTO players (id, name, melee_name, active) VALUES (?, ?, ?, 1)'
      ).bind(newId, data.name, data.meleeName).run();
      added++;
    }
  }

  console.log(`[SyncPlayers] Players: ${added} added, ${updated} updated`);

  // 2. Record attendance for the current week
  if (currentWeek <= seasonLength) {
    const standings = await fetchSeasonStandings(activeSeasonId, currentWeek);
    if (standings) {
      const players = await getAllActivePlayers(DB);
      const playerMap = new Map((players.results || []).map(p => [p.melee_name?.toLowerCase(), p]));

      let attendanceCount = 0;
      for (const entry of standings) {
        const player = playerMap.get(entry.username?.toLowerCase());
        if (player) {
          await DB.prepare(
            'INSERT OR IGNORE INTO attendance (season_id, week, player_id) VALUES (?, ?, ?)'
          ).bind(activeSeasonId, currentWeek, player.id).run();
          attendanceCount++;
        }
      }
      console.log(`[SyncPlayers] Attendance recorded for week ${currentWeek}: ${attendanceCount} players`);
    }
  }

  // 3. Refresh active season award podium (all awards)
  const schemer = await computeSchemer(DB, activeSeasonId);
  if (schemer.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Schemer', schemer);
  }

  const ambassador = await computeAmbassador(DB, activeSeasonId);
  if (ambassador.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Ambassador', ambassador);
  }

  // Site-based awards (Galactic Ruler, A New Hope)
  const standings = await fetchSeasonStandings(activeSeasonId, currentWeek);
  if (standings) {
    const top3 = standings.filter(s => s.rank <= 3).slice(0, 3);
    const rulerEntries = [];
    for (const s of top3) {
      const resolvedId = await findPlayerByMelee(DB, s.username);
      if (resolvedId) rulerEntries.push({ playerId: resolvedId, score: s.points, name: s.name });
    }
    if (rulerEntries.length > 0) {
      await writePodiumBlock(DB, activeSeasonId, 'Galactic Ruler', rulerEntries);
    }

    const midRound = Math.floor(seasonLength / 2);
    const midStandings = await fetchSeasonStandings(activeSeasonId, midRound);
    if (midStandings) {
      const midMap = new Map(midStandings.map(s => [s.username, s.rank]));
      const climbers = standings
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

  console.log('[SyncPlayers] Sync complete.');
}
