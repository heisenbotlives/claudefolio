// Looks up unknown tickers using CoinGecko's search, which ranks
// results by popularity. The built-in list in coinIds.js is always
// checked first and overrides anything found here.
//
// Answers are cached in browser storage so each ticker is searched
// at most once: ticker -> CoinGecko id, or null if CoinGecko has no
// coin with that exact ticker.

const CACHE_KEY = 'crypto-portfolio-coin-id-cache'

export function loadCoinIdCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY))
    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? saved
      : {}
  } catch {
    return {}
  }
}

export function saveCoinIdCache(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

// Returns the id of the most popular coin whose ticker matches
// exactly, or null if there is none. Throws on network/API failure
// so the caller can retry later instead of caching a wrong answer.
export async function searchCoinId(ticker) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const match = (data.coins || []).find(
    (c) => (c.symbol || '').toUpperCase() === ticker
  )
  return match ? match.id : null
}
