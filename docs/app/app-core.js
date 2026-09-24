const LeagueCore = (() => {
  const CACHE_TTL_MS = 15 * 1000;

  // Canonical guest onboarding sentence — rendered verbatim into the desktop
  // pitch card and the mobile guest banner so the wording can never drift.
  const GUEST_PITCH = 'Standings are open to everyone — sign in with your email to cast your weekly vote and see your stats.';

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
    if (week == null) return seasonName + ' — Season Complete';
    const active = (boot.seasons || []).find((s) => String(s.id) === String(boot.seasonId));
    const seasonLength = active ? parseInt(active.length, 10) : NaN;
    return seasonName + ' • Night ' + week + (seasonLength > 0 ? ' / ' + seasonLength : '');
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

  function visibleListSlice(items, limit, expanded) {
    if (!Array.isArray(items)) return [];
    return expanded ? items : items.slice(0, limit);
  }

  function listToggleLabel(total, limit, expanded, noun) {
    if (expanded) return 'Show less';
    const label = noun || 'leaders';
    const plural = total !== 1 && !label.endsWith('s') ? label + 's' : label;
    return `Show all ${total} ${plural}`;
  }

  function voteSubmitAction(currentVote) {
    return currentVote ? 'updateVote' : 'submitVote';
  }

  // Vote-CTA gate: only surface the "go vote" prompt to a linked player whose
  // voting period is open, who has not voted, and who is not known to have
  // skipped the night. attended === null means "week data not known yet"
  // (grace) so it must NOT hide the CTA — mirrors validateVote's server rule;
  // only attended === false (confirmed non-attendance) hides it.
  function shouldShowVoteCta(state) {
    const s = state || {};
    if (!s.votingOpen || !s.linked || s.alreadyVoted) return false;
    return s.attended !== false;
  }

  function shouldRetryAsNewVote(message, isRetry) {
    return !isRetry && typeof message === 'string' && message.includes('No vote to update');
  }

  // Nights do not correlate across seasons: switching season must show that
  // season's latest night, so the stale picker round is omitted on change.
  function resolveStandingsAsOf(seasonChanged, selectValue) {
    if (seasonChanged) return '';
    return selectValue == null ? '' : String(selectValue);
  }

  // Award badges rendered next to player names: ★ = Ruler, 🏆 = Champion
  function awardBadgeMarkup(type, count) {
    const n = Number(count) || 0;
    if (n <= 0) return '';
    if (type === 'ruler') return '★';
    if (type === 'champion') return '🏆';
    return '';
  }

  function awardBadgeTitle(type, count) {
    const n = Number(count) || 0;
    if (n <= 0) return '';
    if (type === 'ruler') return 'Galactic Ruler';
    if (type === 'champion') return n + '× Galactic Champion';
    return '';
  }

  return { mapSettings, computeSubtitle, isFreshCache, resolvePlayerChoices, gamificationViewFor, leaderOptionLabel, visibleListSlice, listToggleLabel, voteSubmitAction, shouldShowVoteCta, shouldRetryAsNewVote, resolveStandingsAsOf, awardBadgeMarkup, awardBadgeTitle, GUEST_PITCH, CACHE_TTL_MS };
})();

if (typeof globalThis !== 'undefined') globalThis.LeagueCore = LeagueCore;
