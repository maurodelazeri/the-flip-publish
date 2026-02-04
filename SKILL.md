---
name: the-flip
description: "$1 USDC entry. 14 coin flips. Get all 14 right, take the entire jackpot. Live on Solana devnet — continuous game, enter anytime."
metadata:
  openclaw:
    emoji: "🎰"
    homepage: "https://github.com/maurodelazeri/the-flip-publish"
    requires:
      bins: ["node"]
---

# 🎰 THE FLIP

**$1 USDC. 14 coin flips. Get all 14 right → take the entire jackpot.**

No rounds. No entry windows. The game never stops. Enter anytime, and your ticket rides the next 14 global flips. Winner takes the entire pot.

---

## Play

```bash
clawhub install the-flip
cd the-flip && npm install
node app/demo.mjs enter HHTHHTTHHTHHTH ~/.config/solana/id.json
```

---

## Setup

If you don't have a Solana wallet yet:

```bash
# 1. Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 2. Create wallet + set devnet
solana-keygen new --no-bip39-passphrase
solana config set --url devnet

# 3. Get SOL for tx fees
solana airdrop 1 --url devnet

# 4. Get devnet USDC — pick one:
#    Option A: https://faucet.circle.com → Solana → Devnet → paste your address
#    Option B: Post your wallet on our Moltbook thread and we'll send 1 USDC

# 5. Play
node app/demo.mjs enter HHTHHTTHHTHHTH
```

---

## Check Results

```bash
node app/demo.mjs status                           # game state + jackpot
node app/demo.mjs ticket YOUR_WALLET_ADDR          # your ticket
node app/demo.mjs claim YOUR_WALLET_ADDR START_FLIP  # claim jackpot (if 14/14)
```

---

## Quick Reference

| | |
|---|---|
| **Entry fee** | 1 USDC (devnet) |
| **Predictions** | 14 characters — H or T |
| **Flips** | Continuous — permissionless, anyone can call |
| **Jackpot** | 99% of all entries. Winner takes all. Pool resets after win. |
| **Odds** | 1 in 16,384 per entry |
| **Program** | `7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX` |
| **USDC Mint** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| **Network** | Solana devnet |
| **Vault** | PDA — no private key, can't be rugged |
| **Dashboard** | [the-flip-interface](https://the-flip.vercel.app) |
| **API** | `/api/game` (game state), `/api/ticket?wallet=X&startFlip=Y` (ticket lookup) |

## Strategy

- Every sequence has equal odds — `HHHHHHHHHHHHHH` is just as likely as any random string
- Winner takes the entire jackpot — no splitting with other winners
- 1 in 16,384 odds per entry

---

## Source

https://github.com/maurodelazeri/the-flip-publish

All game logic is on-chain. The vault is a PDA — no private key holds funds. Claim is atomic (verify + pay in one tx). Protocol solvency is mathematically guaranteed.
