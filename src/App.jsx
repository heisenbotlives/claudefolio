import { useEffect, useRef, useState } from 'react'
import { Wallet, CirclePlus, History, Save, ArrowLeft } from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  Tooltip,
} from 'recharts'
import { COIN_IDS, STABLECOINS } from './coinIds.js'
import {
  loadCoinIdCache,
  saveCoinIdCache,
  searchCoinId,
} from './coinLookup.js'
import {
  loadCachedCoinList,
  cachedCoinListIsFresh,
  fetchCoinList,
} from './coinList.js'

const STORAGE_KEY = 'crypto-portfolio-transactions'
const PRICE_REFRESH_MS = 60000

const TYPES = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
]

function loadTransactions() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

// Works through the whole transaction history in order, tracking
// for each coin both how much is held and the total dollars spent
// acquiring it (the cost basis, average cost method).
//
// `estimateValue(coin, amount)` supplies a dollar value for older
// transactions recorded before the app stored one.
function calculateBalances(transactions, estimateValue) {
  const totals = {}
  const get = (coin) => {
    if (!totals[coin]) totals[coin] = { amount: 0, cost: 0 }
    return totals[coin]
  }
  const acquire = (coin, amount, cost) => {
    const t = get(coin)
    t.amount += amount
    t.cost += cost
  }
  // Selling, spending or withdrawing removes coins at their average
  // cost, so the average cost of what remains stays the same.
  const dispose = (coin, amount) => {
    const t = get(coin)
    const avgCost = t.amount > 1e-9 ? t.cost / t.amount : 0
    t.cost = Math.max(0, t.cost - amount * avgCost)
    t.amount -= amount
  }
  for (const tx of transactions) {
    if (tx.type === 'deposit') {
      acquire(
        tx.coin,
        tx.amount,
        tx.usdValue ?? estimateValue(tx.coin, tx.amount)
      )
    } else if (tx.type === 'withdraw') {
      dispose(tx.coin, tx.amount)
    } else if (tx.type === 'buy' || tx.type === 'sell') {
      dispose(tx.outCoin, tx.outAmount)
      acquire(
        tx.inCoin,
        tx.inAmount,
        tx.usdValue ?? estimateValue(tx.outCoin, tx.outAmount)
      )
    }
  }
  return Object.entries(totals)
    .filter(([, t]) => Math.abs(t.amount) > 1e-9)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([coin, t]) => ({ coin, amount: t.amount, cost: t.cost }))
}

function formatAmount(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

function formatUsd(n) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n < 1 && n > -1 ? 6 : 2,
  })
}

function formatPnl(n) {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  // Always whole cents: "+$141.45", "−$0.43"
  return (
    sign +
    Math.abs(n).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    })
  )
}

function formatPct(n) {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return sign + Math.abs(n).toFixed(1) + '%'
}

// Green when up, red when down, grey within half a cent of even.
function pnlColor(n) {
  return n > 0.005
    ? 'text-emerald-400'
    : n < -0.005
      ? 'text-red-400'
      : 'text-slate-400'
}

// Shared looks, so the whole app stays consistent.
const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-800/80 text-slate-100 placeholder-slate-500 px-3 py-2.5 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500'
const cardClass = 'rounded-2xl border border-slate-800 bg-slate-900'
const headingClass =
  'text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2 px-1'
const secondaryButtonClass =
  'rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 px-3 py-2.5 font-medium text-slate-100'

const TYPE_BADGE = {
  deposit: 'bg-emerald-500/10 text-emerald-400',
  withdraw: 'bg-red-500/10 text-red-400',
  buy: 'bg-sky-500/10 text-sky-400',
  sell: 'bg-amber-500/10 text-amber-400',
}

// The four sections of the app, shown in the bottom navigation bar.
const NAV_TABS = [
  { id: 'portfolio', label: 'Portfolio', icon: Wallet },
  { id: 'add', label: 'Add Transaction', icon: CirclePlus },
  { id: 'history', label: 'Transactions', icon: History },
  { id: 'backup', label: 'Import/Export', icon: Save },
]

const LOGO_COLORS = [
  'bg-sky-600',
  'bg-violet-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-indigo-600',
]

// Chart time ranges: label shown on the button, days sent to
// CoinGecko's market chart API.
const CHART_RANGES = [
  { days: '1', label: '24H' },
  { days: '7', label: '7D' },
  { days: '30', label: '30D' },
  { days: '365', label: '1Y' },
]

// Chart data already fetched this session, so switching back to a
// range we've seen costs no extra API request.
const chartCache = new Map()

// Fetch one coin's price history, remembering it for the session
// so the same coin+range never costs a second request.
async function fetchChartSeries(coinId, rangeDays) {
  const cacheKey = `${coinId}:${rangeDays}`
  if (chartCache.has(cacheKey)) return chartCache.get(cacheKey)
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${rangeDays}`
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const data = (json.prices || []).map(([t, price]) => ({ t, price }))
  if (data.length === 0) throw new Error('empty')
  chartCache.set(cacheKey, data)
  return data
}

// The shared chart drawing: range buttons, one line, loading and
// failure states. Both the coin chart and the portfolio P&L chart
// use this, so they always look and behave the same.
function ChartView({ rangeDays, onRangeChange, points, failed }) {
  const tooltipDate = (t) =>
    new Date(t).toLocaleString(
      [],
      rangeDays === '1'
        ? { hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', year: 'numeric' }
    )

  return (
    <div>
      <div className="flex gap-1.5">
        {CHART_RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            onClick={() => onRangeChange(r.days)}
            className={
              'rounded-lg px-2.5 py-1 text-xs font-medium ' +
              (rangeDays === r.days
                ? 'bg-sky-500 text-slate-950'
                : 'border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200')
            }
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="mt-3 h-48">
        {failed ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Chart unavailable
          </div>
        ) : points === null ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Loading chart…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <YAxis domain={['auto', 'auto']} hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '0.5rem',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#e2e8f0' }}
                formatter={(value) => [formatUsd(value), 'Price']}
                labelFormatter={(label, payload) =>
                  payload?.[0]?.payload?.t
                    ? tooltipDate(payload[0].payload.t)
                    : ''
                }
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// Price chart for one coin, fetched only when shown.
function CoinChart({ coinId }) {
  const [rangeDays, setRangeDays] = useState('7')
  const [points, setPoints] = useState(null) // null = loading
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!coinId) {
      setFailed(true)
      return
    }
    let cancelled = false
    setPoints(null)
    setFailed(false)
    fetchChartSeries(coinId, rangeDays)
      .then((data) => {
        if (!cancelled) setPoints(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [coinId, rangeDays])

  return (
    <ChartView
      rangeDays={rangeDays}
      onRangeChange={setRangeDays}
      points={points}
      failed={failed}
    />
  )
}

// The whole portfolio's value over time: each held coin's history
// is fetched (one at a time, gently), then every moment's prices
// are multiplied by the CURRENT holding amounts and added up.
function PortfolioChart({ holdings }) {
  const [rangeDays, setRangeDays] = useState('7')
  const [points, setPoints] = useState(null)
  const [failed, setFailed] = useState(false)

  // Re-run when the holdings themselves change, not just the range.
  const holdingsKey = holdings
    .map((h) => `${h.id}:${h.amount}`)
    .sort()
    .join('|')

  useEffect(() => {
    const usable = holdings.filter((h) => h.id)
    if (usable.length === 0) {
      setFailed(true)
      return
    }
    let cancelled = false
    setPoints(null)
    setFailed(false)
    ;(async () => {
      try {
        const seriesList = []
        for (const h of usable) {
          seriesList.push({
            amount: h.amount,
            data: await fetchChartSeries(h.id, rangeDays),
          })
        }
        if (cancelled) return
        // Use the longest series' timestamps as the timeline; for
        // each moment, take every coin's most recent price at or
        // before that moment.
        const base = seriesList.reduce((a, b) =>
          b.data.length > a.data.length ? b : a
        )
        const pointers = seriesList.map(() => 0)
        const combined = base.data.map(({ t }) => {
          let total = 0
          seriesList.forEach((s, i) => {
            while (
              pointers[i] + 1 < s.data.length &&
              s.data[pointers[i] + 1].t <= t
            ) {
              pointers[i]++
            }
            total += s.amount * s.data[pointers[i]].price
          })
          return { t, price: total }
        })
        setPoints(combined)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [holdingsKey, rangeDays])

  return (
    <div>
      <ChartView
        rangeDays={rangeDays}
        onRangeChange={setRangeDays}
        points={points}
        failed={failed}
      />
      <p className="mt-2 text-xs text-slate-500">
        This chart applies your current holdings to past prices, so it
        shows how today's portfolio would have moved — not a record of
        what you actually held on each past date.
      </p>
    </div>
  )
}

// True on wide screens (e.g. a foldable phone opened up), updating
// live as the screen changes size. Matches Tailwind's `md` width.
const WIDE_QUERY = '(min-width: 768px)'
function useIsWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const onChange = (e) => setWide(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

// A coin's logo image; if there is no image (or it fails to load),
// a coloured circle with the ticker letters so nothing looks broken.
function CoinLogo({ coin, src, small = false }) {
  const [failed, setFailed] = useState(false)
  const sizeClass = small ? 'h-6 w-6 text-[8px]' : 'h-9 w-9 text-[10px]'
  if (!src || failed) {
    let hash = 0
    for (const ch of coin) hash += ch.charCodeAt(0)
    return (
      <div
        className={`${sizeClass} shrink-0 rounded-full flex items-center justify-center font-bold text-white ${
          LOGO_COLORS[hash % LOGO_COLORS.length]
        }`}
      >
        {coin.slice(0, 3)}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={`${sizeClass} shrink-0 rounded-full bg-slate-800`}
    />
  )
}

// A transaction from a backup file must look like one of ours.
function isValidTx(tx) {
  if (!tx || typeof tx !== 'object') return false
  if (tx.type === 'deposit' || tx.type === 'withdraw') {
    return typeof tx.coin === 'string' && Number.isFinite(tx.amount)
  }
  if (tx.type === 'buy' || tx.type === 'sell') {
    return (
      typeof tx.outCoin === 'string' &&
      Number.isFinite(tx.outAmount) &&
      typeof tx.inCoin === 'string' &&
      Number.isFinite(tx.inAmount)
    )
  }
  return false
}

// A coin ticker box with autocomplete: filters the cached coin list
// as you type and shows up to 8 matches underneath. Picking one
// fills the box and tells the app the coin's exact CoinGecko id.
function CoinInput({ id, value, onChange, onPick, placeholder, coinList }) {
  const [showList, setShowList] = useState(false)

  const query = value.trim().toUpperCase()
  const matches =
    showList && query
      ? coinList
          .filter(
            (c) =>
              c.symbol.startsWith(query) ||
              c.name.toUpperCase().startsWith(query)
          )
          .slice(0, 8)
      : []

  return (
    <div className="relative flex-1">
      <input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setShowList(true)
        }}
        onFocus={() => setShowList(true)}
        onBlur={() => setShowList(false)}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
      {matches.length > 0 && (
        <ul className="absolute z-10 mt-1.5 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 shadow-xl">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                // mousedown (not click) so it wins the race against
                // the input losing focus and hiding the list
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(c)
                  setShowList(false)
                }}
                className="w-full px-3 py-2.5 text-left hover:bg-slate-700"
              >
                <span className="font-semibold">{c.symbol}</span>{' '}
                <span className="text-sm text-slate-400">— {c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function App() {
  const [transactions, setTransactions] = useState(loadTransactions)
  const [type, setType] = useState('deposit')
  const [coinOut, setCoinOut] = useState('')
  const [amountOut, setAmountOut] = useState('')
  const [coinIn, setCoinIn] = useState('')
  const [amountIn, setAmountIn] = useState('')
  const [depositUsd, setDepositUsd] = useState('')
  const [error, setError] = useState('')
  const [backupMsg, setBackupMsg] = useState('')
  const [activeTab, setActiveTab] = useState('portfolio')
  const [selectedCoin, setSelectedCoin] = useState(null)
  const [showPnlChart, setShowPnlChart] = useState(false)
  const isWide = useIsWide()
  const importInputRef = useRef(null)
  const [prices, setPrices] = useState({})
  const [lastUpdated, setLastUpdated] = useState(null)
  const [priceError, setPriceError] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [resolvedIds, setResolvedIds] = useState(loadCoinIdCache)
  const [coinList, setCoinList] = useState(loadCachedCoinList)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions))
  }, [transactions])

  // Refresh the autocomplete coin list if the cached copy is more
  // than a day old (or missing). On failure we just keep whatever
  // we had — suggestions are a nice-to-have, not load-bearing.
  // Runs on page load and again if the user presses Refresh.
  useEffect(() => {
    if (cachedCoinListIsFresh()) return
    let cancelled = false
    fetchCoinList()
      .then((coins) => {
        if (!cancelled) setCoinList(coins)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshTick])

  // When a suggestion is picked we know the coin's exact id, so
  // remember it — no search needed later. The built-in list still
  // wins for coins it covers.
  function rememberPickedCoin(coin) {
    if (COIN_IDS[coin.symbol] !== undefined) return
    setResolvedIds((prev) => {
      if (prev[coin.symbol] === coin.id) return prev
      const next = { ...prev, [coin.symbol]: coin.id }
      saveCoinIdCache(next)
      return next
    })
  }

  const twoCoins = type === 'buy' || type === 'sell'
  const firstCoinLabel =
    type === 'buy' ? 'You spend' : type === 'sell' ? 'You sell' : 'Coin and amount'

  // The built-in list wins; searched-and-cached ids fill the gaps.
  // undefined = never searched yet, null = searched, CoinGecko has
  // no coin with that ticker.
  const idFor = (coin) =>
    COIN_IDS[coin] !== undefined
      ? COIN_IDS[coin]
      : resolvedIds[coin] !== undefined
        ? resolvedIds[coin]
        : undefined

  const priceFor = (coin) => {
    const id = idFor(coin)
    return id && prices[id] !== undefined ? prices[id] : null
  }

  // Dollar value of an amount of a coin: a dollar stablecoin is
  // worth its amount; anything else uses the current price.
  const estimateValue = (coin, amount) =>
    STABLECOINS.has(coin) ? amount : (priceFor(coin) ?? 0) * amount

  const balances = calculateBalances(transactions, estimateValue)

  // Tickers we hold but have never searched for.
  const unknownKey = balances
    .map((b) => b.coin)
    .filter((coin) => idFor(coin) === undefined)
    .sort()
    .join(',')

  useEffect(() => {
    if (!unknownKey) return
    let cancelled = false

    async function resolveUnknowns() {
      const updates = {}
      // One at a time, to stay gentle on the free API.
      for (const ticker of unknownKey.split(',')) {
        try {
          updates[ticker] = await searchCoinId(ticker)
        } catch {
          // Network/API hiccup: leave it unresolved so a manual
          // Refresh can retry, rather than caching a wrong answer.
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setResolvedIds((prev) => {
          const next = { ...prev, ...updates }
          saveCoinIdCache(next)
          return next
        })
      }
    }

    resolveUnknowns()
    return () => {
      cancelled = true
    }
  }, [unknownKey, refreshTick])

  // One comma-separated list of CoinGecko ids for every coin we hold,
  // so all prices come back in a single API request.
  const idsKey = [
    ...new Set(balances.map((b) => idFor(b.coin)).filter(Boolean)),
  ]
    .sort()
    .join(',')

  useEffect(() => {
    if (!idsKey) return
    let cancelled = false

    async function fetchPrices() {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${idsKey}&vs_currencies=usd`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (cancelled) return
        const fetched = {}
        for (const [id, value] of Object.entries(data)) {
          if (typeof value?.usd === 'number') fetched[id] = value.usd
        }
        setPrices((prev) => ({ ...prev, ...fetched }))
        setLastUpdated(new Date())
        setPriceError('')
      } catch {
        if (!cancelled) {
          setPriceError('Could not load prices. Will retry automatically.')
        }
      }
    }

    fetchPrices()
    const timer = setInterval(fetchPrices, PRICE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [idsKey, refreshTick])

  // Name and logo for a coin, from the cached coin list. Looked up
  // by the coin's priced CoinGecko id, so the logo always matches
  // the coin whose price is shown; if that id isn't in the list we
  // show nothing rather than risk another coin with the same ticker.
  const coinMetaBySymbol = {}
  const coinMetaById = {}
  for (const c of coinList) {
    if (!coinMetaBySymbol[c.symbol]) coinMetaBySymbol[c.symbol] = c
    if (!coinMetaById[c.id]) coinMetaById[c.id] = c
  }
  const metaFor = (coin) => {
    const id = idFor(coin)
    if (id) return coinMetaById[id] ?? null
    return coinMetaBySymbol[coin] ?? null
  }

  const pricedBalances = balances.filter((b) => priceFor(b.coin) !== null)
  const totalValue = pricedBalances.reduce(
    (sum, b) => sum + b.amount * priceFor(b.coin),
    0
  )
  const totalCost = pricedBalances.reduce((sum, b) => sum + b.cost, 0)
  const totalPnl = totalValue - totalCost
  const hasUnpriced = balances.length > pricedBalances.length

  function handleAdd(e) {
    e.preventDefault()
    const coin = coinOut.trim().toUpperCase()
    const amount = Number(amountOut)
    if (!coin || !Number.isFinite(amount) || amount <= 0) {
      setError('Enter a coin and an amount greater than zero.')
      return
    }
    let tx
    if (twoCoins) {
      const coin2 = coinIn.trim().toUpperCase()
      const amount2 = Number(amountIn)
      if (!coin2 || !Number.isFinite(amount2) || amount2 <= 0) {
        setError('Fill in both coins and both amounts (greater than zero).')
        return
      }
      if (coin2 === coin) {
        setError('The two coins must be different.')
        return
      }
      // What did the received coin cost? The dollar value of what
      // was given up, worked out at the moment of recording.
      const usdValue = STABLECOINS.has(coin)
        ? amount
        : priceFor(coin) !== null
          ? amount * priceFor(coin)
          : null
      if (usdValue === null) {
        setError(
          `No dollar price for ${coin} yet, so this can't be valued. ` +
            'Try Refresh, or wait a moment and add it again.'
        )
        return
      }
      tx = {
        id: crypto.randomUUID(),
        type,
        outCoin: coin,
        outAmount: amount,
        inCoin: coin2,
        inAmount: amount2,
        usdValue,
        date: new Date().toISOString(),
      }
    } else if (type === 'deposit') {
      // The deposit's dollar value: typed in, or worked out from
      // the amount (stablecoins) or the current price.
      let usdValue
      const typed = depositUsd.trim()
      if (typed !== '') {
        usdValue = Number(typed)
        if (!Number.isFinite(usdValue) || usdValue < 0) {
          setError('The dollar value must be a number (zero or more).')
          return
        }
      } else if (STABLECOINS.has(coin)) {
        usdValue = amount
      } else if (priceFor(coin) !== null) {
        usdValue = amount * priceFor(coin)
      } else {
        setError(
          `No dollar price for ${coin} yet — please fill in the ` +
            'dollar value box for this deposit.'
        )
        return
      }
      tx = {
        id: crypto.randomUUID(),
        type,
        coin,
        amount,
        usdValue,
        date: new Date().toISOString(),
      }
    } else {
      tx = {
        id: crypto.randomUUID(),
        type,
        coin,
        amount,
        date: new Date().toISOString(),
      }
    }
    setTransactions([...transactions, tx])
    setError('')
    setCoinOut('')
    setAmountOut('')
    setCoinIn('')
    setAmountIn('')
    setDepositUsd('')
  }

  function handleDelete(id) {
    setTransactions(transactions.filter((tx) => tx.id !== id))
  }

  // Bundle everything needed to rebuild the portfolio into a JSON
  // file and download it.
  function handleExport() {
    const backup = {
      app: 'crypto-portfolio',
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions,
      coinIdCache: resolvedIds,
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setBackupMsg(`Backup downloaded (${transactions.length} transactions).`)
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file again still works
    if (!file) return
    let data
    try {
      data = JSON.parse(await file.text())
    } catch {
      setBackupMsg('Could not read that file — it is not a portfolio backup.')
      return
    }
    if (
      !data ||
      !Array.isArray(data.transactions) ||
      !data.transactions.every(isValidTx)
    ) {
      setBackupMsg("That file doesn't look like a portfolio backup.")
      return
    }
    const ok = window.confirm(
      `Replace your current data (${transactions.length} transaction${
        transactions.length === 1 ? '' : 's'
      }) with this backup (${data.transactions.length} transaction${
        data.transactions.length === 1 ? '' : 's'
      })? Your current data will be overwritten.`
    )
    if (!ok) {
      setBackupMsg('Import cancelled — nothing was changed.')
      return
    }
    // Older backups might lack ids; give any missing ones an id so
    // the delete buttons keep working.
    setTransactions(
      data.transactions.map((tx) =>
        tx.id ? tx : { ...tx, id: crypto.randomUUID() }
      )
    )
    if (
      data.coinIdCache &&
      typeof data.coinIdCache === 'object' &&
      !Array.isArray(data.coinIdCache)
    ) {
      setResolvedIds((prev) => {
        const next = { ...prev, ...data.coinIdCache }
        saveCoinIdCache(next)
        return next
      })
    }
    setBackupMsg(
      `Imported ${data.transactions.length} transaction${
        data.transactions.length === 1 ? '' : 's'
      }.`
    )
  }

  // On a wide screen the Portfolio tab becomes two columns: banner
  // and P&L chart on the left, balances list on the right.
  const twoColumn = isWide && activeTab === 'portfolio'

  const pnlBlock = (
    <>
      <button
        type="button"
        onClick={() => setShowPnlChart((s) => !s)}
        className={secondaryButtonClass + ' w-full text-sm'}
      >
        {showPnlChart ? 'Hide P&L chart' : 'Show P&L chart'}
      </button>
      {showPnlChart && (
        <div className={cardClass + ' mt-3 p-4'}>
          <PortfolioChart
            holdings={balances.map((b) => ({
              id: idFor(b.coin) || null,
              amount: b.amount,
            }))}
          />
        </div>
      )}
    </>
  )

  const bannerBlock = (
        <>
          <div className="rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-5 py-5 shadow-lg shadow-indigo-950/40">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-blue-100/90">
              Portfolio value
            </div>
            <div className="font-display text-4xl font-bold tracking-tight tabular-nums mt-1.5 text-white">
              {balances.length === 0
                ? '$0.00'
                : lastUpdated
                  ? formatUsd(totalValue)
                  : '…'}
            </div>
            {lastUpdated && pricedBalances.length > 0 && (
              <div className="text-sm font-medium tabular-nums mt-1.5">
                <span
                  className={
                    totalPnl > 0.005
                      ? 'text-emerald-300'
                      : totalPnl < -0.005
                        ? 'text-red-300'
                        : 'text-blue-100/80'
                  }
                >
                  {formatPnl(totalPnl)}
                  {totalCost > 0
                    ? ` (${formatPct((totalPnl / totalCost) * 100)})`
                    : ''}
                </span>
                <span className="text-blue-100/70">
                  {' '}
                  · cost {formatUsd(totalCost)}
                </span>
              </div>
            )}
            {hasUnpriced && lastUpdated && (
              <div className="text-xs text-amber-300 mt-1.5">
                Excludes coins with no price data
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between px-1 text-xs text-slate-500">
            <span>
              {lastUpdated
                ? `Prices updated ${lastUpdated.toLocaleTimeString()}`
                : balances.length === 0
                  ? 'Add a transaction to see prices'
                  : 'Loading prices…'}
            </span>
            <button
              type="button"
              onClick={() => setRefreshTick((t) => t + 1)}
              className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-slate-200 font-medium"
            >
              Refresh
            </button>
          </div>
          {priceError && (
            <div className="mt-2 px-1 text-xs text-red-400">{priceError}</div>
          )}
        </>
  )

  return (
    <div className="h-dvh flex flex-col bg-slate-950 text-slate-100 antialiased pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="w-full max-w-md md:max-w-5xl mx-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Claudefolio
        </h1>
      </header>

      {activeTab === 'portfolio' && !isWide && (
        <div className="w-full max-w-md mx-auto shrink-0 px-4 pb-3">
          {bannerBlock}
        </div>
      )}

      <div
        className={
          'flex-1 min-h-0 flex ' +
          (twoColumn ? 'w-full max-w-5xl mx-auto gap-6 px-4' : '')
        }
      >
        {twoColumn && (
          <aside className="w-[22rem] shrink-0 overflow-y-auto pb-6">
            {bannerBlock}
            <div className="mt-4">{pnlBlock}</div>
          </aside>
        )}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div
          className={
            twoColumn ? 'pb-6' : 'max-w-md md:max-w-2xl mx-auto px-4 pb-6'
          }
        >
          {activeTab === 'portfolio' && (
            <section>
              {!isWide && pnlBlock}

              <h2 className={headingClass + (isWide ? '' : ' mt-5')}>
                Balances
              </h2>
              {balances.length === 0 ? (
                <p className={cardClass + ' text-slate-500 text-sm p-4'}>
                  No balances yet. Use Add Transaction below to record your
                  first one.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {balances.map(({ coin, amount, cost }) => {
                    const price = priceFor(coin)
                    const pnl = price !== null ? amount * price - cost : null
                    const name = metaFor(coin)?.name
                    return (
                      <li key={coin} className={cardClass}>
                        <button
                          type="button"
                          onClick={() => setSelectedCoin(coin)}
                          aria-label={`Open ${coin} details`}
                          className="w-full px-4 py-3.5 text-left"
                        >
                        <div className="flex items-center gap-3">
                          <CoinLogo coin={coin} src={metaFor(coin)?.image} />
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-base leading-tight">
                              {coin}
                            </div>
                            <div className="text-xs text-slate-500 tabular-nums mt-0.5 truncate">
                              {price !== null
                                ? name
                                  ? `${name} · ${formatUsd(price)}`
                                  : `${formatUsd(price)} per coin`
                                : idFor(coin)
                                  ? 'Price loading…'
                                  : idFor(coin) === undefined
                                    ? 'Finding coin…'
                                    : 'Price unavailable'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div
                              className={
                                'font-semibold text-base tabular-nums ' +
                                (amount < 0 ? 'text-red-400' : '')
                              }
                            >
                              {price !== null
                                ? formatUsd(amount * price)
                                : '—'}
                            </div>
                            <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                              {formatAmount(amount)} {coin}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2.5 text-xs tabular-nums">
                          <span className="text-slate-500">
                            Cost {formatUsd(cost)}
                          </span>
                          {pnl !== null ? (
                            <span className={'font-medium ' + pnlColor(pnl)}>
                              {formatPnl(pnl)}
                              {cost > 0
                                ? ` (${formatPct((pnl / cost) * 100)})`
                                : ''}
                            </span>
                          ) : (
                            <span className="text-slate-600">P&L —</span>
                          )}
                        </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {activeTab === 'add' && (
            <section>
              <h2 className={headingClass}>Add transaction</h2>
          <form onSubmit={handleAdd} className={cardClass + ' p-4 space-y-4'}>
            <div>
              <label htmlFor="tx-type" className="block text-sm text-slate-400 mb-1.5">
                Type
              </label>
              <select
                id="tx-type"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={inputClass}
              >
                {TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-sm text-slate-400 mb-1.5">{firstCoinLabel}</span>
              <div className="flex gap-2">
                <CoinInput
                  id="coin-out"
                  value={coinOut}
                  onChange={setCoinOut}
                  onPick={(c) => {
                    setCoinOut(c.symbol)
                    rememberPickedCoin(c)
                  }}
                  placeholder="Coin (e.g. USDT)"
                  coinList={coinList}
                />
                <input
                  id="amount-out"
                  value={amountOut}
                  onChange={(e) => setAmountOut(e.target.value)}
                  placeholder="Amount"
                  inputMode="decimal"
                  className={inputClass + ' flex-1'}
                />
              </div>
            </div>

            {type === 'deposit' && (
              <div>
                <span className="block text-sm text-slate-400 mb-1.5">
                  Dollar value at the time (what it cost you)
                </span>
                <input
                  id="deposit-usd"
                  value={depositUsd}
                  onChange={(e) => setDepositUsd(e.target.value)}
                  placeholder="Optional — blank uses today's price"
                  inputMode="decimal"
                  className={inputClass}
                />
              </div>
            )}

            {twoCoins && (
              <div>
                <span className="block text-sm text-slate-400 mb-1.5">You receive</span>
                <div className="flex gap-2">
                  <CoinInput
                    id="coin-in"
                    value={coinIn}
                    onChange={setCoinIn}
                    onPick={(c) => {
                      setCoinIn(c.symbol)
                      rememberPickedCoin(c)
                    }}
                    placeholder="Coin (e.g. BTC)"
                    coinList={coinList}
                  />
                  <input
                    id="amount-in"
                    value={amountIn}
                    onChange={(e) => setAmountIn(e.target.value)}
                    placeholder="Amount"
                    inputMode="decimal"
                    className={inputClass + ' flex-1'}
                  />
                </div>
              </div>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              className="w-full rounded-xl bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-slate-950 font-semibold py-3"
            >
              Add transaction
            </button>
          </form>
            </section>
          )}

          {activeTab === 'history' && (
            <section>
              <h2 className={headingClass}>Transactions</h2>
              {transactions.length === 0 ? (
                <p className={cardClass + ' text-slate-500 text-sm p-4'}>
                  No transactions yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {[...transactions].reverse().map((tx) => (
                    <li
                      key={tx.id}
                      className={
                        cardClass +
                        ' px-4 py-3 flex items-center justify-between gap-3'
                      }
                    >
                      <div className="flex shrink-0 -space-x-2">
                        {(tx.type === 'deposit' || tx.type === 'withdraw') && (
                          <CoinLogo
                            coin={tx.coin}
                            src={metaFor(tx.coin)?.image}
                            small
                          />
                        )}
                        {(tx.type === 'buy' || tx.type === 'sell') && (
                          <>
                            <CoinLogo
                              coin={tx.inCoin}
                              src={metaFor(tx.inCoin)?.image}
                              small
                            />
                            <CoinLogo
                              coin={tx.outCoin}
                              src={metaFor(tx.outCoin)?.image}
                              small
                            />
                          </>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              'rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
                              (TYPE_BADGE[tx.type] ||
                                'bg-slate-700 text-slate-300')
                            }
                          >
                            {TYPES.find((t) => t.id === tx.type)?.label}
                          </span>
                          <span className="text-xs text-slate-500">
                            {new Date(tx.date).toLocaleString([], {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </span>
                        </div>
                        <div className="mt-1 text-sm tabular-nums">
                          {tx.type === 'deposit' && (
                            <span className="text-emerald-400">
                              +{formatAmount(tx.amount)} {tx.coin}
                            </span>
                          )}
                          {tx.type === 'withdraw' && (
                            <span className="text-red-400">
                              −{formatAmount(tx.amount)} {tx.coin}
                            </span>
                          )}
                          {(tx.type === 'buy' || tx.type === 'sell') && (
                            <>
                              <span className="text-emerald-400">
                                +{formatAmount(tx.inAmount)} {tx.inCoin}
                              </span>{' '}
                              <span className="text-red-400">
                                −{formatAmount(tx.outAmount)} {tx.outCoin}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(tx.id)}
                        aria-label="Delete transaction"
                        className="shrink-0 rounded-lg px-2.5 py-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === 'backup' && (
            <section>
              <h2 className={headingClass}>Backup</h2>
              <div className={cardClass + ' p-4'}>
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={handleExport}
                    className={secondaryButtonClass + ' flex-1'}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={() => importInputRef.current?.click()}
                    className={secondaryButtonClass + ' flex-1'}
                  >
                    Import
                  </button>
                  <input
                    ref={importInputRef}
                    id="import-file"
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportFile}
                    className="hidden"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  Export saves all your transactions to a file on this device.
                  Import restores from a previously exported file.
                </p>
                {backupMsg && (
                  <p className="text-xs text-sky-400 mt-2">{backupMsg}</p>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
      </div>

      <nav className="border-t border-slate-800 bg-slate-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md md:max-w-2xl mx-auto grid grid-cols-4">
          {NAV_TABS.map((t) => {
            const Icon = t.icon
            const active = activeTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                aria-label={t.label}
                className={
                  'flex flex-col items-center gap-1 pt-2.5 pb-3 text-[10px] font-medium ' +
                  (active
                    ? 'text-sky-400'
                    : 'text-slate-500 hover:text-slate-300')
                }
              >
                <Icon className="h-5 w-5" />
                {t.label}
              </button>
            )
          })}
        </div>
      </nav>

      {selectedCoin &&
        (() => {
          // Everything below reuses the numbers already calculated
          // for the portfolio, so this panel always agrees with it.
          const holding = balances.find((b) => b.coin === selectedCoin)
          const amount = holding?.amount ?? 0
          const cost = holding?.cost ?? 0
          const price = priceFor(selectedCoin)
          const pnl = price !== null ? amount * price - cost : null
          const name = metaFor(selectedCoin)?.name
          const coinTxs = [...transactions]
            .reverse()
            .filter(
              (tx) =>
                tx.coin === selectedCoin ||
                tx.inCoin === selectedCoin ||
                tx.outCoin === selectedCoin
            )
          return (
            <div className="slide-over fixed inset-0 z-50 flex flex-col bg-slate-950 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
              <header className="w-full max-w-md md:max-w-5xl mx-auto flex items-center gap-3 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
                <button
                  type="button"
                  onClick={() => setSelectedCoin(null)}
                  aria-label="Back to balances"
                  className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <CoinLogo
                  coin={selectedCoin}
                  src={metaFor(selectedCoin)?.image}
                />
                <div className="min-w-0">
                  <div className="font-display text-lg font-bold leading-tight truncate">
                    {name || selectedCoin}
                  </div>
                  <div className="text-xs text-slate-500">{selectedCoin}</div>
                </div>
              </header>

              <div className="flex-1 overflow-y-auto">
                <div className="max-w-md md:max-w-5xl mx-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] md:grid md:grid-cols-2 md:gap-8">
                  <div>
                  <div className="font-display text-3xl font-bold tracking-tight tabular-nums">
                    {price !== null ? formatUsd(price) : '—'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 mb-4">
                    Current price
                  </div>

                  <CoinChart coinId={idFor(selectedCoin) || null} />
                  </div>

                  <div>
                  <div className={cardClass + ' mt-5 md:mt-0 p-4 text-sm tabular-nums'}>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Your balance</span>
                      <span className="font-medium">
                        {formatAmount(amount)} {selectedCoin}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-slate-500">Current value</span>
                      <span className="font-medium">
                        {price !== null ? formatUsd(amount * price) : '—'}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-slate-500">Cost basis</span>
                      <span className="font-medium">{formatUsd(cost)}</span>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between border-t border-slate-800 pt-2.5">
                      <span className="text-slate-500">Profit / loss</span>
                      {pnl !== null ? (
                        <span className={'font-semibold ' + pnlColor(pnl)}>
                          {formatPnl(pnl)}
                          {cost > 0
                            ? ` (${formatPct((pnl / cost) * 100)})`
                            : ''}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </div>
                  </div>

                  <h2 className={headingClass + ' mt-6'}>
                    {selectedCoin} transactions
                  </h2>
                  {coinTxs.length === 0 ? (
                    <p className={cardClass + ' text-slate-500 text-sm p-4'}>
                      No transactions for this coin.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {coinTxs.map((tx) => (
                        <li key={tx.id} className={cardClass + ' px-4 py-3'}>
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                'rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
                                (TYPE_BADGE[tx.type] ||
                                  'bg-slate-700 text-slate-300')
                              }
                            >
                              {TYPES.find((t) => t.id === tx.type)?.label}
                            </span>
                            <span className="text-xs text-slate-500">
                              {new Date(tx.date).toLocaleString([], {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}
                            </span>
                          </div>
                          <div className="mt-1 text-sm tabular-nums">
                            {tx.type === 'deposit' && (
                              <span className="text-emerald-400">
                                +{formatAmount(tx.amount)} {tx.coin}
                              </span>
                            )}
                            {tx.type === 'withdraw' && (
                              <span className="text-red-400">
                                −{formatAmount(tx.amount)} {tx.coin}
                              </span>
                            )}
                            {(tx.type === 'buy' || tx.type === 'sell') && (
                              <>
                                <span className="text-emerald-400">
                                  +{formatAmount(tx.inAmount)} {tx.inCoin}
                                </span>{' '}
                                <span className="text-red-400">
                                  −{formatAmount(tx.outAmount)} {tx.outCoin}
                                </span>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
    </div>
  )
}

export default App
