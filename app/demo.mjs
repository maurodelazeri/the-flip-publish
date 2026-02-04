/**
 * THE FLIP — Demo & Agent Operations Script
 *
 * Works with deployed program: 7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX
 *
 * Usage:
 *   node app/demo.mjs init                    Initialize game + vault
 *   node app/demo.mjs enter <HHTHTT...>       Enter with 14 H/T predictions
 *   node app/demo.mjs flip                    Execute one coin flip
 *   node app/demo.mjs flip-all                Execute all 14 flips in one tx
 *   node app/demo.mjs claim <player_pubkey>   Claim winner status (verifies 14/14 on-chain)
 *   node app/demo.mjs start-payouts           Close claim window, start payout phase
 *   node app/demo.mjs collect <player_pubkey> Collect jackpot winnings
 *   node app/demo.mjs status                  Show game state
 *   node app/demo.mjs ticket <player_pubkey>  Show a player's ticket
 *   node app/demo.mjs new-round               Start new round (jackpot carries)
 *   node app/demo.mjs withdraw-fees [amount]  Withdraw operator fees
 *   node app/demo.mjs close-entries           Close entries manually
 *   node app/demo.mjs full-demo               Run complete demo cycle
 *   node app/demo.mjs operate                 Full round operation: close→flip→start-payouts→new-round
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// --- Config ---
const DEVNET_URL = 'https://api.devnet.solana.com';
const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const PROGRAM_ID = new PublicKey('7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX');
const TOTAL_FLIPS = 14;

// Load IDL
const IDL_PATH = path.join(import.meta.dirname, '..', 'idl', 'the_flip.json');

// Load wallet
function loadWallet(keyPath) {
  const raw = JSON.parse(fs.readFileSync(keyPath || process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME, '.config', 'solana', 'id.json'), 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// PDA derivation
function getGamePDA(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('game'), authority.toBuffer()], PROGRAM_ID
  );
}

function getVaultPDA(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), authority.toBuffer()], PROGRAM_ID
  );
}

function getRoundResultPDA(game, round) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('round_result'), game.toBuffer(), Buffer.from([round])],
    PROGRAM_ID
  );
}

function getTicketPDA(game, player, round) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ticket'), game.toBuffer(), player.toBuffer(), Buffer.from([round])],
    PROGRAM_ID
  );
}

// Parse predictions string (HHTHTT...) to array of u8 (1=H, 2=T)
function parsePredictions(str) {
  if (str.length !== 14) throw new Error('Must be exactly 14 predictions (H or T)');
  const result = [];
  for (let i = 0; i < TOTAL_FLIPS; i++) {
    const c = str[i].toUpperCase();
    if (c === 'H') result.push(1);
    else if (c === 'T') result.push(2);
    else throw new Error('Invalid char: ' + c + ' (must be H or T)');
  }
  return result;
}

// Format flip result (1=H, 2=T)
function flipToStr(r) { return r === 1 ? 'H' : r === 2 ? 'T' : '?'; }

// Format USDC amount (6 decimals)
function fmtUsdc(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw.toString());
  return (n / 1_000_000).toFixed(6);
}

// Find all tickets for a given round via raw account scan
async function findRoundTickets(connection, round) {
  const raw = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 90 }]  // New ticket size: 8 + 82 = 90 bytes
  });
  const tickets = [];
  for (const r of raw) {
    const data = r.account.data;
    // Layout: disc(8) + game(32) + player(32) + round(1) + predictions(14) + winner(1) + collected(1) + bump(1)
    const ticketRound = data[72];
    const winner = data[87] === 1;
    const collected = data[88] === 1;
    if (ticketRound === round) {
      const player = new PublicKey(data.slice(40, 72));
      tickets.push({
        publicKey: r.pubkey,
        account: { player, round: ticketRound, winner, collected }
      });
    }
  }
  return tickets;
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    console.log('Usage: node app/demo.mjs <command> [args]');
    console.log('Commands: init, enter, flip, flip-all, claim, start-payouts, collect, status, ticket, new-round, save-round, withdraw-fees, close-entries, full-demo, operate');
    process.exit(1);
  }

  const connection = new Connection(DEVNET_URL, 'confirmed');
  const wallet = loadWallet();
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: 'confirmed' }
  );
  anchor.setProvider(provider);

  if (!fs.existsSync(IDL_PATH)) {
    console.error('IDL not found at', IDL_PATH);
    console.error('Run anchor build first or copy the IDL.');
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
  const program = new anchor.Program(idl, provider);

  const [gamePDA] = getGamePDA(wallet.publicKey);
  const [vaultPDA] = getVaultPDA(wallet.publicKey);

  switch (cmd) {
    case 'init': {
      console.log('Initializing THE FLIP...');
      console.log('  Authority:', wallet.publicKey.toBase58());
      console.log('  Game PDA: ', gamePDA.toBase58());
      console.log('  Vault PDA:', vaultPDA.toBase58());
      console.log('  Program:  ', PROGRAM_ID.toBase58());

      try {
        const tx = await program.methods.initializeGame().accounts({
          authority: wallet.publicKey,
          game: gamePDA,
          usdcMint: USDC_MINT,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        }).rpc();
        console.log('Game initialized! TX:', tx);
      } catch (e) {
        if (e.message?.includes('already in use')) {
          console.log('Game already initialized.');
        } else {
          throw e;
        }
      }
      break;
    }

    case 'enter': {
      const preds = process.argv[3];
      const playerKeyPath = process.argv[4];
      if (!preds) { console.error('Usage: enter <HHTHTT...> [player_keypair_path]'); process.exit(1); }

      const parsed = parsePredictions(preds);
      const player = playerKeyPath ? loadWallet(playerKeyPath) : wallet;

      const playerProvider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(player),
        { commitment: 'confirmed' }
      );
      const playerProgram = new anchor.Program(idl, playerProvider);

      const game = await program.account.game.fetch(gamePDA);
      const round = game.round;
      const [ticketPDA] = getTicketPDA(gamePDA, player.publicKey, round);
      const playerATA = await getAssociatedTokenAddress(USDC_MINT, player.publicKey);

      console.log('Entering round ' + round + ' with player ' + player.publicKey.toBase58());
      console.log('Predictions: ' + preds.toUpperCase());

      const tx = await playerProgram.methods.enter(parsed).accounts({
        player: player.publicKey,
        game: gamePDA,
        ticket: ticketPDA,
        playerTokenAccount: playerATA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      console.log('Entry accepted! TX:', tx);
      console.log('Ticket PDA:', ticketPDA.toBase58());
      break;
    }

    case 'flip': {
      console.log('Executing one flip...');
      const tx = await program.methods.flip().accounts({
        authority: wallet.publicKey,
        game: gamePDA,
      }).rpc();

      const game = await program.account.game.fetch(gamePDA);
      const idx = game.currentFlip - 1;
      const result = flipToStr(game.flipResults[idx]);
      console.log('Flip #' + game.currentFlip + ': ' + (result === 'H' ? 'HEADS' : 'TAILS') + '  TX: ' + tx);
      if (game.gameOver) console.log('GAME OVER - all 14 flips complete!');
      break;
    }

    case 'flip-all': {
      console.log('Executing all 14 flips in one transaction...');
      const tx = await program.methods.flipAll().accounts({
        authority: wallet.publicKey,
        game: gamePDA,
      }).rpc();

      const game = await program.account.game.fetch(gamePDA);
      const results = game.flipResults
        .slice(0, game.currentFlip)
        .map((r, i) => '#' + (i+1) + ':' + flipToStr(r))
        .join('  ');
      console.log('All flips done! TX:', tx);
      console.log('Results:', results);
      console.log('GAME OVER - all 14 flips complete!');
      break;
    }

    case 'claim': {
      const playerPubkey = process.argv[3];
      if (!playerPubkey) { console.error('Usage: claim <player_pubkey>'); process.exit(1); }

      const player = new PublicKey(playerPubkey);
      const game = await program.account.game.fetch(gamePDA);
      const [ticketPDA] = getTicketPDA(gamePDA, player, game.round);

      console.log('Claiming winner status for ' + playerPubkey + '...');
      const tx = await program.methods.claim().accounts({
        claimer: wallet.publicKey,
        game: gamePDA,
        ticket: ticketPDA,
      }).rpc();

      console.log('Winner claimed! TX:', tx);
      const ticket = await program.account.ticket.fetch(ticketPDA);
      console.log('Winner:', ticket.winner);
      break;
    }

    case 'start-payouts': {
      console.log('Starting payout phase...');
      const tx = await program.methods.startPayouts().accounts({
        authority: wallet.publicKey,
        game: gamePDA,
      }).rpc();
      console.log('Payouts started! TX:', tx);

      const game = await program.account.game.fetch(gamePDA);
      console.log('Winners to collect:', game.winnersCount);
      console.log('Jackpot:', fmtUsdc(game.jackpotPool), 'USDC');
      break;
    }

    case 'collect': {
      const playerPubkey = process.argv[3];
      if (!playerPubkey) { console.error('Usage: collect <player_pubkey>'); process.exit(1); }

      const player = new PublicKey(playerPubkey);
      const game = await program.account.game.fetch(gamePDA);
      const [ticketPDA] = getTicketPDA(gamePDA, player, game.round);
      const playerATA = await getAssociatedTokenAddress(USDC_MINT, player);

      console.log('Collecting jackpot for ' + playerPubkey + '...');
      const tx = await program.methods.collect().accounts({
        collector: wallet.publicKey,
        game: gamePDA,
        ticket: ticketPDA,
        player: player,
        playerTokenAccount: playerATA,
        vault: vaultPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      console.log('Collected! TX:', tx);
      break;
    }

    case 'status': {
      try {
        const game = await program.account.game.fetch(gamePDA);
        console.log('=== THE FLIP - On-Chain Game Status ===');
        console.log('Program:       ' + PROGRAM_ID.toBase58());
        console.log('Authority:     ' + game.authority.toBase58());
        console.log('Vault:         ' + game.vault.toBase58());
        console.log('Round:         ' + game.round);
        console.log('');
        console.log('Entries:       ' + game.totalEntries);
        console.log('Accepting:     ' + game.acceptingEntries);
        console.log('Game over:     ' + game.gameOver);
        console.log('Payouts:       ' + game.payoutsStarted);
        console.log('');
        console.log('Flips:         ' + game.currentFlip + '/' + TOTAL_FLIPS);
        if (game.currentFlip > 0) {
          const results = game.flipResults
            .slice(0, game.currentFlip)
            .map((r, i) => '#' + (i+1) + ':' + flipToStr(r))
            .join('  ');
          console.log('Results:       ' + results);
        }
        console.log('');
        console.log('Jackpot pool:  ' + fmtUsdc(game.jackpotPool) + ' USDC');
        console.log('Operator pool: ' + fmtUsdc(game.operatorPool) + ' USDC');
        console.log('Winners:       ' + game.winnersCount);
        console.log('Collected:     ' + game.collectedCount);
        console.log('='.repeat(40));
      } catch (e) {
        console.log('Game not initialized. Run: node app/demo.mjs init');
      }
      break;
    }

    case 'ticket': {
      const playerPubkey = process.argv[3];
      if (!playerPubkey) { console.error('Usage: ticket <player_pubkey>'); process.exit(1); }

      const player = new PublicKey(playerPubkey);
      const game = await program.account.game.fetch(gamePDA);
      const [ticketPDA] = getTicketPDA(gamePDA, player, game.round);

      try {
        const ticket = await program.account.ticket.fetch(ticketPDA);
        console.log('=== Ticket for ' + player.toBase58() + ' ===');
        console.log('Round:         ' + ticket.round);
        console.log('Predictions:   ' + ticket.predictions.map(p => p === 1 ? 'H' : 'T').join(''));

        // Compute alive/score off-chain
        let alive = true;
        let score = 0;
        let diedAt = 0;
        for (let i = 0; i < game.currentFlip; i++) {
          if (ticket.predictions[i] === game.flipResults[i]) {
            score = i + 1;
          } else {
            alive = false;
            diedAt = i + 1;
            break;
          }
        }
        if (alive) score = game.currentFlip;

        const status = ticket.winner
          ? 'WINNER' + (ticket.collected ? ' (collected)' : ' (pending collection)')
          : alive && game.currentFlip > 0
            ? 'ALIVE (score: ' + score + '/' + TOTAL_FLIPS + ')'
            : alive
              ? 'WAITING (no flips yet)'
              : 'ELIMINATED at flip ' + diedAt + ' (score: ' + score + ')';
        console.log('Status:        ' + status);
        console.log('Winner:        ' + ticket.winner);
        console.log('Collected:     ' + ticket.collected);

        // Flip comparison
        if (game.currentFlip > 0) {
          console.log('');
          console.log('Flip results:');
          for (let i = 0; i < game.currentFlip; i++) {
            const pred = flipToStr(ticket.predictions[i]);
            const actual = flipToStr(game.flipResults[i]);
            const match = pred === actual ? 'OK' : 'MISS';
            console.log('  #' + (i+1) + ': predicted ' + pred + ', actual ' + actual + ' → ' + match);
          }
        }
      } catch (e) {
        console.log('No ticket found for this player in current round.');
      }
      break;
    }

    case 'new-round': {
      console.log('Starting new round...');
      const tx = await program.methods.newRound().accounts({
        authority: wallet.publicKey,
        game: gamePDA,
      }).rpc();
      console.log('New round started! TX:', tx);
      const game = await program.account.game.fetch(gamePDA);
      console.log('Round:', game.round);
      console.log('Jackpot carried over:', fmtUsdc(game.jackpotPool), 'USDC');
      break;
    }

    case 'withdraw-fees': {
      const game = await program.account.game.fetch(gamePDA);
      const amount = process.argv[3] ? parseInt(process.argv[3]) : Number(game.operatorPool.toString());
      if (amount <= 0) { console.log('No operator fees to withdraw.'); return; }

      const authorityATA = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
      console.log('Withdrawing ' + fmtUsdc(amount) + ' USDC in operator fees...');
      const tx = await program.methods.withdrawFees(new anchor.BN(amount)).accounts({
        authority: wallet.publicKey,
        game: gamePDA,
        authorityTokenAccount: authorityATA,
        vault: vaultPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      console.log('Fees withdrawn! TX:', tx);
      break;
    }

    case 'close-entries': {
      const tx = await program.methods.closeEntries().accounts({
        authority: wallet.publicKey,
        game: gamePDA,
      }).rpc();
      console.log('Entries closed! TX:', tx);
      break;
    }

    case 'save-round': {
      const game = await program.account.game.fetch(gamePDA);
      const [roundResultPDA] = getRoundResultPDA(gamePDA, game.round);
      console.log('Saving round', game.round, 'results...');
      const tx = await program.methods.saveRound().accounts({
        authority: wallet.publicKey,
        game: gamePDA,
        roundResult: roundResultPDA,
        systemProgram: SystemProgram.programId,
      }).rpc();
      console.log('Saved! TX:', tx);
      break;
    }

    case 'history': {
      const game = await program.account.game.fetch(gamePDA);
      console.log('=== THE FLIP — Round History ===');
      console.log('');
      for (let r = 0; r <= game.round; r++) {
        try {
          const [pda] = getRoundResultPDA(gamePDA, r);
          const result = await program.account.roundResult.fetch(pda);
          const flips = result.flipResults.map(f => f === 1 ? 'H' : f === 2 ? 'T' : '?').join('');
          const jackpot = fmtUsdc(result.jackpotPool);
          const ts = new Date(Number(result.timestamp) * 1000).toISOString().slice(0, 16);
          console.log(`Round ${result.round}: ${result.totalEntries} entries | ${result.winners} winners | Jackpot: ${jackpot} USDC | ${flips} | ${ts}`);
        } catch (e) {
          // No saved result for this round
        }
      }
      console.log('');
      console.log('Current round:', game.round, '| Jackpot:', fmtUsdc(game.jackpotPool), 'USDC');
      break;
    }

    case 'operate': {
      // Full round operation: close → flip-all → start-payouts → (winners claim+collect themselves) → save → new-round
      const game = await program.account.game.fetch(gamePDA);
      const jackpotBefore = fmtUsdc(game.jackpotPool);
      console.log('=== OPERATE ROUND', game.round, '===');
      console.log('Entries:', game.totalEntries, '| Jackpot before:', jackpotBefore, 'USDC');

      if (game.totalEntries === 0) {
        console.log('No entries — nothing to do.');
        break;
      }

      // Close entries
      if (game.acceptingEntries) {
        try {
          await program.methods.closeEntries().accounts({
            authority: wallet.publicKey,
            game: gamePDA,
          }).rpc();
          console.log('1. Entries closed');
        } catch (e) {
          console.log('1. Close entries:', e.message?.slice(0, 60));
        }
      }

      // Flip all
      if (!game.gameOver) {
        try {
          await program.methods.flipAll().accounts({
            authority: wallet.publicKey,
            game: gamePDA,
          }).rpc();
          const g2 = await program.account.game.fetch(gamePDA);
          const results = g2.flipResults.slice(0, g2.currentFlip).map(r => r === 1 ? 'H' : 'T').join('');
          console.log('2. Flipped:', results);
        } catch (e) {
          console.log('2. Flip:', e.message?.slice(0, 60));
        }
      }

      // Start payouts (closes claim window — winners should have claimed by now)
      try {
        await program.methods.startPayouts().accounts({
          authority: wallet.publicKey,
          game: gamePDA,
        }).rpc();
        const g3 = await program.account.game.fetch(gamePDA);
        console.log('3. Payouts started. Winners:', g3.winnersCount);
      } catch (e) {
        console.log('3. Start payouts:', e.message?.slice(0, 60));
      }

      // Collect for all winners (permissionless — operator can trigger)
      const roundTickets = await findRoundTickets(connection, game.round);
      const winners = roundTickets.filter(t => t.account.winner && !t.account.collected);
      if (winners.length > 0) {
        console.log('4. Collecting for', winners.length, 'winners...');
        for (const t of winners) {
          try {
            const playerATA = await getAssociatedTokenAddress(USDC_MINT, t.account.player);
            await program.methods.collect().accounts({
              collector: wallet.publicKey,
              game: gamePDA,
              ticket: t.publicKey,
              player: t.account.player,
              playerTokenAccount: playerATA,
              vault: vaultPDA,
              tokenProgram: TOKEN_PROGRAM_ID,
            }).rpc();
            console.log('   Paid', t.account.player.toBase58().slice(0, 8) + '...');
          } catch (e) {
            console.log('   Skip', t.account.player.toBase58().slice(0, 8) + '...:', e.message?.slice(0, 60));
          }
        }
      } else {
        console.log('4. No winners to pay');
      }

      // Save round history
      try {
        const [roundResultPDA] = getRoundResultPDA(gamePDA, game.round);
        await program.methods.saveRound().accounts({
          authority: wallet.publicKey,
          game: gamePDA,
          roundResult: roundResultPDA,
          systemProgram: SystemProgram.programId,
        }).rpc();
        console.log('5. Round history saved on-chain');
      } catch (e) {
        console.log('5. Save round:', e.message?.slice(0, 60));
      }

      // New round
      try {
        await program.methods.newRound().accounts({
          authority: wallet.publicKey,
          game: gamePDA,
        }).rpc();
        const finalGame = await program.account.game.fetch(gamePDA);
        const jackpotAfter = fmtUsdc(finalGame.jackpotPool);
        console.log('6. New round', finalGame.round, 'started');
        console.log('');
        console.log('=== RESULT ===');
        console.log('Round', game.round, ':', game.totalEntries, 'entries,', winners.length, 'winners');
        console.log('Jackpot:', jackpotBefore, '→', jackpotAfter, 'USDC');
      } catch (e) {
        console.log('6. New round:', e.message?.slice(0, 60));
      }
      break;
    }

    case 'full-demo': {
      console.log('=== THE FLIP - FULL DEMO ===');
      console.log('Program:', PROGRAM_ID.toBase58());
      console.log('Authority:', wallet.publicKey.toBase58());
      console.log('');

      // 1. Init
      console.log('Step 1: Initialize game...');
      try {
        await program.methods.initializeGame().accounts({
          authority: wallet.publicKey,
          game: gamePDA,
          usdcMint: USDC_MINT,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        }).rpc();
        console.log('  Game initialized');
      } catch (e) {
        console.log('  Already initialized');
      }

      // 2. Show status
      const game = await program.account.game.fetch(gamePDA);
      console.log('  Round:', game.round, '| Entries:', game.totalEntries, '| Jackpot:', fmtUsdc(game.jackpotPool), 'USDC');

      // 3. Enter with random predictions
      console.log('');
      console.log('Step 2: Enter with random predictions...');
      const chars = [];
      for (let i = 0; i < TOTAL_FLIPS; i++) chars.push(Math.random() < 0.5 ? 'H' : 'T');
      const predStr = chars.join('');
      const parsed = parsePredictions(predStr);

      const playerATA = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
      const [ticketPDA] = getTicketPDA(gamePDA, wallet.publicKey, game.round);

      try {
        await program.methods.enter(parsed).accounts({
          player: wallet.publicKey,
          game: gamePDA,
          ticket: ticketPDA,
          playerTokenAccount: playerATA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        console.log('  Entered with:', predStr);
      } catch (e) {
        console.log('  Entry failed:', e.message?.slice(0, 80));
      }

      // 4. Flip all
      console.log('');
      console.log('Step 3: Execute all 14 flips...');
      try {
        await program.methods.flipAll().accounts({
          authority: wallet.publicKey,
          game: gamePDA,
        }).rpc();
        const g2 = await program.account.game.fetch(gamePDA);
        const results = g2.flipResults.slice(0, g2.currentFlip).map(r => flipToStr(r)).join('');
        console.log('  Results:', results);
      } catch (e) {
        console.log('  Flip failed:', e.message?.slice(0, 80));
      }

      // 5. Check if winner (off-chain comparison)
      console.log('');
      console.log('Step 4: Check ticket...');
      try {
        const g3 = await program.account.game.fetch(gamePDA);
        const ticket = await program.account.ticket.fetch(ticketPDA);
        let allMatch = true;
        for (let i = 0; i < TOTAL_FLIPS; i++) {
          if (ticket.predictions[i] !== g3.flipResults[i]) { allMatch = false; break; }
        }
        if (allMatch) {
          console.log('  14/14 WINNER! Claiming...');
          await program.methods.claim().accounts({
            claimer: wallet.publicKey,
            game: gamePDA,
            ticket: ticketPDA,
          }).rpc();
          console.log('  Claimed!');
        } else {
          console.log('  Not a winner this round');
        }
      } catch (e) {
        console.log('  Check:', e.message?.slice(0, 80));
      }

      // 6. Start payouts + collect
      console.log('');
      console.log('Step 5: Start payouts...');
      try {
        await program.methods.startPayouts().accounts({
          authority: wallet.publicKey,
          game: gamePDA,
        }).rpc();
        console.log('  Payouts started');
      } catch (e) {
        console.log('  Start payouts:', e.message?.slice(0, 80));
      }

      // 7. Final status
      console.log('');
      console.log('Step 6: Final status...');
      const finalGame = await program.account.game.fetch(gamePDA);
      console.log('  Round:', finalGame.round);
      console.log('  Entries:', finalGame.totalEntries);
      console.log('  Jackpot:', fmtUsdc(finalGame.jackpotPool), 'USDC');
      console.log('  Operator:', fmtUsdc(finalGame.operatorPool), 'USDC');
      console.log('  Game over:', finalGame.gameOver);
      console.log('  Winners:', finalGame.winnersCount);

      console.log('');
      console.log('=== DEMO COMPLETE ===');
      break;
    }

    default:
      console.error('Unknown command:', cmd);
      process.exit(1);
  }
}

main().catch(e => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
