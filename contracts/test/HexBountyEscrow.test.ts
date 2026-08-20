import { expect } from "chai";
import { network } from "hardhat";

const REWARD = 10_000n;
const ARTIFACT_HASH = `0x${"11".repeat(32)}`;
const EVIDENCE_HASH = `0x${"22".repeat(32)}`;
const METADATA_URI = "ipfs://bounty-metadata";
const EVIDENCE_URI = "ipfs://evidence";
const LIVE_URL = "https://example.test/reconstruction";

describe("HexBountyEscrow", function () {
  async function deployFixture() {
    const { ethers } = await network.create();
    const [sponsor, builder, funder, feeRecipient, stranger] =
      await ethers.getSigners();
    const escrow = await ethers.deployContract("HexBountyEscrow", [
      feeRecipient.address,
    ]);
    await escrow.waitForDeployment();
    return { ethers, escrow, sponsor, builder, funder, feeRecipient, stranger };
  }

  async function futureDeadline(ethers: Awaited<ReturnType<typeof deployFixture>>["ethers"]) {
    const block = await ethers.provider.getBlock("latest");
    return BigInt(block!.timestamp + 3_600);
  }

  async function createBounty(fixture: Awaited<ReturnType<typeof deployFixture>>) {
    const deadline = await futureDeadline(fixture.ethers);
    await fixture.escrow
      .connect(fixture.sponsor)
      .createBounty(METADATA_URI, deadline, { value: REWARD });
    return deadline;
  }

  async function submit(fixture: Awaited<ReturnType<typeof deployFixture>>) {
    await fixture.escrow
      .connect(fixture.builder)
      .submitSolution(
        1n,
        ARTIFACT_HASH,
        EVIDENCE_HASH,
        EVIDENCE_URI,
        LIVE_URL,
      );
  }

  it("creates and funds a bounty while preserving the escrow invariant", async function () {
    const f = await deployFixture();
    const deadline = await futureDeadline(f.ethers);

    await expect(
      f.escrow
        .connect(f.sponsor)
        .createBounty(METADATA_URI, deadline, { value: REWARD }),
    )
      .to.emit(f.escrow, "BountyCreated")
      .withArgs(1n, f.sponsor.address, REWARD, deadline, METADATA_URI);

    await expect(f.escrow.connect(f.funder).fundBounty(1n, { value: 5_000n }))
      .to.emit(f.escrow, "BountyFunded")
      .withArgs(1n, f.funder.address, 5_000n, 15_000n);

    const bounty = await f.escrow.getBounty(1n);
    expect(bounty.sponsor).to.equal(f.sponsor.address);
    expect(bounty.reward).to.equal(15_000n);
    expect(bounty.state).to.equal(0n);
    expect(await f.escrow.totalEscrowed()).to.equal(15_000n);
    expect(
      await f.ethers.provider.getBalance(await f.escrow.getAddress()),
    ).to.be.gte(await f.escrow.totalEscrowed());
  });

  it("submits multiple evidence commitments and exposes them by id", async function () {
    const f = await deployFixture();
    await createBounty(f);

    await expect(
      f.escrow
        .connect(f.builder)
        .submitSolution(
          1n,
          ARTIFACT_HASH,
          EVIDENCE_HASH,
          EVIDENCE_URI,
          LIVE_URL,
        ),
    )
      .to.emit(f.escrow, "SolutionSubmitted")
      .withArgs(
        1n,
        1n,
        f.builder.address,
        ARTIFACT_HASH,
        EVIDENCE_HASH,
        EVIDENCE_URI,
        LIVE_URL,
      );

    await f.escrow
      .connect(f.stranger)
      .submitSolution(
        1n,
        ARTIFACT_HASH,
        EVIDENCE_HASH,
        EVIDENCE_URI,
        LIVE_URL,
      );

    expect(await f.escrow.getSubmissionCount(1n)).to.equal(2n);
    expect((await f.escrow.getSubmission(1n, 1n)).builder).to.equal(
      f.builder.address,
    );
    expect((await f.escrow.getBounty(1n)).state).to.equal(1n);
  });

  it("accepts a submission and splits the reward 97.5/2.5", async function () {
    const f = await deployFixture();
    await createBounty(f);
    await submit(f);

    const builderBefore = await f.ethers.provider.getBalance(f.builder.address);
    const feeBefore = await f.ethers.provider.getBalance(f.feeRecipient.address);
    const expectedFee = 250n;
    const expectedPayout = REWARD - expectedFee;

    await expect(f.escrow.connect(f.sponsor).acceptSolution(1n, 1n))
      .to.emit(f.escrow, "SolutionAccepted")
      .withArgs(
        1n,
        1n,
        f.sponsor.address,
        f.builder.address,
        expectedPayout,
        expectedFee,
      );

    expect(await f.ethers.provider.getBalance(f.builder.address)).to.equal(
      builderBefore + expectedPayout,
    );
    expect(await f.ethers.provider.getBalance(f.feeRecipient.address)).to.equal(
      feeBefore + expectedFee,
    );
    const bounty = await f.escrow.getBounty(1n);
    expect(bounty.state).to.equal(2n);
    expect(bounty.acceptedSubmissionId).to.equal(1n);
    expect(await f.escrow.totalEscrowed()).to.equal(0n);
  });

  it("refunds the sponsor after the deadline", async function () {
    const f = await deployFixture();
    const deadline = await createBounty(f);
    await f.ethers.provider.send("evm_setNextBlockTimestamp", [Number(deadline)]);

    await expect(f.escrow.connect(f.sponsor).refundExpiredBounty(1n))
      .to.emit(f.escrow, "BountyRefunded")
      .withArgs(1n, f.sponsor.address, REWARD);

    expect((await f.escrow.getBounty(1n)).state).to.equal(3n);
    expect(await f.escrow.totalEscrowed()).to.equal(0n);
  });

  it("rejects invalid creation and funding", async function () {
    const f = await deployFixture();
    const deadline = await futureDeadline(f.ethers);

    await expect(
      f.escrow.connect(f.sponsor).createBounty(METADATA_URI, deadline),
    ).to.be.revertedWithCustomError(f.escrow, "EmptyValue");
    await expect(
      f.escrow.connect(f.sponsor).createBounty("", deadline, { value: 1n }),
    ).to.be.revertedWithCustomError(f.escrow, "EmptyValue");
    await expect(
      f.escrow.connect(f.sponsor).createBounty(METADATA_URI, 1n, { value: 1n }),
    ).to.be.revertedWithCustomError(f.escrow, "InvalidDeadline");

    await createBounty(f);
    await expect(
      f.escrow.connect(f.funder).fundBounty(1n),
    ).to.be.revertedWithCustomError(f.escrow, "EmptyValue");
    await submit(f);
    await expect(
      f.escrow.connect(f.funder).fundBounty(1n, { value: 1n }),
    ).to.be.revertedWithCustomError(f.escrow, "BountyNotOpen");
  });

  it("rejects unauthorized, premature, repeated, and missing actions", async function () {
    const f = await deployFixture();
    const deadline = await createBounty(f);

    await expect(
      f.escrow.connect(f.stranger).refundExpiredBounty(1n),
    )
      .to.be.revertedWithCustomError(f.escrow, "Unauthorized")
      .withArgs(f.stranger.address);
    await expect(
      f.escrow.connect(f.sponsor).refundExpiredBounty(1n),
    ).to.be.revertedWithCustomError(f.escrow, "DeadlineNotReached");
    await expect(
      f.escrow.connect(f.sponsor).acceptSolution(1n, 1n),
    ).to.be.revertedWithCustomError(f.escrow, "BountyNotSubmitted");

    await submit(f);
    await expect(
      f.escrow.connect(f.stranger).acceptSolution(1n, 1n),
    )
      .to.be.revertedWithCustomError(f.escrow, "Unauthorized")
      .withArgs(f.stranger.address);
    await expect(
      f.escrow.connect(f.sponsor).acceptSolution(1n, 99n),
    ).to.be.revertedWithCustomError(f.escrow, "SubmissionNotFound");

    await f.escrow.connect(f.sponsor).acceptSolution(1n, 1n);
    await expect(
      f.escrow.connect(f.sponsor).acceptSolution(1n, 1n),
    ).to.be.revertedWithCustomError(f.escrow, "BountyNotSubmitted");
    await f.ethers.provider.send("evm_setNextBlockTimestamp", [Number(deadline)]);
    await expect(
      f.escrow.connect(f.sponsor).refundExpiredBounty(1n),
    ).to.be.revertedWithCustomError(f.escrow, "BountyNotOpen");
    await expect(f.escrow.getBounty(999n)).to.be.revertedWithCustomError(
      f.escrow,
      "BountyNotFound",
    );
  });

  it("rejects expired submissions", async function () {
    const f = await deployFixture();
    const deadline = await createBounty(f);
    await f.ethers.provider.send("evm_setNextBlockTimestamp", [Number(deadline)]);

    await expect(
      f.escrow
        .connect(f.builder)
        .submitSolution(
          1n,
          ARTIFACT_HASH,
          EVIDENCE_HASH,
          EVIDENCE_URI,
          LIVE_URL,
        ),
    ).to.be.revertedWithCustomError(f.escrow, "BountyExpired");
  });

  it("rolls back acceptance when a builder rejects native MON", async function () {
    const f = await deployFixture();
    await createBounty(f);
    const rejectingBuilder = await f.ethers.deployContract("RejectingReceiver");
    await rejectingBuilder.waitForDeployment();
    await rejectingBuilder.submitSolution(
      await f.escrow.getAddress(),
      1n,
      ARTIFACT_HASH,
      EVIDENCE_HASH,
      EVIDENCE_URI,
      LIVE_URL,
    );

    await expect(
      f.escrow.connect(f.sponsor).acceptSolution(1n, 1n),
    ).to.be.revertedWithCustomError(f.escrow, "NativeTransferFailed");
    expect((await f.escrow.getBounty(1n)).state).to.equal(1n);
    expect(await f.escrow.totalEscrowed()).to.equal(REWARD);
  });

  it("rolls back refund when a sponsor rejects native MON", async function () {
    const f = await deployFixture();
    const rejectingSponsor = await f.ethers.deployContract("RejectingReceiver");
    await rejectingSponsor.waitForDeployment();
    const deadline = await futureDeadline(f.ethers);
    await rejectingSponsor.createBounty(
      await f.escrow.getAddress(),
      METADATA_URI,
      deadline,
      { value: REWARD },
    );
    await f.ethers.provider.send("evm_setNextBlockTimestamp", [Number(deadline)]);

    await expect(
      rejectingSponsor.refundExpiredBounty(await f.escrow.getAddress(), 1n),
    ).to.be.revertedWithCustomError(f.escrow, "NativeTransferFailed");
    expect((await f.escrow.getBounty(1n)).state).to.equal(0n);
    expect(await f.escrow.totalEscrowed()).to.equal(REWARD);
  });
});
