const BASE_URL = 'https://melee.gg';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class MeleeClient {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this._authHeader = 'Basic ' + btoa(`${clientId}:${clientSecret}`);
  }

  async _fetch(path, params = {}) {
    const url = new URL(path, BASE_URL);
    for (const [key, val] of Object.entries(params)) {
      url.searchParams.set(key, String(val));
    }

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url.toString(), {
        headers: { 'Authorization': this._authHeader },
      });

      if (res.ok) {
        const text = await res.text();
        return JSON.parse(text);
      }

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10);
        const delay = (retryAfter || 1) * RETRY_DELAY_MS;
        console.warn(`[Melee] 429 rate limited, retry ${attempt + 1}/${MAX_RETRIES}, retry-after: ${retryAfter}s`);
        await sleep(delay);
        lastError = new Error(`Melee API rate limited (429)`);
        continue;
      }

      const body = await res.text().catch(() => '');
      lastError = new Error(`Melee API request failed: ${res.status} ${body}`);
      if (res.status >= 500) {
        await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      throw lastError;
    }

    throw new Error(`Melee API request failed after ${MAX_RETRIES} retries: ${lastError?.message}`);
  }

  async listTournaments(orgId, skip, take) {
    const params = { Game: 'StarWarsUnlimited', Skip: skip, Take: take };
    if (orgId != null) params.OrganizationId = orgId;
    return this._fetch('/api/tournament/list', params);
  }

  async getStandings(tournamentId) {
    return this._fetch('/api/standings', {
      tournamentId,
    });
  }

  async getMatches(tournamentId) {
    return this._fetch(`/api/match/list/${tournamentId}`);
  }

  async getPlayer(username) {
    return this._fetch(`/api/player/${encodeURIComponent(username)}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
