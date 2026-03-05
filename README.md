# solana-multisig

Multi-signature wallet with configurable threshold approvals for SPL token transfers on Solana.

![Rust](https://img.shields.io/badge/Rust-000000?logo=rust) ![Solana](https://img.shields.io/badge/Solana-9945FF?logo=solana&logoColor=white) ![Anchor](https://img.shields.io/badge/Anchor-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Overview

A Solana Anchor program implementing an M-of-N multi-signature wallet for SPL token transfers. Owners (2-10) are registered at creation with a configurable approval threshold. Any owner can propose a transfer, which auto-approves for the proposer. Once the threshold is met, any signer can execute the transfer from the multisig vault. Transactions include a 32-byte memo field and are tracked with an incrementing counter.

## Program Instructions

| Instruction | Description | Key Accounts |
|---|---|---|
| `create_multisig` | Initialize a multisig wallet with a list of owners and approval threshold | `payer` (signer), `multisig` (PDA) |
| `propose_transfer` | Propose a new token transfer from the vault (auto-approves for proposer) | `proposer` (signer), `multisig`, `transaction` (PDA), `to_account` |
| `approve` | Approve a pending transaction as an owner | `approver` (signer), `multisig`, `transaction` |
| `execute` | Execute a fully-approved transaction, transferring tokens from the vault | `executor` (signer), `multisig`, `transaction`, `vault`, `to_account` |

## Account Structures

### Multisig

| Field | Type | Description |
|---|---|---|
| `owners` | `Vec<Pubkey>` | List of owner public keys (2-10) |
| `threshold` | `u8` | Required number of approvals |
| `tx_count` | `u64` | Incrementing transaction counter |
| `bump` | `u8` | PDA bump seed |

### MultisigTransaction

| Field | Type | Description |
|---|---|---|
| `multisig` | `Pubkey` | Associated multisig wallet |
| `id` | `u64` | Transaction index |
| `proposer` | `Pubkey` | Owner who proposed the transfer |
| `to` | `Pubkey` | Destination token account |
| `amount` | `u64` | Transfer amount |
| `memo` | `[u8; 32]` | Arbitrary memo data |
| `approvals` | `Vec<bool>` | Approval status per owner |
| `executed` | `bool` | Whether the transfer has been executed |
| `created_at` | `i64` | Unix timestamp of proposal creation |
| `bump` | `u8` | PDA bump seed |

## PDA Seeds

- **Multisig:** `["multisig", payer]`
- **Transaction:** `["tx", multisig, tx_count_bytes]`

## Error Codes

| Error | Description |
|---|---|
| `InvalidOwners` | Owner count must be 2-10 |
| `InvalidThreshold` | Threshold must be between 1 and owner count |
| `NotAnOwner` | Signer is not a registered owner |
| `AlreadyApproved` | Owner has already approved this transaction |
| `AlreadyExecuted` | Transaction was already executed |
| `ThresholdNotMet` | Not enough approvals to execute |
| `Overflow` | Arithmetic overflow |

## Build & Test

```bash
anchor build
anchor test
```

## Deploy

```bash
solana config set --url devnet
anchor deploy
```

## License

[MIT](LICENSE)
