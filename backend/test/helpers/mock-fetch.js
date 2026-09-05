// Fetch mock for testing scraping.js and handlers that call external APIs.

export function createFetchMock() {
  const responses = new Map();
  const errors = new Map();
  const counts = new Map();
  let defaultHandler = null;

  function setResponse(url, body) {
    responses.set(url, body);
  }

  function setError(url, message) {
    errors.set(url, message);
  }

  function setDefault(handler) {
    defaultHandler = handler;
  }

  function getFetchCount(url) {
    return counts.get(url) || 0;
  }

  function getTotalFetchCount() {
    let total = 0;
    for (const c of counts.values()) total += c;
    return total;
  }

  function reset() {
    responses.clear();
    errors.clear();
    counts.clear();
    defaultHandler = null;
  }

  async function handler(url) {
    counts.set(url, (counts.get(url) || 0) + 1);

    if (errors.has(url)) {
      throw new Error(errors.get(url));
    }

    if (responses.has(url)) {
      const body = responses.get(url);
      return {
        ok: true,
        status: 200,
        async text() { return body; },
      };
    }

    if (defaultHandler) {
      return defaultHandler(url);
    }

    // Default: 404
    return {
      ok: false,
      status: 404,
      async text() { return 'Not Found'; },
    };
  }

  return { setResponse, setError, setDefault, getFetchCount, getTotalFetchCount, reset, handler };
}
