import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { SolanaMultisig } from "../target/types/solana_multisig";

describe("solana-multisig", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .solanaMultisig as Program<SolanaMultisig>;
  const payer = provider.wallet as anchor.Wallet;

  // Three owners for the multisig
  const owner1 = payer; // payer is owner1 (seeds use payer.publicKey)
  const owner2 = Keypair.generate();
  const owner3 = Keypair.generate();
  const nonOwner = Keypair.generate();

  let multisigPda: PublicKey;
  let multisigBump: number;
  let tokenMint: PublicKey;
  let vault: PublicKey; // token account owned by multisig PDA
  let destinationAccount: PublicKey;
  let transactionPda: PublicKey;
  let transactionBump: number;

  const THRESHOLD = 2;
  const TRANSFER_AMOUNT = new anchor.BN(500_000);
  const MEMO = Array.from(Buffer.alloc(32, 0xfe));
  const MINT_AMOUNT = 10_000_000;

  before(async () => {
    // Airdrop to owner2, owner3, and nonOwner
    const airdrops = [owner2, owner3, nonOwner].map(async (kp) => {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    });
    await Promise.all(airdrops);

    // Derive multisig PDA (seeded with payer/owner1 pubkey)
    [multisigPda, multisigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("multisig"), payer.publicKey.toBuffer()],
      program.programId
    );

    // Create token mint
    tokenMint = await createMint(
      provider.connection,
      (payer as any).payer,
      payer.publicKey,
      null,
      6
    );

    // Create vault owned by multisig PDA
    vault = await createAccount(
      provider.connection,
      (payer as any).payer,
      tokenMint,
      multisigPda,
      Keypair.generate() // use a separate keypair so the ATA isn't derived
    );

    // Create destination token account
    destinationAccount = await createAccount(
      provider.connection,
      (payer as any).payer,
      tokenMint,
      owner3.publicKey
    );

    // Fund the vault with tokens
    await mintTo(
      provider.connection,
      (payer as any).payer,
      tokenMint,
      vault,
      payer.publicKey,
      MINT_AMOUNT
    );
  });

  it("create_multisig — creates with 3 owners, threshold 2", async () => {
    const owners = [
      payer.publicKey,
      owner2.publicKey,
      owner3.publicKey,
    ];

    await program.methods
      .createMultisig(owners, THRESHOLD)
      .accounts({
        payer: payer.publicKey,
        multisig: multisigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const ms = await program.account.multisig.fetch(multisigPda);
    assert.equal(ms.owners.length, 3);
    assert.ok(ms.owners[0].equals(payer.publicKey));
    assert.ok(ms.owners[1].equals(owner2.publicKey));
    assert.ok(ms.owners[2].equals(owner3.publicKey));
    assert.equal(ms.threshold, THRESHOLD);
    assert.equal(ms.txCount.toNumber(), 0);
    assert.equal(ms.bump, multisigBump);
  });

  it("propose_transfer — propose a transfer (auto-approves for proposer)", async () => {
    // Derive transaction PDA using tx_count = 0
    const txId = new anchor.BN(0);
    [transactionPda, transactionBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("tx"),
        multisigPda.toBuffer(),
        txId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    await program.methods
      .proposeTransfer(TRANSFER_AMOUNT, MEMO)
      .accounts({
        proposer: payer.publicKey,
        multisig: multisigPda,
        transaction: transactionPda,
        toAccount: destinationAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const tx = await program.account.multisigTransaction.fetch(transactionPda);
    assert.ok(tx.multisig.equals(multisigPda));
    assert.equal(tx.id.toNumber(), 0);
    assert.ok(tx.proposer.equals(payer.publicKey));
    assert.ok(tx.to.equals(destinationAccount));
    assert.equal(tx.amount.toNumber(), TRANSFER_AMOUNT.toNumber());
    assert.deepEqual(tx.memo, MEMO);
    assert.equal(tx.executed, false);

    // Proposer (owner1 at index 0) should be auto-approved
    assert.equal(tx.approvals[0], true);
    assert.equal(tx.approvals[1], false);
    assert.equal(tx.approvals[2], false);

    // Verify tx_count incremented
    const ms = await program.account.multisig.fetch(multisigPda);
    assert.equal(ms.txCount.toNumber(), 1);
  });

  it("error: execute before threshold met (only 1 of 2 approvals)", async () => {
    try {
      await program.methods
        .execute()
        .accounts({
          executor: payer.publicKey,
          multisig: multisigPda,
          transaction: transactionPda,
          vault: vault,
          toAccount: destinationAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have thrown ThresholdNotMet error");
    } catch (err: any) {
      assert.include(err.toString(), "ThresholdNotMet");
    }
  });

  it("approve — second owner approves", async () => {
    await program.methods
      .approve()
      .accounts({
        approver: owner2.publicKey,
        multisig: multisigPda,
        transaction: transactionPda,
      })
      .signers([owner2])
      .rpc();

    const tx = await program.account.multisigTransaction.fetch(transactionPda);
    assert.equal(tx.approvals[0], true); // owner1 (auto-approved)
    assert.equal(tx.approvals[1], true); // owner2 (just approved)
    assert.equal(tx.approvals[2], false); // owner3
  });

  it("error: duplicate approval", async () => {
    try {
      await program.methods
        .approve()
        .accounts({
          approver: owner2.publicKey,
          multisig: multisigPda,
          transaction: transactionPda,
        })
        .signers([owner2])
        .rpc();
      assert.fail("Should have thrown AlreadyApproved error");
    } catch (err: any) {
      assert.include(err.toString(), "AlreadyApproved");
    }
  });

  it("error: non-owner cannot approve", async () => {
    try {
      await program.methods
        .approve()
        .accounts({
          approver: nonOwner.publicKey,
          multisig: multisigPda,
          transaction: transactionPda,
        })
        .signers([nonOwner])
        .rpc();
      assert.fail("Should have thrown NotAnOwner error");
    } catch (err: any) {
      assert.include(err.toString(), "NotAnOwner");
    }
  });

  it("execute — execute after threshold met", async () => {
    const destBefore = (
      await getAccount(provider.connection, destinationAccount)
    ).amount;

    await program.methods
      .execute()
      .accounts({
        executor: payer.publicKey,
        multisig: multisigPda,
        transaction: transactionPda,
        vault: vault,
        toAccount: destinationAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const tx = await program.account.multisigTransaction.fetch(transactionPda);
    assert.equal(tx.executed, true);

    // Verify tokens transferred
    const destAfter = (
      await getAccount(provider.connection, destinationAccount)
    ).amount;
    assert.equal(
      Number(destAfter) - Number(destBefore),
      TRANSFER_AMOUNT.toNumber()
    );

    // Verify vault balance decreased
    const vaultBalance = (await getAccount(provider.connection, vault)).amount;
    assert.equal(
      Number(vaultBalance),
      MINT_AMOUNT - TRANSFER_AMOUNT.toNumber()
    );
  });
});
