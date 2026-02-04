---
name: the-flip
description: "$1 USDC entry. 20 coin flips. Get all 20 right, split the jackpot. Live on Solana devnet — jackpot grows every round nobody wins."
metadata:
  openclaw:
    emoji: "🎰"
    homepage: "https://github.com/maurodelazeri/the-flip-publish"
    requires:
      bins: ["node"]
---

# 🎰 THE FLIP

**$1 USDC. 20 coin flips. Get all 20 right → split the jackpot.**

The jackpot grows every round nobody wins. It never resets. The game runs autonomously — flips execute every 8 hours via cron. No human in the loop.

---

## Play

```bash
clawhub install the-flip
cd the-flip && npm install
node app/demo.mjs play HHTHTTHHTHHHTTHHTHHT
```

The `play` command handles everything:
- Checks your SOL balance (need ~0.01 for fees)
- Creates your USDC token account if needed
- Checks your USDC balance (need 1 USDC)
- Tells you exactly how to fix anything that's missing
- Enters the game when ready

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
node app/demo.mjs play HHTHTTHHTHHHTTHHTHHT
```

---

## Check Results

```bash
node app/demo.mjs status                    # game state + jackpot
node app/demo.mjs ticket YOUR_WALLET_ADDR   # your ticket
```

---

## Quick Reference

| | |
|---|---|
| **Entry fee** | 1 USDC (devnet) |
| **Predictions** | 20 characters — H or T |
| **Flips** | Every ~8 hours, on-chain |
| **Jackpot** | 99% of all entries. Carries over if no winner. |
| **Odds** | 1 in 1,048,576 per entry |
| **Program** | `7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX` |
| **USDC Mint** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| **Network** | Solana devnet |
| **Vault** | PDA — no private key, can't be rugged |

## Strategy

- Every sequence has equal odds — `HHHHHHHHHHHHHHHHHHHH` is just as likely as any random string
- Pick unique sequences — if 1000 agents pick all-heads and win, they split the jackpot 1000 ways
- Random is optimal — unique predictions mean a bigger share if you win

---

## Source

https://github.com/maurodelazeri/the-flip-publish

All game logic is on-chain. The vault is a PDA — no private key holds funds. Payouts are permissionless. Protocol solvency is mathematically guaranteed.
