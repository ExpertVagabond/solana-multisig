use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("3AZTsn99QJnAVJ7gJE5QWgbWgj5jJ8D6wEBn89fKJvJH");

const MAX_OWNERS: usize = 10;

#[program]
pub mod solana_multisig {
    use super::*;

    pub fn create_multisig(ctx: Context<CreateMultisig>, owners: Vec<Pubkey>, threshold: u8) -> Result<()> {
        require!(owners.len() >= 2 && owners.len() <= MAX_OWNERS, MultisigError::InvalidOwners);
        require!(threshold >= 1 && (threshold as usize) <= owners.len(), MultisigError::InvalidThreshold);

        let ms = &mut ctx.accounts.multisig;
        ms.owners = owners;
        ms.threshold = threshold;
        ms.tx_count = 0;
        ms.bump = ctx.bumps.multisig;
        Ok(())
    }

    pub fn propose_transfer(ctx: Context<ProposeTransfer>, amount: u64, memo: [u8; 32]) -> Result<()> {
        let ms = &mut ctx.accounts.multisig;
        let tx_id = ms.tx_count;
        ms.tx_count = tx_id.checked_add(1).ok_or(MultisigError::Overflow)?;

        let tx = &mut ctx.accounts.transaction;
        tx.multisig = ms.key();
        tx.id = tx_id;
        tx.proposer = ctx.accounts.proposer.key();
        tx.to = ctx.accounts.to_account.key();
        tx.amount = amount;
        tx.memo = memo;
        tx.approvals = vec![false; ms.owners.len()];
        tx.executed = false;
        tx.created_at = Clock::get()?.unix_timestamp;
        tx.bump = ctx.bumps.transaction;

        // Auto-approve for proposer
        let idx = ms.owners.iter().position(|o| *o == ctx.accounts.proposer.key());
        if let Some(i) = idx {
            tx.approvals[i] = true;
        }
        Ok(())
    }

    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        let ms = &ctx.accounts.multisig;
        let tx = &mut ctx.accounts.transaction;
        require!(!tx.executed, MultisigError::AlreadyExecuted);

        let idx = ms.owners.iter().position(|o| *o == ctx.accounts.approver.key())
            .ok_or(MultisigError::NotAnOwner)?;
        require!(!tx.approvals[idx], MultisigError::AlreadyApproved);
        tx.approvals[idx] = true;
        Ok(())
    }

    pub fn execute(ctx: Context<Execute>) -> Result<()> {
        let ms = &ctx.accounts.multisig;
        let tx = &mut ctx.accounts.transaction;
        require!(!tx.executed, MultisigError::AlreadyExecuted);

        let approval_count = tx.approvals.iter().filter(|a| **a).count();
        require!(approval_count >= ms.threshold as usize, MultisigError::ThresholdNotMet);

        let payer_key = ms.owners[0];
        let bump = ms.bump;
        let seeds: &[&[u8]] = &[b"multisig", payer_key.as_ref(), &[bump]];

        token::transfer(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.to_account.to_account_info(),
                authority: ctx.accounts.multisig.to_account_info(),
            },
            &[seeds],
        ), tx.amount)?;

        tx.executed = true;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(owners: Vec<Pubkey>)]
pub struct CreateMultisig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + 4 + (32 * MAX_OWNERS) + 1 + 8 + 1,
        seeds = [b"multisig", payer.key().as_ref()], bump)]
    pub multisig: Account<'info, Multisig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeTransfer<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(mut, seeds = [b"multisig", multisig.owners[0].as_ref()], bump = multisig.bump)]
    pub multisig: Account<'info, Multisig>,
    #[account(init, payer = proposer, space = 8 + 32 + 8 + 32 + 32 + 8 + 32 + 4 + MAX_OWNERS + 1 + 8 + 1,
        seeds = [b"tx", multisig.key().as_ref(), &multisig.tx_count.to_le_bytes()], bump)]
    pub transaction: Account<'info, MultisigTransaction>,
    /// CHECK: destination token account
    pub to_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Approve<'info> {
    pub approver: Signer<'info>,
    pub multisig: Account<'info, Multisig>,
    #[account(mut, has_one = multisig)]
    pub transaction: Account<'info, MultisigTransaction>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    pub executor: Signer<'info>,
    pub multisig: Account<'info, Multisig>,
    #[account(mut, has_one = multisig)]
    pub transaction: Account<'info, MultisigTransaction>,
    #[account(mut, constraint = vault.owner == multisig.key())]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = to_account.key() == transaction.to)]
    pub to_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Multisig {
    pub owners: Vec<Pubkey>,
    pub threshold: u8,
    pub tx_count: u64,
    pub bump: u8,
}

#[account]
pub struct MultisigTransaction {
    pub multisig: Pubkey,
    pub id: u64,
    pub proposer: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub memo: [u8; 32],
    pub approvals: Vec<bool>,
    pub executed: bool,
    pub created_at: i64,
    pub bump: u8,
}

#[error_code]
pub enum MultisigError {
    #[msg("Invalid number of owners (2-10)")]
    InvalidOwners,
    #[msg("Invalid threshold")]
    InvalidThreshold,
    #[msg("Not an owner")]
    NotAnOwner,
    #[msg("Already approved")]
    AlreadyApproved,
    #[msg("Already executed")]
    AlreadyExecuted,
    #[msg("Threshold not met")]
    ThresholdNotMet,
    #[msg("Overflow")]
    Overflow,
}
