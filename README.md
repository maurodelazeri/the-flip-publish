# 🎰 THE FLIP

**$1 USDC. 20 Flips. Win $1M+.**

A fully on-chain pari-mutuel coin flip game on Solana devnet using USDC. All game logic, randomness, pool accounting, and prize distribution enforced by the smart contract. USDC is held in a PDA vault — no private key controls the funds.

## Deployed

- **Program:** [`7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX`](https://explorer.solana.com/address/7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX?cluster=devnet) (Solana devnet)
- **USDC Mint:** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle devnet faucet)

## Demo Transactions

| Action | Transaction |
|---|---|
| Initialize | [`5JVHfz...`](https://explorer.solana.com/tx/5JVHfzWfp6V1eYLr31xTBizVXb4txvnzbdStFSeFUk3DXGhdsCm5AdFrQypaLdoxGLymHrFx89fDoe9CRWo43mQc?cluster=devnet) |
| Enter (pay USDC) | [`5qozAr...`](https://explorer.solana.com/tx/5qozArSwsKyC42zHx4Evncb8FZzkQdaDEocU1HFBkk9UtdFAEUsZa3rmkk1vS4QKchqBvJwFVLkiM7gocVy21akJ?cluster=devnet) |
| Flip All (20 flips) | [`4qig1x...`](https://explorer.solana.com/tx/4qig1xAnmZHmcjCvN8qfx2DVFb4bSQvPjQYrqx8HvKFVgSpLk9VXSxakVHRpjUs6vxQbw5zdmwGLhcknMy79X8mg?cluster=devnet) |
| Crank (score) | [`dPssgy...`](https://explorer.solana.com/tx/dPssgywBS6o4V4b42gX9BHhMjq4vwbzXccYt9J734asgd6umExFk2XyDZY5Vmuq4nTb8ZwHHucQA6qAuTPW6SMe?cluster=devnet) |
| Settle (payout) | [`Rx5ULV...`](https://explorer.solana.com/tx/Rx5ULVbyGQdccM5AJpFExyaipGn9ViyzmM2GZRX3f5PcxkxmzqHdN9T8jdovuP2xYvaPKeAfDSKQdahAgrkbXDv?cluster=devnet) |
| New Round | [`5vgToP...`](https://explorer.solana.com/tx/5vgToPFXGs6vZHM9LSDskq8peySt8MPf3a4pvahm61sgjQaGDpDiYP5Uc4zPedXGTK4xEMfMBhmDDLDszDbT4Q9d?cluster=devnet) |

**5 rounds completed**, jackpot accumulated to **$4.95 USDC** across 5 entries with no 20/20 winner.

---

## How It Works

### The Game
1. **Pay $1 USDC** (devnet) to enter
2. **Submit 20 predictions**: Heads (H) or Tails (T) for each flip
3. **Flips are executed on-chain** — randomness from slot hash + timestamp + game state
4. **Your score = consecutive correct predictions** from Flip 1
5. **First wrong prediction = eliminated**

### Pool Math

| Allocation | Amount | Purpose |
|---|---|---|
| Operator | $0.01 (1%) | Covers Solana transaction fees |
| Jackpot | $0.99 (99%) | Split among 20/20 winners |

If no one hits 20/20, the **jackpot carries over** to the next round. With 1,000 entries/round and no winner, the jackpot exceeds **$1M** in ~1,000 rounds.

### Why Pari-Mutuel?

Winners split the pool — payouts always ≤ vault balance. Protocol solvency is **mathematically guaranteed**. The contract cannot go bankrupt.

---

## Architecture

```
Entry ($1 USDC) ──→ PDA Vault (no private key)
                     ├─ 1%  → Operator pool
                     └─ 99% → Jackpot pool
                                ↓
                        20/20 winners split it
                        (or carry to next round)
```

### Anti-Rug Design

The vault is a **Program Derived Address (PDA)** — there is no private key. Funds can only move through the program's `settle` and `withdraw_fees` instructions. Even the authority cannot drain player funds arbitrarily.

The `new_round` instruction enforces `tickets_alive == 0` — the authority must settle all winning tickets before starting a new round. Winners always get paid first.

### On-Chain Randomness

Flip results are derived from XOR of:
- Current slot number
- Unix timestamp
- Game PDA key
- Flip index

This produces verifiable on-chain randomness suitable for devnet. Each flip's entropy depends on when it's executed, making results unpredictable at entry time.

---

## Instructions (10)

| # | Instruction | Access | Description |
|---|---|---|---|
| 1 | `initialize_game` | Authority | Create game PDA + USDC vault |
| 2 | `enter` | Player | Pay 1 USDC, submit 20 H/T predictions |
| 3 | `close_entries` | Authority | Stop accepting new entries |
| 4 | `flip` | Authority | Execute one coin flip |
| 5 | `flip_all` | Authority | Execute all 20 flips in one transaction |
| 6 | `crank` | **Permissionless** | Evaluate ticket predictions vs flip results |
| 7 | `settle` | **Permissionless** | Pay winnings from vault to player |
| 8 | `new_round` | Authority | Start new round (jackpot carries over) |
| 9 | `withdraw_fees` | Authority | Withdraw operator fees |
| 10 | `close_game_v1` | Authority | Migration helper |

**Permissionless** = anyone can call it, not just the operator. This means any agent or user can trigger ticket evaluation and prize distribution.

---

## PDA Accounts

```
Game PDA:    seeds = ["game", authority_pubkey]
Vault PDA:   seeds = ["vault", authority_pubkey]   (SPL Token Account, USDC)
Ticket PDA:  seeds = ["ticket", game_pda, player_pubkey, round]
```

---

## Safety Guarantees

1. **PDA vault** — No private key holds USDC. Only program instructions can move tokens.
2. **Only `settle` and `withdraw_fees`** can transfer tokens out of the vault.
3. **`new_round` blocked until all tickets settled** — authority cannot zero the jackpot before winners collect.
4. **Pari-mutuel math** — payouts always ≤ vault balance. Mathematically solvent by design.
5. **Permissionless crank/settle** — anyone can trigger evaluation and payouts, not just the operator.

---

## Build & Run

### Prerequisites

- Rust 1.92.0 (`rustup install 1.92.0`)
- Solana CLI 3.0.13 (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`)
- Anchor CLI 0.32.1 (`cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.32.1 && avm use 0.32.1`)
- Node.js v20+

### Build

```bash
anchor build
```

### Deploy

```bash
solana config set --url devnet
solana airdrop 5              # need ~3 SOL for deploy
anchor deploy --provider.cluster devnet
```

### Client

```bash
npm install
node app/demo.mjs status       # check game state
node app/demo.mjs full-demo    # run complete demo cycle
```

### All Commands

```bash
node app/demo.mjs init                    # initialize game + vault
node app/demo.mjs enter HHTHTTHHTHHHTTHHTHHT  # enter with predictions
node app/demo.mjs flip                    # one flip
node app/demo.mjs flip-all                # all 20 flips in one tx
node app/demo.mjs crank <player_pubkey>   # evaluate ticket
node app/demo.mjs settle <player_pubkey>  # pay winnings
node app/demo.mjs status                  # show game state
node app/demo.mjs ticket <player_pubkey>  # show ticket
node app/demo.mjs new-round              # start next round
node app/demo.mjs withdraw-fees          # withdraw operator fees
```

---

## Project Structure

```
the-flip/
├── program/
│   ├── src/lib.rs          # Anchor smart contract (all game logic)
│   ├── Cargo.toml
│   └── Xargo.toml
├── app/
│   └── demo.mjs            # CLI client for all operations
├── idl/
│   └── the_flip.json       # Generated IDL (included for convenience)
├── Anchor.toml              # Anchor config
├── Cargo.toml               # Workspace config
├── Cargo.lock
├── rust-toolchain.toml      # Pins Rust 1.92.0
├── package.json             # Node.js dependencies
└── README.md
```

---

## Agent Operation

THE FLIP is designed to be operated by an AI agent:

- **Cron job** checks game state every 8 hours
- When entries exist → agent executes all 20 flips
- When game is over → agent cranks tickets, settles winners, starts new round
- **Jackpot accumulates** across rounds until someone hits 20/20

The permissionless `crank` and `settle` instructions mean any agent (not just the operator) can trigger ticket evaluation and prize distribution — true decentralization.

---

## License

MIT
