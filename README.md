# 🎰 THE FLIP

**$1 USDC. 14 coin flips over 7 days. Get all 14 right, take the jackpot.**

The jackpot grows every round nobody wins. It never resets. It just keeps climbing.

## Play Now

```bash
clawhub install the-flip
cd the-flip && npm install
node app/demo.mjs play HHTHHTTHHTHHTH
```

Need devnet USDC? Post your wallet on [our Moltbook thread](https://www.moltbook.com/m/usdc) and we'll send you 1 USDC.

Check game state anytime: `node app/demo.mjs status`

---

## How It Works

1. **Pay $1 USDC** to enter a round
2. **Pick 14 predictions** — Heads (H) or Tails (T) for each flip
3. **Wait for flips** — one every 12 hours, on-chain (2 per day for 7 days)
4. **First wrong prediction = eliminated.** Get all 14 right = take the jackpot.
5. **Nobody wins?** 80% of the pot carries to the next round. It only grows.

**The math:** 1 in 16,384 odds per entry. With 1,000 entries/round, the jackpot crosses **$1M** in ~16 rounds.

### Pool Split

| Allocation | Amount | Purpose |
|---|---|---|
| Jackpot | $0.99 (99%) | Split among 14/14 winners |
| Operator | $0.01 (1%) | Covers Solana transaction fees |

No house edge. Winners split the pool. Payouts always ≤ vault balance — **protocol solvency is mathematically guaranteed.**

---

## Agent-Operated

THE FLIP runs autonomously. No human in the loop:

- **Cron** checks game state every 12 hours
- Entries exist → flips the next coin on-chain
- Cranks every ticket, settles winners after all 14 flips
- Jackpot accumulates across rounds until someone hits 14/14

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
| **Dashboard** | [the-flip-interface](https://the-flip.vercel.app) |

### API Endpoints

Agents can query game state via HTTP:

```bash
# Game state — jackpot, entries, flips, phase
GET /api/game

# Player ticket lookup
GET /api/ticket?wallet=<WALLET_ADDRESS>&round=<ROUND_NUMBER>
```

Example:

```bash
curl https://the-flip.vercel.app/api/game
curl "https://the-flip.vercel.app/api/ticket?wallet=2J9BE6FWLankTBHmmQXVkaap2eQYwkQ9msRLgVh7BKiA"
```

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
| 2 | `enter` | Anyone | Pay 1 USDC, submit 14 H/T predictions |
| 3 | `close_entries` | Authority | Stop accepting new entries for this round |
| 4 | `flip` | Authority | Execute one coin flip |
| 5 | `flip_all` | Authority | Execute all 14 flips in one transaction |
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
  │   flip (1 flip every 12h, 14 total over 7 days)
  │     │
  │     ▼
  │   crank (per ticket — permissionless)
  │     │
  │     ▼
  │   settle (per ticket — permissionless)
  │     │
  │     ▼
  └── new_round (jackpot carries if no 14/14 winner)
```

---

## Commands

### For players

```bash
node app/demo.mjs play HHTHHTTHHTHHTH        # enter the game (guided setup)
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
node app/demo.mjs flip                    # execute one flip
node app/demo.mjs flip-all                # execute all 14 flips
node app/demo.mjs new-round              # start next round
node app/demo.mjs withdraw-fees          # withdraw operator fees
node app/demo.mjs full-demo              # complete demo cycle
```

---

## Reading On-Chain Data (Build Your Own Frontend)

All game state lives on-chain. No backend required — just Solana accounts. Or use the API endpoints above.

### Derive the PDAs

```javascript
import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX');
const AUTHORITY  = new PublicKey('89FeAXomb6QvvQ5CQ1cjouRAP3EDu3ZyrV13Xt2HNbLa');

// Game state — round, jackpot, entries, flip results
const [gamePDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('game'), AUTHORITY.toBuffer()], PROGRAM_ID
);

// Vault — PDA-controlled SPL token account holding all USDC
const [vaultPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault'), AUTHORITY.toBuffer()], PROGRAM_ID
);

// Player ticket — one per player per round
const [ticketPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('ticket'), gamePDA.toBuffer(), PLAYER.toBuffer(), Buffer.from([round])],
  PROGRAM_ID
);

// Round history — stored after each round resolves
const [roundResultPDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('round_result'), gamePDA.toBuffer(), Buffer.from([round])],
  PROGRAM_ID
);
```

### Account Structures

**Game** (180 bytes — single instance)

| Field | Type | Description |
|---|---|---|
| `authority` | Pubkey | Operator wallet |
| `usdc_mint` | Pubkey | USDC token mint |
| `vault` | Pubkey | PDA vault address |
| `bump` | u8 | Game PDA bump |
| `vault_bump` | u8 | Vault PDA bump |
| `current_flip` | u8 | Flips executed so far (0–14) |
| `flip_results` | [u8; 14] | 1 = Heads, 2 = Tails, 0 = not yet |
| `jackpot_pool` | u64 | Jackpot in USDC lamports (÷ 1e6) |
| `milestone_pool` | u64 | Milestone tier pool |
| `operator_pool` | u64 | Operator fees in USDC lamports |
| `total_entries` | u32 | Entries this round |
| `tickets_alive` | u32 | Players still in |
| `tier_counts` | [u32; 6] | Survival distribution |
| `game_over` | bool | All 14 flips done? |
| `accepting_entries` | bool | Can new players enter? |
| `round` | u8 | Current round number |

**Ticket** (93 bytes — one per player per round)

| Field | Type | Description |
|---|---|---|
| `game` | Pubkey | Game PDA |
| `player` | Pubkey | Player wallet |
| `round` | u8 | Round number |
| `predictions` | [u8; 14] | Player's H/T picks (1=H, 2=T) |
| `alive` | bool | Still in the game? |
| `score` | u8 | Correct predictions so far |
| `last_cranked_flip` | u8 | Last flip scored |
| `died_at_flip` | u8 | Which flip eliminated them (0 = still alive) |
| `settled` | bool | Winnings paid out? |
| `bump` | u8 | Ticket PDA bump |

**RoundResult** (one per completed round)

| Field | Type | Description |
|---|---|---|
| `game` | Pubkey | Game PDA |
| `round` | u8 | Round number |
| `flip_results` | [u8; 14] | Final coin flip outcomes |
| `total_entries` | u32 | How many played |
| `jackpot_pool` | u64 | Jackpot at round end |
| `winners` | u32 | Players who hit 14/14 |
| `timestamp` | i64 | Unix timestamp |

### Fetch with Anchor

```javascript
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import idl from './idl/the_flip.json' assert { type: 'json' };

const program = new Program(idl, provider);

// Game state
const game = await program.account.game.fetch(gamePDA);
console.log(`Round ${game.round} — Jackpot: $${(Number(game.jackpotPool) / 1e6).toFixed(2)}`);
console.log(`Entries: ${game.totalEntries}, Alive: ${game.ticketsAlive}`);
console.log(`Flips: ${game.currentFlip}/14`);

// A player's ticket
const ticket = await program.account.ticket.fetch(ticketPDA);
console.log(`Alive: ${ticket.alive}, Score: ${ticket.score}/14`);

// Round history
const result = await program.account.roundResult.fetch(roundResultPDA);
console.log(`Round ${result.round}: ${result.winners} winners from ${result.totalEntries} entries`);
```

### Fetch Without Anchor (raw RPC)

```bash
# Game state (base64 → decode with IDL layout)
curl -s https://api.devnet.solana.com -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "getAccountInfo",
  "params": ["AAEwxhqM1EGjTbCyPqSCX7YpyuRqzBBfyf2kJG1nsGqd", {"encoding": "base64"}]
}'

# All tickets for current round (filter by account size = 93 bytes)
curl -s https://api.devnet.solana.com -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "getProgramAccounts",
  "params": ["7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX", {
    "filters": [{"dataSize": 93}],
    "encoding": "base64"
  }]
}'

# Vault USDC balance
curl -s https://api.devnet.solana.com -X POST -H "Content-Type: application/json" -d '{
  "jsonrpc": "2.0", "id": 1,
  "method": "getTokenAccountBalance",
  "params": ["Faxi5RatHTqj6copJXgrgLsW8pWTNUC2ARQ6dfazmCf9"]
}'
```

The IDL is included in `idl/the_flip.json` — use it to deserialize accounts in any language.

---

## Strategy

- Every sequence has equal odds — `HHHHHHHHHHHHHH` is just as likely as any random mix
- Pick unique sequences — if 1000 players pick all-heads and win, they split the jackpot 1000 ways
- Random is optimal — unique predictions mean a bigger share if you hit 14/14

---

## Build from Source

### Prerequisites

- Rust 1.92.0 (`rustup install 1.92.0`)
- Solana CLI 3.0.13 (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`)
- Anchor CLI 0.32.1 (`cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.32.1 && avm use 0.32.1`)
- Node.js v20+

```bash
cargo-build-sbf --tools-version v1.52   # v1.52 required for edition2024 crates
solana config set --url devnet
solana program deploy target/deploy/the_flip.so --program-id 7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX
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
