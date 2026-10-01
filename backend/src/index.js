import { handleGetAppData } from './handlers/getAppData.js';
import { handleLinkAccount } from './handlers/linkAccount.js';
import { handleUnlinkAccount } from './handlers/unlinkAccount.js';
import { handleSubmitVote } from './handlers/submitVote.js';
import { handleUpdateVote } from './handlers/updateVote.js';
import { handleGetAwardsData } from './handlers/getAwardsData.js';
import { handleGetMySeasonStats } from './handlers/getMySeasonStats.js';
import { handleGetMyCareerStats } from './handlers/getMyCareerStats.js';
import { handleGetStandingsData } from './handlers/getStandingsData.js';
import { handleGetPlayerProfile } from './handlers/getPlayerProfile.js';
import { handleStartNewSeason } from './handlers/startNewSeason.js';
import { handleBackfillFromMelee } from './handlers/backfillFromMelee.js';
import { handleTriggerWeeklyCycle } from './handlers/triggerWeeklyCycle.js';
import { handlePauseSeason, handleResumeSeason } from './handlers/pauseSeason.js';
import { handleAddLeaders, handleSetLeadersActive, handleRemoveLeaders } from './handlers/leaderManagement.js';
import { handleMaterializePastAwards } from './handlers/materializePastAwards.js';
import { handleGetVoteBootstrap } from './handlers/getVoteBootstrap.js';
import { findSessionByToken, touchSessionTimestamp } from './lib/auth.js';

const TOKEN_REQUIRED = ['submitVote', 'updateVote', 'unlinkAccount', 'getMySeasonStats', 'getMyCareerStats'];
const TOKEN_OPTIONAL = ['getAppData', 'getVoteBootstrap'];

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_READS_MAX = 90;
const RATE_LIMIT_WRITES_MAX = 10;
const WRITE_ACTIONS = new Set(['submitVote', 'updateVote', 'linkAccount', 'unlinkAccount']);
const RATE_LIMIT_SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = 0;

const PROBE_CRON = '15 */2 * * *';

function checkRateLimit(ip, action) {
  const now = Date.now();
  if (now - lastSweep > RATE_LIMIT_SWEEP_INTERVAL_MS) {
    lastSweep = now;
    for (const [key, entry] of rateLimitMap) {
      if (now - entry.start > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
    }
  }
  const isWrite = WRITE_ACTIONS.has(action);
  const max = isWrite ? RATE_LIMIT_WRITES_MAX : RATE_LIMIT_READS_MAX;
  const key = isWrite ? `${ip}:w` : `${ip}:r`;
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

// Central session resolution for token-gated actions: validates the token
// against the session store, touches activity (rolling TTL) via waitUntil,
// and hard-rejects required actions when no valid session exists.
async function resolveRequestSession(DB, action, token, ctx) {
  let session = null;
  if (TOKEN_REQUIRED.includes(action) || TOKEN_OPTIONAL.includes(action)) {
    if (token) {
      session = await findSessionByToken(DB, token);
      if (session) {
        const touch = touchSessionTimestamp(DB, token).catch(() => {});
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(touch);
      }
    }
    if (TOKEN_REQUIRED.includes(action) && !session) {
      const err = new Error('Session expired. Please re-link to continue.');
      err.status = 401;
      throw err;
    }
  }
  return session;
}

export default {
  async fetch(request, env, ctx) {
    const origin = new URL(request.url).hostname;
    const allowedOrigin = env.ALLOWED_ORIGIN || (origin === 'localhost' ? '*' : 'https://filippudak.github.io');
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, token } = body;

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!checkRateLimit(ip, action)) {
      return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const handlers = {
      getAppData: handleGetAppData,
      linkAccount: handleLinkAccount,
      unlinkAccount: handleUnlinkAccount,
      submitVote: handleSubmitVote,
      updateVote: handleUpdateVote,
      getAwardsData: handleGetAwardsData,
      getMySeasonStats: handleGetMySeasonStats,
      getMyCareerStats: handleGetMyCareerStats,
      getStandingsData: handleGetStandingsData,
      getPlayerProfile: handleGetPlayerProfile,
      startNewSeason: handleStartNewSeason,
      backfillFromMelee: handleBackfillFromMelee,
      triggerWeeklyCycle: handleTriggerWeeklyCycle,
      pauseCurrentSeason: handlePauseSeason,
      resumeCurrentSeason: handleResumeSeason,
      addLeaders: handleAddLeaders,
      setLeadersActive: handleSetLeadersActive,
      removeLeaders: handleRemoveLeaders,
      materializePastAwards: handleMaterializePastAwards,
      getVoteBootstrap: handleGetVoteBootstrap,
    };

    const handler = handlers[action];
    if (!handler) {
      return new Response(JSON.stringify({ success: false, error: 'Unknown action.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      // Centralized session resolution
      const session = await resolveRequestSession(env.DB, action, token, ctx);

      const result = await handler(body, env, session);
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const status = err.status || 500;
      const message = status === 500 ? 'Internal server error' : (err.message || 'Server error');
      return new Response(JSON.stringify({ success: false, error: message }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },

  // Cron trigger handlers
  async scheduled(event, env, _ctx) {
    const isProbe = event?.cron === PROBE_CRON;
    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO settings (key, value) VALUES ('${isProbe ? 'LAST_PROBE_AT' : 'LAST_CRON_AT'}', ?)`
      ).bind(new Date(event?.scheduledTime ?? Date.now()).toISOString()).run();
    } catch (err) {
      console.error('[Cron] heartbeat write failed:', err);
    }
    if (isProbe) {
      console.log('[Cron] probe heartbeat written; skipping sync.');
      return;
    }
    try {
      const { syncFromMelee } = await import('./triggers/syncFromMelee.js');
      const result = await syncFromMelee(env);
      console.log('[Cron] sync result:', JSON.stringify(result ?? 'ok'));
    } catch (err) {
      console.error('[Cron] syncFromMelee failed:', err);
    }
  },
};
