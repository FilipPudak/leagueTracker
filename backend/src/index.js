import { handleGetAppData } from './handlers/getAppData.js';
import { handleLinkAccount } from './handlers/linkAccount.js';
import { handleUnlinkAccount } from './handlers/unlinkAccount.js';
import { handleSubmitVote } from './handlers/submitVote.js';
import { handleGetLeaderboardData } from './handlers/getLeaderboardData.js';
import { handleGetMySeasonStats } from './handlers/getMySeasonStats.js';
import { enableFetchCache, disableFetchCache } from './lib/scraping.js';

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
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

    const { action, token, deviceId } = body;

    const handlers = {
      getAppData: handleGetAppData,
      linkAccount: handleLinkAccount,
      unlinkAccount: handleUnlinkAccount,
      submitVote: handleSubmitVote,
      getLeaderboardData: handleGetLeaderboardData,
      getMySeasonStats: handleGetMySeasonStats,
    };

    const handler = handlers[action];
    if (!handler) {
      return new Response(JSON.stringify({ success: false, error: 'Unknown action.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      enableFetchCache();
      const result = await handler(body, env);
      disableFetchCache();
      return new Response(JSON.stringify({ success: true, data: result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      disableFetchCache();
      const status = err.status || 500;
      return new Response(JSON.stringify({ success: false, error: err.message || 'Server error' }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },

  // Cron trigger handlers
  async scheduled(event, env) {
    enableFetchCache();
    try {
      const cron = event.cron;

      if (cron === '30 8 * * 1') {
        // syncPlayers: Monday 08:30
        const { syncPlayers } = await import('./triggers/syncPlayers.js');
        await syncPlayers(env);
      } else if (cron === '0 9 * * 1') {
        // advanceWeek: Monday 09:00
        const { advanceWeek } = await import('./triggers/advanceWeek.js');
        await advanceWeek(env);
      }
    } finally {
      disableFetchCache();
    }
  },
};
