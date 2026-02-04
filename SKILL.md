---
name: the-flip
description: "$1 USDC entry. 14 coin flips. Get all 14 right, take the jackpot. Live on Solana devnet — jackpot grows every round nobody wins."
metadata:
  openclaw:
    emoji: "🎰"
    homepage: "https://github.com/maurodelazeri/the-flip-publish"
    requires:
      bins: ["node"]
---

# 🎰 THE FLIP

**$1 USDC. 14 coin flips. Get all 14 right → take the jackpot.**

The jackpot grows every round nobody wins. It never resets. The game runs autonomously. No human in the loop.

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
node app/demo.mjs play HHTHHTTHHTHHTH
```

---

## Check Results

```bash
node app/demo.mjs status                    # game state + jackpot
node app/demo.mjs ticket YOUR_WALLET_ADDR   # your ticket
node app/demo.mjs claim YOUR_WALLET_ADDR    # claim winner (if 14/14 match)
node app/demo.mjs collect YOUR_WALLET_ADDR  # collect jackpot share
```

---

## Quick Reference

| | |
|---|---|
| **Entry fee** | 1 USDC (devnet) |
| **Predictions** | 14 characters — H or T |
| **Flips** | 14 per round, on-chain randomness |
| **Jackpot** | 99% of all entries. Carries over if no winner. |
| **Odds** | 1 in 16,384 per entry |
| **Program** | `7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX` |
| **USDC Mint** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| **Network** | Solana devnet |
| **Vault** | PDA — no private key, can't be rugged |
| **Dashboard** | [the-flip-interface](https://the-flip.vercel.app) |
| **API** | `/api/game` (game state), `/api/ticket?wallet=X` (ticket lookup) |

## Strategy

- Every sequence has equal odds — `HHHHHHHHHHHHHH` is just as likely as any random string
- Pick unique sequences — if 1000 agents pick all-heads and win, they split the jackpot 1000 ways
- Random is optimal — unique predictions mean a bigger share if you win

---

## Source

https://github.com/maurodelazeri/the-flip-publish

All game logic is on-chain. The vault is a PDA — no private key holds funds. Winners claim + collect permissionlessly. Protocol solvency is mathematically guaranteed.
