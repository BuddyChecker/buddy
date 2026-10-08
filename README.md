# Buddy: your anti-rug sidekick

A Chrome extension that sits on top of the trading page you already use and checks the
memecoin you are looking at: launch bundles, linked wallets, copycat tokens and live risk
alerts. Everything comes from public on-chain and market data, and the code is open so you
can check exactly what it reads and what it does not.

[![Available in the Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install%20Buddy-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/buddy-your-anti-rug-sidek/cdcllbibkglhaonmlhilaplbggodhccf)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

**Install:** [Chrome Web Store](https://chromewebstore.google.com/detail/buddy-your-anti-rug-sidek/cdcllbibkglhaonmlhilaplbggodhccf) (free; works on Chrome, Brave, Edge and Arc)
· **Website:** [buddycheck.xyz](https://buddycheck.xyz) · **X:** [@Buddycheckxyz](https://x.com/Buddycheckxyz)

Only install Buddy from the official Chrome Web Store link above. You can also build it from
this repo and load it unpacked (see below).

## What it checks

Open a token on a supported site and the buddy builds a report on its own:

- **Market & security:** DexScreener + RugCheck (Solana) / GoPlus (EVM).
- **On-chain launch (Solana, tokens under 3 days old):** bundlers (wallets that bought in the
  dev's block), snipers in the next block, the dev buy and what the dev still holds. Read
  with the public Solana RPC (or your own Helius RPC) and cached locally.
- **Connected wallets:** a mini bubblemap of the top holders (insiders / LP pools / holders)
  with the LP pool left out of insider clusters.
- **Vamp checker:** same ticker or name on DexScreener → the original vs the copies, with the
  original's CA, age and market cap.
- **Live watch:** while the page is open it re-checks the token and alerts you if liquidity
  drops or the dev sells.
- **Risk light** on the buddy and on the toolbar icon (✓ / ? / !).

Supported sites: pump.fun, DexScreener, GMGN, Birdeye, Photon, Axiom, BullX, Padre, Fomo,
Solscan, DEXTools, Raydium and Jupiter.

## Privacy and safety

- **No wallet connection, no signing, no keys.** Buddy never asks for a seed phrase or a
  private key and cannot move funds.
- **Read-only:** it reads the page URL to know which token you are viewing and calls public
  APIs (see `host_permissions` in [`extension/scripts/build.mjs`](extension/scripts/build.mjs)).
- **Your keystrokes stay in the buddy:** what you type into it never reaches the page
  (`stopPropagation` inside a closed Shadow DOM), because some terminals have buy/sell hotkeys.
- **Local memory:** settings, watchlist and cached scans live in `chrome.storage` on your PC.
- **No accounts and no analytics.** The only calls to Buddy's own server are the website check,
  the tweet feed and the optional "Ask AI" line: they send the token, the project's website and
  an anonymous random install ID (used for rate limits). A build without `BUDDY_SERVER_URL` makes no calls to
  it at all.
- **Telegram alerts are opt-in** and go straight from your browser to your own bot.

## Build it yourself

Requires Node.js 22.12+ and `ffmpeg` on the PATH (used to resize the icons).

```bash
npm install
npm run build        # → extension/dist/
```

Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → pick `extension/dist/`.

```bash
npm run zip          # → extension/dist-store/ + a .zip, the same build sent to the Chrome Web Store
```

## Tests

```bash
npm test                              # unit tests + end-to-end tests in a real Chromium
BUDDY_SKIP_NETWORK=1 npm test         # skip the tests that hit live APIs
```

The end-to-end tests load the extension into Chromium (Playwright) against a local server that
mimics the trading pages.

## Repository layout

```
extension/          the Chrome extension (MV3)
  src/content.js    the buddy on the page (closed Shadow DOM), progressive report, live watch
  src/report.js     the report panel (key signals, launch, bubblemap, vamp check, socials)
  src/background.js service worker: cached scans, on-chain launch, risk light on the icon
  src/detect.js     which token each trading URL points to
  src/rules.json    drops the Origin header only for the public Solana RPC (it rejects browsers)
  scripts/build.mjs the build (esbuild) and the manifest
desk-buddy/         the scanners shared with the Buddy desktop app (token, launch, vamps, momentum)
                    and the buddy's UI (panels, sounds, toys)
character-studio/   the procedural avatar engine and its sounds
```

## License and credits

[AGPL-3.0-only](LICENSE).

- The avatar engine in `character-studio/` comes from
  [bible-strong-avatar-lab](https://github.com/smontlouis/bible-strong-avatar-lab) by
  Stéphane Montlouis-Calixte (AGPL-3.0), modified for Buddy.
- Sounds are derived from CC0 packs by Kenney and OpenGameArt contributors
  (see [`character-studio/public/sounds/LICENSE.txt`](character-studio/public/sounds/LICENSE.txt)).
- All characters in this repo are original.

Buddy shows public data and its own reading of it. It is not financial advice.
