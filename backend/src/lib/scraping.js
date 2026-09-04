// SWU league site scraping
const BASE_URL = 'https://stockholm.sw-unlimited.com/';

// Parse standings from SWU site HTML
// Returns [{ username, name, rank, points }, ...] or null
export async function fetchSeasonStandings(seasonNumber, roundNumber) {
  const url = `${BASE_URL}season/${seasonNumber}/round/${roundNumber}`;

  let html;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    html = await response.text();
  } catch (err) {
    console.error(`[Scraping] Failed to fetch standings ${url}: ${err}`);
    return null;
  }
  if (!html) return null;

  // The page embeds a SvelteKit data payload containing a "standings" array.
  // Entries are JS object literals with UNQUOTED keys.
  const arrayMatch = html.match(/standings:\[([\s\S]*?)\],seasonWinCounts/);
  if (!arrayMatch) return null;

  const standings = [];
  const objRe = /\{([^{}]*)\}/g;
  let objMatch;
  while ((objMatch = objRe.exec(arrayMatch[1])) !== null) {
    const block = objMatch[1];
    const grab = (key) => {
      const m = block.match(new RegExp(key + ':([^,]*)'));
      if (!m) return '';
      return m[1].trim().replace(/^"|"$/g, '');
    };
    const user = grab('playerUsername');
    if (!user) continue;
    standings.push({
      username: user,
      name: grab('playerName'),
      rank: Number(grab('rank')),
      points: Number(grab('points')),
    });
  }

  if (standings.length === 0) {
    console.error(`[Scraping] Failed to parse standings ${url}`);
    return null;
  }
  return standings;
}

// Parse player list from SWU site homepage
// Returns Map<meleeNameLower, { meleeName, name }> or null
export async function fetchPlayerList() {
  let html;
  try {
    const response = await fetch(BASE_URL);
    if (!response.ok) return null;
    html = await response.text();
  } catch (err) {
    console.error(`[Scraping] Failed to fetch player list: ${err}`);
    return null;
  }

  const regex = /<a\s+href="\/player\/([^"]+)">([^<]+)<\/a>/gi;
  let match;
  const scrapedPlayers = new Map();

  while ((match = regex.exec(html)) !== null) {
    const meleeHandle = decodeURIComponent(match[1].trim());
    const displayName = match[2].trim();
    if (meleeHandle) {
      scrapedPlayers.set(meleeHandle.toLowerCase(), { meleeName: meleeHandle, name: displayName });
    }
  }

  return scrapedPlayers.size > 0 ? scrapedPlayers : null;
}
