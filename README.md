# solana-multisig

On-chain multisig wallet requiring M-of-N owner approvals to execute transactions. Secure treasury management for DAOs and teams.

![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![Solana](https://img.shields.io/badge/Solana-9945FF?logo=solana&logoColor=white)
![Anchor](https://img.shields.io/badge/Anchor-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Features

- Configurable M-of-N threshold
- Transaction queue with approvals
- Owner management
- Arbitrary instruction execution

## Program Instructions

`create_multisig` | `create_transaction` | `approve` | `execute_transaction`

## Build

```bash
anchor build
```

## Test

```bash
anchor test
```

## Deploy

```bash
# Devnet
anchor deploy --provider.cluster devnet

# Mainnet
anchor deploy --provider.cluster mainnet
```

## Project Structure

```
programs/
  solana-multisig/
    src/
      lib.rs          # Program entry point and instructions
    Cargo.toml
tests/
  solana-multisig.ts           # Integration tests
Anchor.toml             # Anchor configuration
```

## License

MIT — see [LICENSE](LICENSE) for details.

## Author

Built by [Purple Squirrel Media](https://purplesquirrelmedia.io)
