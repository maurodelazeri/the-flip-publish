/**
 * THE FLIP — $1 USDC. 20 Flips. Win $1M+.
 * 
 * Program: 7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX (Solana devnet)
 * 
 * PLAYER COMMANDS:
 *   node app/demo.mjs play <HHTHTT...>        ← START HERE. Enter the game.
 *   node app/demo.mjs status                  Show game state + jackpot
 *   node app/demo.mjs ticket <player_pubkey>  Check your ticket
 * 
 * OPERATOR COMMANDS (authority only):
 *   node app/demo.mjs init                    Initialize game
 *   node app/demo.mjs enter <HHTHTT...>       Raw enter (no pre-checks)
 *   node app/demo.mjs flip / flip-all         Execute coin flips
 *   node app/demo.mjs crank <pubkey>          Score a ticket
 *   node app/demo.mjs settle <pubkey>         Pay winnings
 *   node app/demo.mjs new-round               Start next round
 *   node app/demo.mjs withdraw-fees           Withdraw operator fees
 *   node app/demo.mjs close-entries           Close entries manually
 *   node app/demo.mjs full-demo               Complete demo cycle
 *   node app/demo.mjs crank-all               Crank all tickets in current round
 *   node app/demo.mjs settle-all              Settle all tickets in current round
 *   node app/demo.mjs operate                 Full round: close→flip→crank-all→settle-all→new-round
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// --- Config ---
const DEVNET_URL = 'https://api.devnet.solana.com';
const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const PROGRAM_ID = new PublicKey('7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX');
const AUTHORITY = new PublicKey('89FeAXomb6QvvQ5CQ1cjouRAP3EDu3ZyrV13Xt2HNbLa');
const TOTAL_FLIPS = 20;

// Load IDL
// Check multiple IDL locations: repo idl/ dir, or anchor build output
const IDL_PATH = fs.existsSync(path.join(import.meta.dirname, '..', 'idl', 'the_flip.json'))
  ? path.join(import.meta.dirname, '..', 'idl', 'the_flip.json')
  : path.join(import.meta.dirname, '..', 'target', 'idl', 'the_flip.json');

// Load wallet
function loadWallet(keyPath) {
  const raw = JSON.parse(fs.readFileSync(keyPath || process.env.ANCHOR_WALLET || 
    path.join(process.env.HOME, '.config', 'solana', 'id.json'), 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// PDA derivation — matches our deployed program
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

function getTicketPDA(game, player, round) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ticket'), game.toBuffer(), player.toBuffer(), Buffer.from([round])],
    PROGRAM_ID
  );
}

// Parse predictions string (HHTHTT...) to array of u8 (1=H, 2=T)
function parsePredictions(str) {
  if (str.length !== 20) throw new Error('Must be exactly 20 predictions (H or T)');
  const result = [];
  for (let i = 0; i < 20; i++) {
    const c = str[i].toUpperCase();
    if (c === 'H') result.push(1);
    else if (c === 'T') result.push(2);
    else throw new Error('Invalid char: ' + c + ' (must be H or T)');
  }
  return result;
}

// Format flip result (1=H, 2=T)
function flipToStr(r) { return r === 1 ? 'H' : r === 2 ? 'T' : '?'; }

// Find all unsettled tickets for a given round via raw account scan
async function findRoundTickets(connection, round) {
  const raw = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: 99 }]
  });
  const tickets = [];
  for (const r of raw) {
    const data = r.account.data;
    const ticketRound = data[72];
    const settled = data[97];
    if (ticketRound === round && settled === 0) {
      const player = new PublicKey(data.slice(40, 72));
      tickets.push({
        publicKey: r.pubkey,
        account: { player, round: ticketRound, alive: data[93] === 1, score: data[94], settled: settled === 1 }
      });
    }
  }
  return tickets;
}

// Format USDC amount (6 decimals)
function fmtUsdc(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw.toString());
  return (n / 1_000_000).toFixed(6);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    console.log('🎰 THE FLIP — $1 USDC. 20 Flips. Win $1M+.');
    console.log('');
    console.log('  node app/demo.mjs play <HHTHTT...>   Enter the game (start here!)');
    console.log('  node app/demo.mjs status              Check game state + jackpot');
    console.log('  node app/demo.mjs ticket <pubkey>     Check your ticket');
    console.log('');
    console.log('Example: node app/demo.mjs play HHTHTTHHTHHHTTHHTHHT');
    console.log('');
    console.log('Need USDC? https://faucet.circle.com (Solana, Devnet)');
    process.exit(0);
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

  // Game PDA is always derived from the AUTHORITY, not the current wallet.
  // This lets any player use their own wallet to interact with the same game.
  const [gamePDA] = getGamePDA(AUTHORITY);
  const [vaultPDA] = getVaultPDA(AUTHORITY);

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

      // Need to re-create provider with player as payer
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
      if (game.gameOver) console.log('GAME OVER - all 20 flips complete!');
      break;
    }

    case 'flip-all': {
      console.log('Executing all 20 flips in one transaction...');
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
      console.log('GAME OVER - all 20 flips complete!');
      break;
    }

    case 'crank': {
      const playerPubkey = process.argv[3];
      if (!playerPubkey) { console.error('Usage: crank <player_pubkey>'); process.exit(1); }

      const player = new PublicKey(playerPubkey);
      const game = await program.account.game.fetch(gamePDA);
      const [ticketPDA] = getTicketPDA(gamePDA, player, game.round);

      console.log('Cranking ticket for ' + playerPubkey + '...');
      const tx = await program.methods.crank().accounts({
        cranker: wallet.publicKey,
        game: gamePDA,
        ticket: ticketPDA,
      }).rpc();

      console.log('Crank done! TX:', tx);
      const ticket = await program.account.ticket.fetch(ticketPDA);
      const status = ticket.alive
        ? 'ALIVE (score: ' + ticket.score + '/' + TOTAL_FLIPS + ')'
        : 'DEAD at flip ' + ticket.diedAtFlip + ' (score: ' + ticket.score + ')';
      console.log('Status:', status);
      break;
    }

    case 'settle': {
      const playerPubkey = process.argv[3];
      if (!playerPubkey) { console.error('Usage: settle <player_pubkey>'); process.exit(1); }

      const player = new PublicKey(playerPubkey);
      const game = await program.account.game.fetch(gamePDA);
      const [ticketPDA] = getTicketPDA(gamePDA, player, game.round);
      const playerATA = await getAssociatedTokenAddress(USDC_MINT, player);

      console.log('Settling ticket for ' + playerPubkey + '...');
      const tx = await program.methods.settle().accounts({
        settler: wallet.publicKey,
        game: gamePDA,
        ticket: ticketPDA,
        player: player,
        playerTokenAccount: playerATA,
        vault: vaultPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      console.log('Settlement done! TX:', tx);
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
        console.log('Alive:         ' + game.ticketsAlive);
        console.log('Accepting:     ' + game.acceptingEntries);
        console.log('Game over:     ' + game.gameOver);
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
        console.log('');
        console.log('Tier counts:   ' + JSON.stringify(Array.from(game.tierCounts)));
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
        const status = ticket.alive
          ? 'ALIVE (score: ' + ticket.score + '/' + TOTAL_FLIPS + ')'
          : 'DEAD at flip ' + ticket.diedAtFlip + ' (score: ' + ticket.score + ')';
        console.log('Status:        ' + status);
        console.log('Cranked to:    flip ' + ticket.lastCrankedFlip);
        console.log('Settled:       ' + ticket.settled);
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
      for (let i = 0; i < 20; i++) chars.push(Math.random() < 0.5 ? 'H' : 'T');
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
        console.log('  Entry failed (need USDC or already entered):', e.message?.slice(0, 80));
      }

      // 4. Flip all
      console.log('');
      console.log('Step 3: Execute all 20 flips...');
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

      // 5. Crank
      console.log('');
      console.log('Step 4: Crank ticket...');
      try {
        await program.methods.crank().accounts({
          cranker: wallet.publicKey,
          game: gamePDA,
          ticket: ticketPDA,
        }).rpc();
        const ticket = await program.account.ticket.fetch(ticketPDA);
        const status = ticket.alive
          ? 'ALIVE (score: ' + ticket.score + '/20)'
          : 'DEAD at flip ' + ticket.diedAtFlip + ' (score: ' + ticket.score + ')';
        console.log('  ' + status);
      } catch (e) {
        console.log('  Crank skipped:', e.message?.slice(0, 80));
      }

      // 6. Settle
      console.log('');
      console.log('Step 5: Settle ticket...');
      try {
        await program.methods.settle().accounts({
          settler: wallet.publicKey,
          game: gamePDA,
          ticket: ticketPDA,
          player: wallet.publicKey,
          playerTokenAccount: playerATA,
          vault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        console.log('  Settled');
      } catch (e) {
        console.log('  Settle skipped:', e.message?.slice(0, 80));
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

      console.log('');
      console.log('=== DEMO COMPLETE ===');
      break;
    }

    case 'play': {
      // === THE ONE-STOP COMMAND FOR PLAYERS ===
      // Checks everything, creates what's missing, enters the game.
      const preds = process.argv[3];
      if (!preds || preds.length !== 20 || !/^[HhTt]+$/.test(preds)) {
        console.log('🎰 THE FLIP — Play');
        console.log('');
        console.log('Usage: node app/demo.mjs play <20 H/T predictions>');
        console.log('');
        console.log('Example: node app/demo.mjs play HHTHTTHHTHHHTTHHTHHT');
        console.log('');
        console.log('Each character is your prediction for one coin flip:');
        console.log('  H = Heads, T = Tails');
        console.log('  Must be exactly 20 characters.');
        console.log('');
        console.log('Entry fee: 1 USDC (devnet)');
        console.log('Get USDC: https://faucet.circle.com (select Solana, Devnet)');
        process.exit(1);
      }

      const parsed = parsePredictions(preds);
      console.log('🎰 THE FLIP — Entering Round...');
      console.log('');

      // Check 1: SOL balance
      const solBalance = await connection.getBalance(wallet.publicKey);
      console.log('Wallet:    ' + wallet.publicKey.toBase58());
      console.log('SOL:       ' + (solBalance / 1e9).toFixed(4));
      if (solBalance < 10_000_000) { // 0.01 SOL minimum
        console.error('');
        console.error('❌ Not enough SOL for transaction fees.');
        console.error('   Get devnet SOL: solana airdrop 1 ' + wallet.publicKey.toBase58() + ' --url devnet');
        process.exit(1);
      }
      console.log('           ✅ enough for fees');

      // Check 2: USDC token account
      const playerATA = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
      let usdcBalance = 0;
      try {
        const ataInfo = await getAccount(connection, playerATA);
        usdcBalance = Number(ataInfo.amount);
        console.log('USDC ATA:  ' + playerATA.toBase58());
        console.log('USDC:      ' + (usdcBalance / 1_000_000).toFixed(6));
      } catch (e) {
        // ATA doesn't exist — create it
        console.log('USDC ATA:  not found — creating...');
        try {
          const createATAIx = createAssociatedTokenAccountInstruction(
            wallet.publicKey, playerATA, wallet.publicKey, USDC_MINT
          );
          const tx = new anchor.web3.Transaction().add(createATAIx);
          await provider.sendAndConfirm(tx);
          console.log('           ✅ created ' + playerATA.toBase58());
        } catch (ataErr) {
          console.error('❌ Failed to create USDC token account: ' + ataErr.message?.slice(0, 80));
          process.exit(1);
        }
        usdcBalance = 0;
      }

      if (usdcBalance < 1_000_000) {
        console.error('');
        console.error('❌ Not enough USDC. Need 1 USDC (you have ' + (usdcBalance / 1_000_000).toFixed(6) + ')');
        console.error('');
        console.error('Get devnet USDC:');
        console.error('  1. Go to https://faucet.circle.com');
        console.error('  2. Select: Solana, Devnet');
        console.error('  3. Paste your address: ' + wallet.publicKey.toBase58());
        console.error('  4. Click "Get Tokens"');
        console.error('');
        console.error('Then run this command again.');
        process.exit(1);
      }
      console.log('           ✅ enough to play');

      // Check 3: Game is accepting entries
      const game = await program.account.game.fetch(gamePDA);
      console.log('Round:     ' + game.round);
      console.log('Jackpot:   ' + fmtUsdc(game.jackpotPool) + ' USDC');
      if (!game.acceptingEntries) {
        console.error('');
        console.error('❌ Round ' + game.round + ' is not accepting entries. Wait for the next round.');
        process.exit(1);
      }
      console.log('Status:    ✅ accepting entries');

      // Check 4: Not already entered this round
      const [ticketPDA] = getTicketPDA(gamePDA, wallet.publicKey, game.round);
      try {
        await program.account.ticket.fetch(ticketPDA);
        console.error('');
        console.error('❌ You already entered round ' + game.round + '! Wait for the next round.');
        process.exit(1);
      } catch (e) {
        // Good — no ticket yet
      }

      // All checks passed — enter!
      console.log('');
      console.log('Predictions: ' + preds.toUpperCase());
      console.log('Entering...');

      try {
        const tx = await program.methods.enter(parsed).accounts({
          player: wallet.publicKey,
          game: gamePDA,
          ticket: ticketPDA,
          playerTokenAccount: playerATA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();

        console.log('');
        console.log('🎉 Entry confirmed!');
        console.log('TX: ' + tx);
        console.log('Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
        console.log('');
        console.log('Your ticket is live. Flips happen every ~8 hours.');
        console.log('Check results: node app/demo.mjs ticket ' + wallet.publicKey.toBase58());
      } catch (e) {
        console.error('');
        console.error('❌ Entry failed: ' + (e.message?.slice(0, 120) || e));
        process.exit(1);
      }
      break;
    }

    case 'crank-all': {
      const game = await program.account.game.fetch(gamePDA);
      console.log('Finding all tickets for round', game.round, '...');
      const roundTickets = await findRoundTickets(connection, game.round);
      console.log('Found', roundTickets.length, 'unsettled tickets in round', game.round);
      let cranked = 0;
      for (const t of roundTickets) {
        try {
          await program.methods.crank().accounts({
            cranker: wallet.publicKey, game: gamePDA, ticket: t.publicKey,
          }).rpc();
          console.log('  Cranked', t.account.player.toBase58().slice(0,8) + '...');
          cranked++;
        } catch (e) {
          console.log('  Skip', t.account.player.toBase58().slice(0,8) + '...:', e.message?.slice(0, 60));
        }
      }
      console.log('Cranked', cranked, '/', roundTickets.length, 'tickets');
      break;
    }

    case 'settle-all': {
      const game = await program.account.game.fetch(gamePDA);
      console.log('Finding all tickets to settle in round', game.round, '...');
      const roundTickets = await findRoundTickets(connection, game.round);
      console.log('Found', roundTickets.length, 'unsettled tickets');
      let settled = 0;
      for (const t of roundTickets) {
        try {
          const playerATA = await getAssociatedTokenAddress(USDC_MINT, t.account.player);
          await program.methods.settle().accounts({
            settler: wallet.publicKey, game: gamePDA, ticket: t.publicKey,
            player: t.account.player, playerTokenAccount: playerATA,
            vault: vaultPDA, tokenProgram: TOKEN_PROGRAM_ID,
          }).rpc();
          console.log('  Settled', t.account.player.toBase58().slice(0,8) + '...');
          settled++;
        } catch (e) {
          console.log('  Skip', t.account.player.toBase58().slice(0,8) + '...:', e.message?.slice(0, 60));
        }
      }
      console.log('Settled', settled, '/', roundTickets.length, 'tickets');
      break;
    }

    case 'operate': {
      const game = await program.account.game.fetch(gamePDA);
      const jackpotBefore = fmtUsdc(game.jackpotPool);
      console.log('=== OPERATE ROUND', game.round, '===');
      console.log('Entries:', game.totalEntries, '| Jackpot before:', jackpotBefore, 'USDC');
      if (game.totalEntries === 0) { console.log('No entries — nothing to do.'); break; }

      if (game.acceptingEntries) {
        try {
          await program.methods.closeEntries().accounts({ authority: wallet.publicKey, game: gamePDA }).rpc();
          console.log('1. Entries closed');
        } catch (e) { console.log('1. Close entries:', e.message?.slice(0, 60)); }
      }

      try {
        await program.methods.flipAll().accounts({ authority: wallet.publicKey, game: gamePDA }).rpc();
        const g2 = await program.account.game.fetch(gamePDA);
        const results = g2.flipResults.slice(0, g2.currentFlip).map(r => r === 1 ? 'H' : 'T').join('');
        console.log('2. Flipped:', results);
      } catch (e) { console.log('2. Flip:', e.message?.slice(0, 60)); }

      const roundTickets = await findRoundTickets(connection, game.round);
      console.log('3. Cranking', roundTickets.length, 'tickets...');
      let winners = 0;
      for (const t of roundTickets) {
        try {
          await program.methods.crank().accounts({ cranker: wallet.publicKey, game: gamePDA, ticket: t.publicKey }).rpc();
          const updated = await program.account.ticket.fetch(t.publicKey);
          if (updated.alive && updated.score === 20) winners++;
        } catch (e) { /* already cranked */ }
      }
      console.log('   Winners:', winners);

      console.log('4. Settling all tickets...');
      for (const t of roundTickets) {
        try {
          const playerATA = await getAssociatedTokenAddress(USDC_MINT, t.account.player);
          await program.methods.settle().accounts({
            settler: wallet.publicKey, game: gamePDA, ticket: t.publicKey,
            player: t.account.player, playerTokenAccount: playerATA,
            vault: vaultPDA, tokenProgram: TOKEN_PROGRAM_ID,
          }).rpc();
        } catch (e) { /* already settled */ }
      }
      console.log('   All settled');

      try {
        await program.methods.newRound().accounts({ authority: wallet.publicKey, game: gamePDA }).rpc();
        const finalGame = await program.account.game.fetch(gamePDA);
        const jackpotAfter = fmtUsdc(finalGame.jackpotPool);
        console.log('5. New round', finalGame.round, 'started');
        console.log('');
        console.log('=== RESULT ===');
        console.log('Round', game.round, ':', game.totalEntries, 'entries,', winners, 'winners');
        console.log('Jackpot:', jackpotBefore, '→', jackpotAfter, 'USDC');
      } catch (e) { console.log('5. New round:', e.message?.slice(0, 60)); }
      break;
    }

    default:
      console.error('Unknown command:', cmd);
      console.log('');
      console.log('Available commands:');
      console.log('  play <HHTHTT...>    Enter the game (recommended for players)');
      console.log('  status              Show game state');
      console.log('  ticket <pubkey>     Show a player\'s ticket');
      console.log('');
      console.log('Operator commands:');
      console.log('  init, flip, flip-all, crank, settle, new-round, withdraw-fees');
      process.exit(1);
  }
}

main().catch(e => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
