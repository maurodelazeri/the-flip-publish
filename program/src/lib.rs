use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("7rSMKhD3ve2NcR4qdYK5xcbMHfGtEjTgoKCS5Mgx9ECX");

// Game constants
const ENTRY_FEE: u64 = 1_000_000; // 1 USDC (6 decimals)
const TOTAL_FLIPS: u8 = 20;
const OPERATOR_FEE_BPS: u64 = 100;   // 1% to operator (covers Solana transaction fees)
const MILESTONE_POOL_BPS: u64 = 0;    // 0% to milestone (disabled — all prize money goes to jackpot)
const BPS_BASE: u64 = 10000;
// Jackpot gets the rest: 99%
const MILESTONE_TIERS: [u8; 5] = [15, 16, 17, 18, 19];
const TIER_SPLIT_BPS: u64 = 2000; // Each tier gets 20% of milestone pool

#[program]
pub mod the_flip {
    use super::*;

    /// Initialize a new game. Creates the game state PDA and the USDC vault.
    pub fn initialize_game(ctx: Context<InitializeGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.authority = ctx.accounts.authority.key();
        game.usdc_mint = ctx.accounts.usdc_mint.key();
        game.vault = ctx.accounts.vault.key();
        game.bump = ctx.bumps.game;
        game.vault_bump = ctx.bumps.vault;
        game.current_flip = 0;
        game.flip_results = [0u8; 20];
        game.milestone_pool = 0;
        game.jackpot_pool = 0;
        game.operator_pool = 0;
        game.total_entries = 0;
        game.tickets_alive = 0;
        game.tier_counts = [0u32; 6];
        game.game_over = false;
        game.accepting_entries = true;
        game.round = 0;

        msg!("THE FLIP initialized. Vault: {}", game.vault);
        Ok(())
    }

    /// Player enters the game. Transfers 1 USDC to the vault and creates a ticket PDA.
    pub fn enter(ctx: Context<Enter>, predictions: [u8; 20]) -> Result<()> {
        let game = &mut ctx.accounts.game;

        require!(game.accepting_entries, FlipError::EntriesClosed);
        require!(game.current_flip == 0, FlipError::GameAlreadyStarted);

        // Validate predictions: each byte must be 1 (H) or 2 (T)
        for &p in predictions.iter() {
            require!(p == 1 || p == 2, FlipError::InvalidPrediction);
        }

        // Transfer 1 USDC from player to vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, ENTRY_FEE)?;

        // Split into pools: 1% operator, 0% milestone, 99% jackpot
        let operator_amount = ENTRY_FEE * OPERATOR_FEE_BPS / BPS_BASE;
        let milestone_amount = ENTRY_FEE * MILESTONE_POOL_BPS / BPS_BASE;
        let jackpot_amount = ENTRY_FEE - operator_amount - milestone_amount;
        game.operator_pool += operator_amount;
        game.milestone_pool += milestone_amount;
        game.jackpot_pool += jackpot_amount;
        game.total_entries += 1;
        game.tickets_alive += 1;

        // Initialize ticket
        let ticket = &mut ctx.accounts.ticket;
        ticket.game = game.key();
        ticket.player = ctx.accounts.player.key();
        ticket.round = game.round;
        ticket.predictions = predictions;
        ticket.alive = true;
        ticket.score = 0;
        ticket.last_cranked_flip = 0;
        ticket.died_at_flip = 0;
        ticket.settled = false;
        ticket.bump = ctx.bumps.ticket;

        msg!(
            "Player {} entered round {}. Total entries: {}",
            ctx.accounts.player.key(),
            game.round,
            game.total_entries
        );
        Ok(())
    }

    /// Authority executes a coin flip. Result derived from on-chain slot hash.
    pub fn flip(ctx: Context<Flip>) -> Result<()> {
        let game = &mut ctx.accounts.game;

        require!(!game.game_over, FlipError::GameOver);
        require!(game.current_flip < TOTAL_FLIPS, FlipError::AllFlipsDone);
        require!(game.total_entries > 0, FlipError::NoEntries);

        // Close entries on first flip
        game.accepting_entries = false;

        let flip_index = game.current_flip as usize;

        // Randomness from slot + timestamp + game key + flip number
        let clock = Clock::get()?;
        let mut seed: u8 = game.current_flip;
        for b in clock.slot.to_le_bytes() { seed ^= b; }
        for b in clock.unix_timestamp.to_le_bytes() { seed ^= b; }
        for b in game.key().to_bytes() { seed ^= b; }

        // Even = H (1), Odd = T (2)
        let result: u8 = if seed % 2 == 0 { 1 } else { 2 };

        game.flip_results[flip_index] = result;
        game.current_flip += 1;

        let result_str = if result == 1 { "HEADS" } else { "TAILS" };
        msg!("Flip #{}: {}", game.current_flip, result_str);

        if game.current_flip == TOTAL_FLIPS {
            game.game_over = true;
            msg!("All 20 flips complete. Game over!");
        }

        Ok(())
    }

    /// Authority executes ALL remaining coin flips in a single transaction.
    pub fn flip_all(ctx: Context<Flip>) -> Result<()> {
        let game = &mut ctx.accounts.game;

        require!(!game.game_over, FlipError::GameOver);
        require!(game.current_flip < TOTAL_FLIPS, FlipError::AllFlipsDone);
        require!(game.total_entries > 0, FlipError::NoEntries);

        game.accepting_entries = false;

        let clock = Clock::get()?;

        while game.current_flip < TOTAL_FLIPS {
            let flip_index = game.current_flip as usize;

            let mut seed: u8 = game.current_flip;
            for b in clock.slot.to_le_bytes() { seed ^= b; }
            for b in clock.unix_timestamp.to_le_bytes() { seed ^= b; }
            for b in game.key().to_bytes() { seed ^= b; }

            let result: u8 = if seed % 2 == 0 { 1 } else { 2 };
            game.flip_results[flip_index] = result;
            game.current_flip += 1;
        }

        game.game_over = true;
        msg!("All 20 flips executed in one transaction!");
        Ok(())
    }

    /// Crank a ticket: check predictions against flips. Permissionless.
    pub fn crank(ctx: Context<Crank>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let ticket = &mut ctx.accounts.ticket;

        require!(game.current_flip > 0, FlipError::NoFlipsYet);
        require!(ticket.alive, FlipError::TicketDead);
        require!(
            ticket.last_cranked_flip < game.current_flip,
            FlipError::AlreadyCranked
        );

        let start_flip = ticket.last_cranked_flip as usize;
        let end_flip = game.current_flip as usize;

        for i in start_flip..end_flip {
            let predicted = ticket.predictions[i];
            let actual = game.flip_results[i];

            if predicted == actual {
                ticket.score = (i + 1) as u8;
            } else {
                ticket.alive = false;
                ticket.died_at_flip = (i + 1) as u8;
                game.tickets_alive -= 1;

                // Record ONLY the highest qualifying tier (not cumulative)
                let score = ticket.score;
                let mut best_idx: Option<usize> = None;
                for (idx, &tier) in MILESTONE_TIERS.iter().enumerate() {
                    if score >= tier {
                        best_idx = Some(idx);
                    }
                }
                if let Some(idx) = best_idx {
                    game.tier_counts[idx] += 1;
                }

                msg!("Ticket ELIMINATED at flip {}. Score: {}", i + 1, ticket.score);
                break;
            }
        }

        ticket.last_cranked_flip = game.current_flip;

        // If game over and ticket survived all 20 = jackpot
        if game.game_over && ticket.alive && ticket.score == TOTAL_FLIPS {
            game.tier_counts[5] += 1;
            msg!("JACKPOT WINNER: {} with 20/20!", ticket.player);
        }

        Ok(())
    }

    /// Settle a ticket: pay winnings from the vault. Permissionless.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let ticket = &mut ctx.accounts.ticket;

        require!(game.game_over, FlipError::GameNotOver);
        require!(ticket.last_cranked_flip == TOTAL_FLIPS, FlipError::NotFullyCranked);
        require!(!ticket.settled, FlipError::AlreadySettled);

        let score = ticket.score;
        let mut payout: u64 = 0;

        if score >= TOTAL_FLIPS {
            // Jackpot — winner takes all (split if multiple)
            let winners = game.tier_counts[5] as u64;
            if winners > 0 {
                payout = game.jackpot_pool / winners;
            }
        } else {
            // Highest qualifying milestone tier
            let mut best_tier_idx: Option<usize> = None;
            for (idx, &tier) in MILESTONE_TIERS.iter().enumerate() {
                if score >= tier {
                    best_tier_idx = Some(idx);
                }
            }

            if let Some(idx) = best_tier_idx {
                let tier_pool = game.milestone_pool * TIER_SPLIT_BPS / BPS_BASE;
                let winners = game.tier_counts[idx] as u64;
                if winners > 0 {
                    payout = tier_pool / winners;
                }
            }
        }

        if payout > 0 {
            // PDA signer seeds for vault
            let authority_key = game.authority;
            let seeds = &[
                b"vault" as &[u8],
                authority_key.as_ref(),
                &[game.vault_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.player_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, payout)?;

            msg!("Payout: {} USDC units to {}", payout, ticket.player);
        }

        // Decrement alive count when settling a surviving ticket (jackpot winner)
        if ticket.alive {
            game.tickets_alive -= 1;
        }

        ticket.settled = true;
        Ok(())
    }

    /// Authority withdraws accumulated operator fees from the vault.
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;

        require!(amount <= game.operator_pool, FlipError::InsufficientFees);

        let authority_key = game.authority;
        let seeds = &[
            b"vault" as &[u8],
            authority_key.as_ref(),
            &[game.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.authority_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        game.operator_pool -= amount;
        msg!("Withdrew {} USDC units in operator fees", amount);
        Ok(())
    }

    /// Start a new round. Jackpot carries over if no winner. Authority only.
    pub fn new_round(ctx: Context<AuthorityOnly>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.game_over, FlipError::GameNotOver);

        // Safety: all alive tickets must be settled before starting a new round.
        // This prevents the authority from zeroing the jackpot before winners can claim.
        require!(game.tickets_alive == 0, FlipError::UnsettledTickets);

        // Jackpot carries over if no one won 20/20
        if game.tier_counts[5] > 0 {
            game.jackpot_pool = 0; // Was paid out
        }
        // else: jackpot_pool stays — accumulates into next round!

        // Milestone pool resets (paid out or forfeited each round)
        game.milestone_pool = 0;

        // Reset game state for new round
        game.current_flip = 0;
        game.flip_results = [0u8; 20];
        game.total_entries = 0;
        game.tickets_alive = 0;
        game.tier_counts = [0u32; 6];
        game.game_over = false;
        game.accepting_entries = true;
        game.round += 1;

        msg!("New round started: {}. Jackpot pool: {}", game.round, game.jackpot_pool);
        Ok(())
    }

    /// Save round results before new_round wipes the state. Authority only.
    /// Call after all tickets are settled, before new_round.
    pub fn save_round(ctx: Context<SaveRound>) -> Result<()> {
        let game = &ctx.accounts.game;
        let result = &mut ctx.accounts.round_result;

        require!(game.game_over, FlipError::GameNotOver);

        result.game = game.key();
        result.round = game.round;
        result.flip_results = game.flip_results;
        result.total_entries = game.total_entries;
        result.jackpot_pool = game.jackpot_pool;
        result.winners = game.tier_counts[5];
        result.timestamp = Clock::get()?.unix_timestamp;
        result.bump = ctx.bumps.round_result;

        msg!(
            "Round {} saved. Entries: {}, Winners: {}, Jackpot: {}",
            game.round, game.total_entries, game.tier_counts[5], game.jackpot_pool
        );
        Ok(())
    }

    /// Close entries manually (authority only).
    pub fn close_entries(ctx: Context<AuthorityOnly>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.accepting_entries = false;
        msg!("Entries closed.");
        Ok(())
    }

    /// Close old game PDA for migration. Authority only.
    pub fn close_game_v1(ctx: Context<CloseGameV1>) -> Result<()> {
        let game_info = ctx.accounts.game.to_account_info();
        let authority_info = ctx.accounts.authority.to_account_info();

        // Return lamports to authority
        let lamports = game_info.lamports();
        **game_info.try_borrow_mut_lamports()? = 0;
        **authority_info.try_borrow_mut_lamports()? += lamports;

        // Zero out data
        let mut data = game_info.try_borrow_mut_data()?;
        for byte in data.iter_mut() {
            *byte = 0;
        }

        msg!("Old game PDA closed.");
        Ok(())
    }
}

// ─── Account Contexts ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", authority.key().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = vault,
        seeds = [b"vault", authority.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Enter<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.authority.as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = player,
        space = 8 + Ticket::INIT_SPACE,
        seeds = [b"ticket", game.key().as_ref(), player.key().as_ref(), &[game.round]],
        bump,
    )]
    pub ticket: Account<'info, Ticket>,

    #[account(
        mut,
        constraint = player_token_account.owner == player.key(),
        constraint = player_token_account.mint == game.usdc_mint,
    )]
    pub player_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = game.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Flip<'info> {
    #[account(
        constraint = authority.key() == game.authority @ FlipError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.authority.as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct Crank<'info> {
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.authority.as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        constraint = ticket.game == game.key() @ FlipError::TicketGameMismatch,
    )]
    pub ticket: Account<'info, Ticket>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub settler: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.authority.as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        constraint = ticket.game == game.key() @ FlipError::TicketGameMismatch,
        constraint = ticket.player == player.key() @ FlipError::PlayerMismatch,
    )]
    pub ticket: Account<'info, Ticket>,

    /// CHECK: Verified via ticket.player constraint
    pub player: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = player_token_account.owner == player.key(),
        constraint = player_token_account.mint == game.usdc_mint,
    )]
    pub player_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = game.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(
        constraint = authority.key() == game.authority @ FlipError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.authority.as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        constraint = authority_token_account.owner == authority.key(),
        constraint = authority_token_account.mint == game.usdc_mint,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = game.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    #[account(
        constraint = authority.key() == game.authority @ FlipError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.authority.as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct SaveRound<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"game", authority.key().as_ref()],
        bump = game.bump,
        constraint = authority.key() == game.authority @ FlipError::Unauthorized,
    )]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = authority,
        space = 8 + RoundResult::INIT_SPACE,
        seeds = [b"round_result", game.key().as_ref(), &[game.round]],
        bump,
    )]
    pub round_result: Account<'info, RoundResult>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseGameV1<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Old game PDA being closed. Verified by seeds.
    #[account(
        mut,
        seeds = [b"game", authority.key().as_ref()],
        bump,
    )]
    pub game: UncheckedAccount<'info>,
}

// ─── State ──────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
    pub current_flip: u8,
    pub flip_results: [u8; 20],
    pub milestone_pool: u64,
    pub jackpot_pool: u64,
    pub operator_pool: u64,
    pub total_entries: u32,
    pub tickets_alive: u32,
    pub tier_counts: [u32; 6],
    pub game_over: bool,
    pub accepting_entries: bool,
    pub round: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub game: Pubkey,
    pub player: Pubkey,
    pub round: u8,
    pub predictions: [u8; 20],
    pub alive: bool,
    pub score: u8,
    pub last_cranked_flip: u8,
    pub died_at_flip: u8,
    pub settled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RoundResult {
    pub game: Pubkey,           // 32 — which game
    pub round: u8,              // 1  — which round
    pub flip_results: [u8; 20], // 20 — the coin flip outcomes
    pub total_entries: u32,     // 4  — how many players entered
    pub jackpot_pool: u64,      // 8  — jackpot at end of round (0 if winner paid out, carries if not)
    pub winners: u32,           // 4  — number of 20/20 winners
    pub timestamp: i64,         // 8  — when the round ended
    pub bump: u8,               // 1  — PDA bump
}

// ─── Errors ─────────────────────────────────────────────────────────────────

#[error_code]
pub enum FlipError {
    #[msg("Entries are closed")]
    EntriesClosed,
    #[msg("Game has already started")]
    GameAlreadyStarted,
    #[msg("Invalid prediction: must be 1 (H) or 2 (T)")]
    InvalidPrediction,
    #[msg("All flips have been executed")]
    AllFlipsDone,
    #[msg("Game is over")]
    GameOver,
    #[msg("No entries in the game")]
    NoEntries,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("No flips yet")]
    NoFlipsYet,
    #[msg("Ticket is dead")]
    TicketDead,
    #[msg("Already cranked")]
    AlreadyCranked,
    #[msg("Not fully cranked")]
    NotFullyCranked,
    #[msg("Already settled")]
    AlreadySettled,
    #[msg("Game not over")]
    GameNotOver,
    #[msg("Ticket/game mismatch")]
    TicketGameMismatch,
    #[msg("Player mismatch")]
    PlayerMismatch,
    #[msg("Insufficient operator fees")]
    InsufficientFees,
    #[msg("All tickets must be settled before starting a new round")]
    UnsettledTickets,
}
