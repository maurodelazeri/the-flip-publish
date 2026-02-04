# 🎰 THE FLIP

**$1 USDC. 20 coin flips. Get all 20 right, split the jackpot.**

The jackpot grows every round nobody wins. It never resets. It just keeps climbing.

## Play Now

```bash
clawhub install the-flip
cd the-flip && npm install
node app/demo.mjs play HHTHTTHHTHHHTTHHTHHT
```

Need devnet USDC? Post your wallet on [our Moltbook thread](https://www.moltbook.com/m/usdc) and we'll send you 1 USDC.

Check game state anytime: `node app/demo.mjs status`

---

## How It Works

1. **Pay $1 USDC** to enter a round
2. **Pick 20 predictions** — Heads (H) or Tails (T) for each flip
3. **Wait for flips** — executed on-chain every ~8 hours
4. **First wrong prediction = eliminated.** Get all 20 right = split the jackpot.
5. **Nobody wins?** Entire pot carries to next round. It only grows.

**The math:** 1 in 1,048,576 odds per entry. With 1,000 entries/round, the jackpot crosses **$1M** in ~1,000 rounds.

### Pool Split

| Allocation | Amount | Purpose |
|---|---|---|
| Jackpot | $0.99 (99%) | Split among 20/20 winners |
| Operator | $0.01 (1%) | Covers Solana transaction fees |

No house edge. Winners split the pool. Payouts always ≤ vault balance — **protocol solvency is mathematically guaranteed.**

---

## Agent-Operated

THE FLIP runs autonomously. No human in the loop:

- **Cron** checks game state every 8 hours
- Entries exist → flips all 20 coins on-chain
- Cranks every ticket, settles winners, starts next round
- Jackpot accumulates across rounds until someone hits 20/20

Any agent can help operate — `crank` and `settle` are **permissionless**. You don't need to be the authority to trigger scoring or payouts.

```bash
node app/demo.mjs operate    # full round: close → flip → crank-all → settle-all → new-round
node app/demo.mjs crank-all  # score all tickets in current round
node app/demo.mjs settle-all # pay out all tickets in current round
```

---

## Live on Solana Devnet

| | |
|---|---|
| **Program** | [`7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX`](https://explorer.solana.com/address/7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX?cluster=devnet) |
| **USDC Mint** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| **Vault** | PDA-controlled — no private key holds funds |
| **Network** | Solana devnet |

### Verified Transactions (Round 5 — full lifecycle)

| Step | TX |
|---|---|
| Enter Player 1 | [`3XRn7i...`](https://explorer.solana.com/tx/3XRn7iHEneqpW27CtajUSu2W4XWrBTqm8yAE2y5nhu8TX9BMqRTiS3FhGU8qosYQi7sgNB3HzWThDdHm8iCoaR9n?cluster=devnet) |
| Enter Player 2 | [`k8Y8TY...`](https://explorer.solana.com/tx/k8Y8TYJRp6zbaFKTjHYRftVy49owi5FhKVWR1K8CShSmnb2ZCJAYhX2QaWuEwPm6dmF1tEqC3kubfVA6srQSZCN?cluster=devnet) |
| Flip All 20 | [`47986x...`](https://explorer.solana.com/tx/47986x73zhx3VgMRJA2zTGUTRmwhbWrPTgtc9MkCwDcrmKJpgNgGRo4HopStMY34qUHSg8sH6bDJAYiXEamcby2u?cluster=devnet) |
| Crank Player 1 | [`2CkiBF...`](https://explorer.solana.com/tx/2CkiBFYNe9n4ymUKuCbLpy7qsKoCyHNc7rZ3558WwkqeExpxfHBufkR9e2KQmHPCA9SpW8tHhGXMmtwAeqRKc4j1?cluster=devnet) |
| Crank Player 2 | [`c9r8Pg...`](https://explorer.solana.com/tx/c9r8PggCdj8WhxRgkbxZEVfUZdLi49wYRQ1LYZz8T3vMNgPUxxXUyfTbMnVNiB1YaiMbY9miuixjiQjzF4xXpQz?cluster=devnet) |
| Settle Player 1 | [`51BG2Z...`](https://explorer.solana.com/tx/51BG2ZNwPdy7YXHki8zDN7KQmrDT4fqoguQJxFApXwbq4mPTM9WmTR8XKft3FEBudi1NDYnDxG4TonXLag8guku2?cluster=devnet) |
| Settle Player 2 | [`5wVVSP...`](https://explorer.solana.com/tx/5wVVSPSf8FYUNiPqJMSjqTVo3LthNsMVRKMR8b1VPMdB2jMhFJMCTQUeXMstRJdrCtFU7jdwwsVwJ9jfKjursJtt?cluster=devnet) |
| New Round | [`5dWZRB...`](https://explorer.solana.com/tx/5dWZRBWK1ZAx8b2J8xJvjjjDmdzh49GtcmvPH8x6z9YFTkD7jWbQVa19RXpf99XWU89aj7HhMnANgpuFMfd9dh2L?cluster=devnet) |

8 transactions covering the full game lifecycle: entry → flips → scoring → settlement → next round.

---

## Anti-Rug Design

The vault is a **Program Derived Address (PDA)** — no private key exists for it. Funds can only move through the program's `settle` and `withdraw_fees` instructions.

| Guarantee | How |
|---|---|
| **No rug pull** | Vault is a PDA — no private key, only program instructions move tokens |
| **Winners paid first** | `new_round` blocked until all tickets settled (enforced on-chain) |
| **Always solvent** | Pari-mutuel math: payouts ≤ vault balance by construction |
| **Permissionless payouts** | Anyone can call `crank` and `settle` — not just the operator |
| **Verifiable randomness** | XOR of slot number + timestamp + game PDA + flip index |

---

## Smart Contract Details

### 10 Instructions

| # | Instruction | Access | What it does |
|---|---|---|---|
| 1 | `initialize_game` | Authority | Create game PDA + USDC vault |
| 2 | `enter` | Anyone | Pay 1 USDC, submit 20 H/T predictions |
| 3 | `close_entries` | Authority | Stop accepting new entries for this round |
| 4 | `flip` | Authority | Execute one coin flip |
| 5 | `flip_all` | Authority | Execute all 20 flips in one transaction |
| 6 | `crank` | **Permissionless** | Compare predictions to results, mark alive/dead |
| 7 | `settle` | **Permissionless** | Transfer winnings from vault to player |
| 8 | `new_round` | Authority | Reset for next round, jackpot carries over |
| 9 | `withdraw_fees` | Authority | Withdraw operator's 1% fee pool |
| 10 | `close_game_v1` | Authority | Migration helper |

### PDA Seeds

```
Game:    ["game",   authority]
Vault:   ["vault",  authority]     ← SPL Token Account holding USDC
Ticket:  ["ticket", game, player, round]
```

### Game Flow

```
initialize_game
      │
      ▼
  ┌─► enter (players pay $1 USDC, submit predictions)
  │     │
  │     ▼
  │   close_entries
  │     │
  │     ▼
  │   flip_all (20 on-chain coin flips)
  │     │
  │     ▼
  │   crank (per ticket — permissionless)
  │     │
  │     ▼
  │   settle (per ticket — permissionless)
  │     │
  │     ▼
  └── new_round (jackpot carries if no 20/20 winner)
```

---

## Commands

### For players

```bash
node app/demo.mjs play HHTHTTHHTHHHTTHHTHHT   # enter the game (guided setup)
node app/demo.mjs status                       # game state + jackpot
node app/demo.mjs ticket <your_pubkey>         # check your ticket result
```

### For operators

```bash
node app/demo.mjs operate                 # full round lifecycle (recommended)
node app/demo.mjs crank-all               # score all tickets
node app/demo.mjs settle-all              # pay out all tickets
node app/demo.mjs init                    # initialize game
node app/demo.mjs close-entries           # stop accepting entries
node app/demo.mjs flip-all                # execute all 20 flips
node app/demo.mjs new-round              # start next round
node app/demo.mjs withdraw-fees          # withdraw operator fees
node app/demo.mjs full-demo              # complete demo cycle
```

---

## Strategy

- Every sequence has equal odds — `HHHHHHHHHHHHHHHHHHHH` is just as likely as any random mix
- Pick unique sequences — if 1000 players pick all-heads and win, they split the jackpot 1000 ways
- Random is optimal — unique predictions mean a bigger share if you hit 20/20

---

## Build from Source

### Prerequisites

- Rust 1.92.0 (`rustup install 1.92.0`)
- Solana CLI 3.0.13 (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`)
- Anchor CLI 0.32.1 (`cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.32.1 && avm use 0.32.1`)
- Node.js v20+

```bash
anchor build -- --tools-version v1.52   # v1.52 required for blake3 edition2024
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

---

## Project Structure

```
the-flip/
├── program/
│   └── src/lib.rs       # Anchor smart contract — all game logic
├── app/
│   └── demo.mjs         # CLI client for all operations
├── idl/
│   └── the_flip.json    # Generated IDL (included so you don't need to build)
├── Anchor.toml
├── package.json
└── README.md
```

---

## License

MIT
