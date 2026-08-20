# HexBounty web app

The Next.js marketplace for uploading Game Boy binaries, following private
reconstruction jobs, publishing playable results, and charging MON for access.

## Main routes

- `/` — product overview and featured Tetris listing
- `/reconstruct` — wallet sign-in, payment, upload, and job creation
- `/games/[slug]` — reconstruction status, publishing, purchase, and player
- `/leaderboard` — creators ranked by confirmed paid unlocks

## Local development

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Environment

| Variable | Visibility | Purpose |
|---|---|---|
| `NEXT_PUBLIC_MONAD_RPC_URL` | Public | Monad Testnet RPC |
| `HEXBOUNTY_LEADERBOARD_SLUGS` | Server | Optional comma-separated catalogue of published game slugs included in the leaderboard |
| `NEXT_PUBLIC_CHAIN_ID` | Public | Monad Testnet chain ID (`10143`) |
| `NEXT_PUBLIC_HEXBOUNTY_CONTRACT` | Public | Reconstruction payment contract |
| `NEXT_PUBLIC_HEXBOUNTY_PAID_PLAY` | Public | Publication and paid-access registry |
| `NEXT_PUBLIC_SITE_URL` | Public | Public HTTPS origin or local origin |
| `AUTH_SESSION_SECRET` | Server only | SIWE session signing secret |
| `UPLOADTHING_TOKEN` | Server only | Temporary source upload token |
| `HEXBOUNTY_MODAL_BASE_URL` | Server only | Signed reconstruction API origin |
| `HEXBOUNTY_MODAL_HMAC_SECRET` | Server only | Shared Modal request-signing secret |

Copy the exact public defaults from `.env.example`. Never expose a server secret
through a `NEXT_PUBLIC_` variable.

## Flow

1. Connect MetaMask and complete SIWE.
2. Enter the game details, reconstruction reward, and play price.
3. Confirm the Monad payment in MetaMask.
4. Upload one `.gb` or `.gbc` file between 32 KiB and 8 MiB.
5. The server verifies payment, hands the temporary object to Modal, and deletes it.
6. Publish an accepted result and share `/games/[slug]`.
7. Buyers unlock access onchain; the server checks `hasAccess` before streaming.

## Quality gate

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The app fails closed when wallet authentication, publication, reconstruction,
or onchain access cannot be verified.
