# Claudefolio

A personal crypto portfolio tracker, inspired by the old Blockfolio app. Record your trades, and Claudefolio works out your balances, live values, and profit and loss for you. It runs in the browser and is designed to feel like a phone app.

## What it does

- Record transactions (deposit, withdraw, buy, sell), with balances calculated automatically from your transaction history rather than entered by hand.
- Live prices and coin search powered by the CoinGecko API, with autocomplete when you type a ticker.
- Portfolio value, per-coin value, and profit and loss shown in dollars and as a percentage, using average cost basis.
- Token logos pulled from CoinGecko.
- Export your data to a JSON file and import it back, so you control your own backups.

## How your data is handled

Your portfolio data is stored locally in your own browser. It is never sent to a server, and none of your holdings or trade history is part of this code or this repository. The export feature lets you save a backup file yourself.

## Built with

- React and Vite
- Tailwind CSS
- Lucide icons
- CoinGecko API for prices, coin search, and logos

## Running it locally

You'll need Node.js installed. Then:

```
npm install
npm run dev
```

This starts the app locally and gives you a web address to open in your browser.

## Status

A working personal project. Planned additions include tappable per-coin detail pages and price alerts.
