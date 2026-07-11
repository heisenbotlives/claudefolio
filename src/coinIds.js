// Maps the ticker you type in a transaction (left) to CoinGecko's
// internal id for that coin (right). To support a new coin, add one
// line here. Find a coin's id on its coingecko.com page — it's the
// "API id" shown in the coin's info section (and in the page URL).
// Coins that always trade at (essentially) one US dollar. Used for
// cost basis: giving up 500 USDT simply means giving up 500 dollars.
export const STABLECOINS = new Set([
  'USDT',
  'USDC',
  'DAI',
  'TUSD',
  'FDUSD',
  'USDS',
  'PYUSD',
])

export const COIN_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  BNB: 'binancecoin',
  XRP: 'ripple',
  SOL: 'solana',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  DOT: 'polkadot',
  LTC: 'litecoin',
  LINK: 'chainlink',
  AVAX: 'avalanche-2',
  SHIB: 'shiba-inu',
  XLM: 'stellar',
  ATOM: 'cosmos',
  UNI: 'uniswap',
  XMR: 'monero',
  ETC: 'ethereum-classic',
}
