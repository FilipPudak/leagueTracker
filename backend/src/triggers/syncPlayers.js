// Weekly sync: scrape SWU site → update players, attendance, awards
import { getSettings, updateSetting, getAllActivePlayers } from '../db/queries.js';
import { fetchPlayerList, fetchSeasonStandings } from '../lib/scraping.js';
import { computeSchemer, computeAmbassador, writePodiumBlock, assignStandardRanks } from '../lib/awards.js';

export async function syncPlayers(env) {
  const { DB } = env;
  console.log('[SyncPlayers] Starting weekly sync...');

  const settings = await getSettings(DB);
  const votingOpen = settings.VOTING_OPEN === 'TRUE';
  const activeSeasonId = settings.ACTIVE_SEASON_ID ? Number(settings.ACTIVE_SEASON_ID) : null;
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

  let added = 0;
  let updated = 0;

  for (const [meleeKey, data] of scrapedPlayers) {
    const existing = existingMap.get(meleeKey);
    if (existing) {
      // Update name if changed
      if (existing.name !== data.name) {
        await DB.prepare('UPDATE players SET name = ? WHERE id = ?')
          .bind(data.name, existing.id).run();
        updated++;
      }
    } else {
      // New player — generate ID
      const maxId = existingPlayers.results
        ? Math.max(0, ...existingPlayers.results.map(p => {
            const num = parseInt(p.id.replace(/\D/g, ''), 10);
            return isNaN(num) ? 0 : num;
          }))
        : 0;
      const newId = 'P' + String(maxId + 1).padStart(3, '0');
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
      const playerMap = new Map((players || []).map(p => [p.melee_name?.toLowerCase(), p]));

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

  // 3. Refresh active season award podium (vote-based awards)
  const schemer = await computeSchemer(DB, activeSeasonId);
  if (schemer.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Schemer', schemer);
  }

  const ambassador = await computeAmbassador(DB, activeSeasonId);
  if (ambassador.length > 0) {
    await writePodiumBlock(DB, activeSeasonId, 'Galactic Ambassador', ambassador);
  }

  console.log('[SyncPlayers] Sync complete.');
}
