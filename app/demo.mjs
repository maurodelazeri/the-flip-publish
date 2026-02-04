/**
 * THE FLIP — Demo & Agent Operations Script
 * 
 * Works with deployed program: 7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX
 * 
 * Usage:
 *   node app/demo.mjs init                    Initialize game + vault
 *   node app/demo.mjs enter <HHTHTT...>       Enter with 20 H/T predictions
 *   node app/demo.mjs flip                    Execute one coin flip
 *   node app/demo.mjs flip-all                Execute all 20 flips in one tx
 *   node app/demo.mjs crank <player_pubkey>   Evaluate ticket vs flip results
 *   node app/demo.mjs settle <player_pubkey>  Pay winnings from vault
 *   node app/demo.mjs status                  Show game state
 *   node app/demo.mjs ticket <player_pubkey>  Show a player's ticket
 *   node app/demo.mjs new-round               Start new round (jackpot carries)
 *   node app/demo.mjs withdraw-fees [amount]  Withdraw operator fees
 *   node app/demo.mjs close-entries           Close entries manually
 *   node app/demo.mjs full-demo               Run complete demo cycle
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

// Format USDC amount (6 decimals)
function fmtUsdc(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw.toString());
  return (n / 1_000_000).toFixed(6);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    console.log('Usage: node app/demo.mjs <command> [args]');
    console.log('Commands: init, enter, flip, flip-all, crank, settle, status, ticket, new-round, withdraw-fees, close-entries, full-demo');
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

    default:
      console.error('Unknown command:', cmd);
      process.exit(1);
  }
}

main().catch(e => {
  console.error('Error:', e.message || e);
  process.exit(1);
});
