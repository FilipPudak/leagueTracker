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
    if (boot && Array.isArray(boot.players) && boot.players.length) return boot.players;
    return (boot && boot.unlinkedPlayers) || [];
  }

  function gamificationViewFor(isCurrentSeason, hasVoteData) {
    if (isCurrentSeason) return 'full';
    return hasVoteData ? 'summary' : 'hidden';
  }

  function leaderOptionLabel(leader) {
    if (!leader) return '';
    return leader.set ? `${leader.name} - ${leader.set}` : leader.name;
  }

  function voteSubmitAction(currentVote) {
    return currentVote ? 'updateVote' : 'submitVote';
  }

  function shouldRetryAsNewVote(message, isRetry) {
    return !isRetry && typeof message === 'string' && message.includes('No vote to update');
  }

  return { mapSettings, computeSubtitle, isFreshCache, resolvePlayerChoices, gamificationViewFor, leaderOptionLabel, voteSubmitAction, shouldRetryAsNewVote, CACHE_TTL_MS };
})();

if (typeof globalThis !== 'undefined') globalThis.LeagueCore = LeagueCore;
