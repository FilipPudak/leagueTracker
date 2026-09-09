const LeagueCore = (() => {
  const CACHE_TTL_MS = 15 * 1000;

  function mapSettings(raw) {
    const s = raw || {};
    return {
      weeklyDeadlineDay: s.WEEKLY_DEADLINE_DAY ?? s.weeklyDeadlineDay ?? '',
      weeklyDeadlineTime: s.WEEKLY_DEADLINE_TIME ?? s.weeklyDeadlineTime ?? '',
      timezone: s.TIMEZONE ?? s.timezone ?? '',
    };
  }

  function computeSubtitle(boot) {
    const seasonName = (boot && boot.seasonName) || '';
    if (!seasonName) return '';
    const week = boot.week;
    if (week == null) return seasonName + ' — Season Ended';
    return seasonName + ' • Week ' + week;
  }

  function isFreshCache(viewCache, key, now) {
    const entry = viewCache ? viewCache[key] : null;
    if (!entry) return false;
    return (now - entry.ts) < CACHE_TTL_MS;
  }

  function resolvePlayerChoices(boot) {
    if (boot && Array.isArray(boot.unlinkedPlayers)) return boot.unlinkedPlayers;
    return (boot && boot.players) || [];
  }

  return { mapSettings, computeSubtitle, isFreshCache, resolvePlayerChoices, CACHE_TTL_MS };
})();

if (typeof globalThis !== 'undefined') globalThis.LeagueCore = LeagueCore;
