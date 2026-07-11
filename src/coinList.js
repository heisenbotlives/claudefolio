// Downloads the top 1,000 coins by market cap (ticker, name and
// CoinGecko id) for the autocomplete dropdown, and caches the list
// in browser storage for a day. If the download fails we quietly
// fall back to the last cached list (or no suggestions at all) —
// the rest of the app works fine without it.

// v2: entries now include each coin's logo image URL.
const CACHE_KEY = 'crypto-portfolio-coin-list-v2'
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // one day
// 2 pages x 250 coins = top 500. CoinGecko's anonymous limit is
// roughly 5 requests/minute, so more pages than this gets refused.
const PAGES = 2
const PAGE_GAP_MS = 5000

export function loadCachedCoinList() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY))
    return Array.isArray(saved?.coins) ? saved.coins : []
  } catch {
    return []
  }
}

export function cachedCoinListIsFresh() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY))
    return (
      Array.isArray(saved?.coins) &&
      saved.coins.length > 0 &&
      Date.now() - saved.fetchedAt < MAX_AGE_MS
    )
  } catch {
    return false
  }
}

let inFlight = null

// Fetches the pages one after another (never in parallel), and only
// once even if asked twice at the same time.
export function fetchCoinList() {
  if (!inFlight) {
    inFlight = doFetch().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function doFetch() {
  const coins = []
  let complete = true
  for (let page = 1; page <= PAGES; page++) {
    try {
      if (page > 1) {
        await new Promise((resolve) => setTimeout(resolve, PAGE_GAP_MS))
      }
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      for (const c of data) {
        if (c?.id && c?.symbol && c?.name) {
          coins.push({
            id: c.id,
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            image: typeof c.image === 'string' ? c.image : null,
          })
        }
      }
    } catch {
      complete = false
      break
    }
  }
  if (coins.length === 0) throw new Error('coin list fetch failed')
  // A partial list is still useful; fetchedAt 0 marks it stale so
  // the next load or manual Refresh tries to complete it.
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ fetchedAt: complete ? Date.now() : 0, coins })
  )
  return coins
}
