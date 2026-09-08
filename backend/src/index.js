import { handleGetAppData } from './handlers/getAppData.js';
import { handleLinkAccount } from './handlers/linkAccount.js';
import { handleUnlinkAccount } from './handlers/unlinkAccount.js';
import { handleSubmitVote } from './handlers/submitVote.js';
import { handleGetLeaderboardData } from './handlers/getLeaderboardData.js';
import { handleGetMySeasonStats } from './handlers/getMySeasonStats.js';
import { handleGetStandingsData } from './handlers/getStandingsData.js';
import { handleStartNewSeason } from './handlers/startNewSeason.js';
import { handleBackfillFromMelee } from './handlers/handleBackfillFromMelee.js';
import { handleSyncNow } from './handlers/syncNow.js';
import { handlePauseSeason, handleResumeSeason } from './handlers/pauseSeason.js';
import { handleAddLeaders, handleSetLeadersActive, handleRemoveLeaders } from './handlers/leaderManagement.js';
import { handleMaterializePastAwards } from './handlers/materializePastAwards.js';
import { findSessionByToken, touchSessionTimestamp } from './lib/auth.js';

const TOKEN_REQUIRED = ['submitVote', 'unlinkAccount', 'getMySeasonStats'];
const TOKEN_OPTIONAL = ['getAppData'];

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://filippudak.github.io';
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
    if (!checkRateLimit(ip)) {
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
      getLeaderboardData: handleGetLeaderboardData,
      getMySeasonStats: handleGetMySeasonStats,
      getStandingsData: handleGetStandingsData,
      startNewSeason: handleStartNewSeason,
      backfillFromMelee: handleBackfillFromMelee,
      syncNow: handleSyncNow,
      pauseCurrentSeason: handlePauseSeason,
      resumeCurrentSeason: handleResumeSeason,
      addLeaders: handleAddLeaders,
      setLeadersActive: handleSetLeadersActive,
      removeLeaders: handleRemoveLeaders,
      materializePastAwards: handleMaterializePastAwards,
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
      let session = null;
      if (TOKEN_REQUIRED.includes(action) || TOKEN_OPTIONAL.includes(action)) {
        if (token) {
          session = await findSessionByToken(env.DB, token);
          if (session) {
            touchSessionTimestamp(env.DB, token).catch(() => {});
          }
        }
        if (TOKEN_REQUIRED.includes(action) && !session) {
          const err = new Error('Session expired. Please re-link to continue.');
          err.status = 401;
          throw err;
        }
      }

      const result = await handler(body, env, session);
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const status = err.status || 500;
      return new Response(JSON.stringify({ success: false, error: err.message || 'Server error' }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },

  // Cron trigger handlers
  async scheduled(event, env) {
    try {
      const { syncFromMelee } = await import('./triggers/syncFromMelee.js');
      await syncFromMelee(env);
    } catch (err) {
      console.error('[Cron] syncFromMelee failed:', err);
    }
  },
};
