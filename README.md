# WITNESS

The community-powered on-chain intelligence network. Visitors sign in with a Solana wallet, investigate wallets with live chain data, submit findings backed by transaction signatures, review each other's work, and earn reputation for findings that hold up. Coins can also be launched on pump.fun from the site.

- **No npm dependencies.** Plain Node 22 with its built-in SQLite. Nothing to install, nothing to keep updated.
- **No passwords or emails.** Sign-in is a free message signature from the wallet, never a transaction.
- **Keys stay on the server.** The Helius and Pinata keys never reach the browser. The server never sees anyone's private key.

---

## Put it live on Railway (about 15 minutes)

### 1. Get your two keys
| Key | Where | Cost | What it switches on |
|---|---|---|---|
| `HELIUS_API_KEY` | [dashboard.helius.dev](https://dashboard.helius.dev): sign up, copy the API key | Free tier is enough to start | Explore, evidence checks, watchlist activity, sending launches |
| `PINATA_JWT` | [app.pinata.cloud](https://app.pinata.cloud): API Keys → New Key → tick Admin, or at least file upload → copy the **JWT** | Free tier is enough to start | Coin launches (image and metadata hosting) |

The site runs without either key. The features that need them show a clear "not switched on" message until you add them.

### 2. Put the code on GitHub
1. Create a new **private** repository on GitHub, for example `witness`.
2. Upload the contents of this folder (Add file → Upload files, then drag everything in). The included `.gitignore` keeps your database and `.env` out of it.

### 3. Deploy on Railway
1. Go to [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → pick `witness`.
2. Open the service → **Variables** → add `HELIUS_API_KEY` and `PINATA_JWT`.
3. **Add a volume, or you lose all data on every redeploy.** Right-click the service (or ⌘K → "Volume") → **Add Volume** → mount path `/data`. The app finds it automatically.
4. **Settings → Networking → Generate Domain.** You get a `something.up.railway.app` address.
5. Open it. `/api/health` should show `{"ok":true,"explore":true,"launch":true}`.

### 4. Your own domain (optional)
Settings → Networking → **Custom Domain** → enter it, then add the CNAME record Railway shows at your domain registrar.

---

## Run it on your computer
```bash
cp .env.example .env   # paste your keys in
npm start              # http://localhost:3000
npm test               # 18 end-to-end tests, no network needed
```
Needs Node 22.13 or later. Wallet extensions only work over `http://localhost` or `https://`, not when you open the files directly.

---

## How it works

| Page | What's real |
|---|---|
| `/` Landing | Live feed of the latest investigations |
| `/app` Dashboard | Live stats; Explore (any Solana wallet or tx via Helius); Watchlists; Submit; Profiles |
| `/investigations` | Search and filter all cases |
| `/investigation?id=` | Evidence checked on-chain, interpretation and speculation kept separate, confirm and challenge, contributors, activity |
| `/leaderboard` | Reputation computed from outcomes, by week, month or all time |
| `/how-it-works` | Rules pulled live from the server |
| `/launch` | pump.fun launch through the creator's own wallet; every launch is listed publicly |

**Status rules** (edit in `lib/scoring.js`): *verified* at 3+ confirmations with at least 2 per challenge; *disputed* at 2+ challenges that match or outnumber confirmations. Authors can't review their own cases, and challenges need a written reason.

**Reputation** is recalculated from the records every time, so changing a number in `lib/scoring.js` updates everyone's score at once.

**Evidence checks:** every transaction signature is looked up on Solana. It is marked *On-chain ✓* if it exists and succeeded, *Not found* otherwise, and flagged if the investigated wallet isn't part of the transaction.

## Files
```
server.js          routes, static files, security headers
lib/db.js          database tables
lib/auth.js        wallet sign-in and sessions
lib/scoring.js     status and reputation rules
lib/solana.js      Helius, Pinata, PumpPortal
lib/util.js        helpers, rate limiting
public/            the website (HTML, CSS, JS)
test/              automated tests
```

## Before you promote it
- **Back up the database.** In Railway's volume settings, turn on backups.
- **Moderation.** People can publish accusations about real wallets. The three-layer format helps, but you'll want a way to remove abusive or doxxing posts. Right now that means editing the database. An admin panel is the obvious next feature.
- **Legal.** Publishing claims about identifiable people, and running a token launch service, both carry legal risk (defamation; FCA financial-promotion rules in the UK). Get advice before you market it. This README isn't legal advice.
- **Launch costs.** PumpPortal takes 0.5% of a creator's first buy. Token creation itself carries no PumpPortal fee.
