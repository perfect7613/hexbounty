import { expect } from "chai";
import { network } from "hardhat";

const REWARD = 10_000n;
const PRICE = 10_000n;
const PLATFORM_FEE = 250n;
const CREATOR_EARNINGS = PRICE - PLATFORM_FEE;
const ARTIFACT_HASH = `0x${"11".repeat(32)}`;
const EVIDENCE_HASH = `0x${"22".repeat(32)}`;
const SLUG_HASH = `0x${"33".repeat(32)}`;
const OTHER_SLUG_HASH = `0x${"44".repeat(32)}`;
const GAME_CONTENT_HASH = `0x${"55".repeat(32)}`;
const METADATA_URI = "https://uploads.example/game.json";

describe("HexBountyPaidPlay", function () {
  async function deployFixture(options?: { reenteringFeeRecipient?: boolean }) {
    const { ethers } = await network.create();
    const [sponsor, creator, player, stranger, payoutRecipient] =
      await ethers.getSigners();

    const escrow = await ethers.deployContract("HexBountyEscrow", [
      sponsor.address,
    ]);
    await escrow.waitForDeployment();

    const reenteringReceiver = options?.reenteringFeeRecipient
      ? await ethers.deployContract("ReenteringPaidPlayReceiver")
      : undefined;
    await reenteringReceiver?.waitForDeployment();
    const feeRecipient = reenteringReceiver
      ? await reenteringReceiver.getAddress()
      : sponsor.address;

    const paidPlay = await ethers.deployContract("HexBountyPaidPlay", [
      await escrow.getAddress(),
      feeRecipient,
    ]);
    await paidPlay.waitForDeployment();

    return {
      ethers,
      escrow,
      paidPlay,
      sponsor,
      creator,
      player,
      stranger,
      payoutRecipient,
      reenteringReceiver,
      feeRecipient,
    };
  }

  async function createSubmittedBounty(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
  ) {
    const block = await fixture.ethers.provider.getBlock("latest");
    const deadline = BigInt(block!.timestamp + 3_600);
    await fixture.escrow
      .connect(fixture.sponsor)
      .createBounty("ipfs://bounty", deadline, { value: REWARD });
    await fixture.escrow
      .connect(fixture.creator)
      .submitSolution(
        1n,
        ARTIFACT_HASH,
        EVIDENCE_HASH,
        "ipfs://evidence",
        "https://example.test/game",
      );
  }

  async function acceptAndPublish(
    fixture: Awaited<ReturnType<typeof deployFixture>>,
  ) {
    await createSubmittedBounty(fixture);
    await fixture.escrow.connect(fixture.sponsor).acceptSolution(1n, 1n);
    await fixture.paidPlay
      .connect(fixture.creator)
      .publishGame(
        SLUG_HASH,
        1n,
        1n,
        PRICE,
        GAME_CONTENT_HASH,
        METADATA_URI,
      );
  }

  it("publishes only the accepted builder's accepted submission", async function () {
    const f = await deployFixture();
    await createSubmittedBounty(f);

    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(
          SLUG_HASH,
          1n,
          1n,
          PRICE,
          GAME_CONTENT_HASH,
          METADATA_URI,
        ),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "SubmissionNotAccepted")
      .withArgs(1n, 1n);

    await f.escrow.connect(f.sponsor).acceptSolution(1n, 1n);

    await expect(
      f.paidPlay
        .connect(f.stranger)
        .publishGame(
          SLUG_HASH,
          1n,
          1n,
          PRICE,
          GAME_CONTENT_HASH,
          METADATA_URI,
        ),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "Unauthorized")
      .withArgs(f.stranger.address);

    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(
          SLUG_HASH,
          1n,
          1n,
          PRICE,
          GAME_CONTENT_HASH,
          METADATA_URI,
        ),
    )
      .to.emit(f.paidPlay, "GamePublished")
      .withArgs(
        SLUG_HASH,
        1n,
        1n,
        f.creator.address,
        PRICE,
        GAME_CONTENT_HASH,
        METADATA_URI,
      );

    const publication = await f.paidPlay.getPublication(SLUG_HASH);
    expect(publication.creator).to.equal(f.creator.address);
    expect(publication.playPrice).to.equal(PRICE);
    expect(publication.purchaseCount).to.equal(0n);
    expect(publication.bountyId).to.equal(1n);
    expect(publication.submissionId).to.equal(1n);
    expect(publication.gameContentHash).to.equal(GAME_CONTENT_HASH);
    expect(publication.metadataURI).to.equal(METADATA_URI);
    expect(await f.paidPlay.getSlugForSubmission(1n, 1n)).to.equal(SLUG_HASH);
    expect(await f.paidPlay.hasAccess(SLUG_HASH, f.creator.address)).to.equal(
      true,
    );
  });

  it("enforces globally unique slugs and one publication per submission", async function () {
    const f = await deployFixture();
    await acceptAndPublish(f);

    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(
          SLUG_HASH,
          1n,
          1n,
          PRICE,
          GAME_CONTENT_HASH,
          METADATA_URI,
        ),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "SlugAlreadyPublished")
      .withArgs(SLUG_HASH);

    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(
          OTHER_SLUG_HASH,
          1n,
          1n,
          PRICE,
          GAME_CONTENT_HASH,
          METADATA_URI,
        ),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "SubmissionAlreadyPublished")
      .withArgs(1n, 1n);
  });

  it("grants paid access and accrues the 97.5/2.5 split without inline transfers", async function () {
    const f = await deployFixture();
    await acceptAndPublish(f);

    await expect(
      f.paidPlay.connect(f.player).purchaseAccess(SLUG_HASH, { value: PRICE }),
    )
      .to.emit(f.paidPlay, "AccessPurchased")
      .withArgs(
        SLUG_HASH,
        f.player.address,
        f.creator.address,
        CREATOR_EARNINGS,
        PLATFORM_FEE,
      );

    expect(await f.paidPlay.hasAccess(SLUG_HASH, f.player.address)).to.equal(
      true,
    );
    expect((await f.paidPlay.getPublication(SLUG_HASH)).purchaseCount).to.equal(
      1n,
    );
    expect(await f.paidPlay.pendingWithdrawals(f.creator.address)).to.equal(
      CREATOR_EARNINGS,
    );
    expect(await f.paidPlay.pendingWithdrawals(f.feeRecipient)).to.equal(
      PLATFORM_FEE,
    );
    expect(await f.paidPlay.totalPendingWithdrawals()).to.equal(PRICE);
    expect(
      await f.ethers.provider.getBalance(await f.paidPlay.getAddress()),
    ).to.equal(PRICE);
  });

  it("requires the current exact price and prevents duplicate purchases", async function () {
    const f = await deployFixture();
    await acceptAndPublish(f);

    await expect(
      f.paidPlay.connect(f.player).purchaseAccess(SLUG_HASH, {
        value: PRICE - 1n,
      }),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "IncorrectPayment")
      .withArgs(PRICE, PRICE - 1n);
    await expect(
      f.paidPlay.connect(f.player).purchaseAccess(SLUG_HASH, {
        value: PRICE + 1n,
      }),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "IncorrectPayment")
      .withArgs(PRICE, PRICE + 1n);

    await f.paidPlay
      .connect(f.player)
      .purchaseAccess(SLUG_HASH, { value: PRICE });
    await expect(
      f.paidPlay.connect(f.player).purchaseAccess(SLUG_HASH, { value: PRICE }),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "AccessAlreadyGranted")
      .withArgs(SLUG_HASH, f.player.address);
    await expect(
      f.paidPlay.connect(f.creator).purchaseAccess(SLUG_HASH, { value: PRICE }),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "AccessAlreadyGranted")
      .withArgs(SLUG_HASH, f.creator.address);
  });

  it("allows only the creator to update a nonzero play price", async function () {
    const f = await deployFixture();
    await acceptAndPublish(f);

    await expect(
      f.paidPlay.connect(f.stranger).updatePlayPrice(SLUG_HASH, 20_000n),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "Unauthorized")
      .withArgs(f.stranger.address);
    await expect(
      f.paidPlay.connect(f.creator).updatePlayPrice(SLUG_HASH, 0n),
    ).to.be.revertedWithCustomError(f.paidPlay, "EmptyValue");
    await expect(
      f.paidPlay.connect(f.creator).updatePlayPrice(SLUG_HASH, 20_000n),
    )
      .to.emit(f.paidPlay, "PlayPriceUpdated")
      .withArgs(SLUG_HASH, f.creator.address, PRICE, 20_000n);
    expect((await f.paidPlay.getPublication(SLUG_HASH)).playPrice).to.equal(
      20_000n,
    );
  });

  it("withdraws accrued earnings to an account-selected recipient", async function () {
    const f = await deployFixture();
    await acceptAndPublish(f);
    await f.paidPlay
      .connect(f.player)
      .purchaseAccess(SLUG_HASH, { value: PRICE });

    const before = await f.ethers.provider.getBalance(f.payoutRecipient.address);
    await expect(
      f.paidPlay
        .connect(f.creator)
        .withdrawEarnings(f.payoutRecipient.address),
    )
      .to.emit(f.paidPlay, "EarningsWithdrawn")
      .withArgs(
        f.creator.address,
        f.payoutRecipient.address,
        CREATOR_EARNINGS,
      );
    expect(await f.ethers.provider.getBalance(f.payoutRecipient.address)).to.equal(
      before + CREATOR_EARNINGS,
    );
    expect(await f.paidPlay.pendingWithdrawals(f.creator.address)).to.equal(0n);
    expect(await f.paidPlay.totalPendingWithdrawals()).to.equal(PLATFORM_FEE);
  });

  it("rolls back a failed withdrawal without losing the account's credit", async function () {
    const f = await deployFixture();
    await acceptAndPublish(f);
    await f.paidPlay
      .connect(f.player)
      .purchaseAccess(SLUG_HASH, { value: PRICE });
    const rejecting = await f.ethers.deployContract("RejectingPaidPlayReceiver");
    await rejecting.waitForDeployment();

    await expect(
      f.paidPlay
        .connect(f.creator)
        .withdrawEarnings(await rejecting.getAddress()),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "NativeTransferFailed")
      .withArgs(await rejecting.getAddress(), CREATOR_EARNINGS);
    expect(await f.paidPlay.pendingWithdrawals(f.creator.address)).to.equal(
      CREATOR_EARNINGS,
    );
    expect(await f.paidPlay.totalPendingWithdrawals()).to.equal(PRICE);
  });

  it("rejects reentrant withdrawal while completing the original withdrawal once", async function () {
    const f = await deployFixture({ reenteringFeeRecipient: true });
    await acceptAndPublish(f);
    await f.paidPlay
      .connect(f.player)
      .purchaseAccess(SLUG_HASH, { value: PRICE });

    await f.reenteringReceiver!.withdraw(await f.paidPlay.getAddress());
    expect(await f.reenteringReceiver!.received()).to.equal(PLATFORM_FEE);
    expect(await f.reenteringReceiver!.reentryRejected()).to.equal(true);
    expect(await f.paidPlay.pendingWithdrawals(f.feeRecipient)).to.equal(0n);
    expect(await f.paidPlay.totalPendingWithdrawals()).to.equal(
      CREATOR_EARNINGS,
    );
  });

  it("rejects zero constructor values, empty publication fields, missing games, and empty withdrawals", async function () {
    const f = await deployFixture();
    await expect(
      f.ethers.deployContract("HexBountyPaidPlay", [
        f.ethers.ZeroAddress,
        f.sponsor.address,
      ]),
    ).to.be.revertedWithCustomError(f.paidPlay, "ZeroAddress");
    await expect(
      f.ethers.deployContract("HexBountyPaidPlay", [
        await f.escrow.getAddress(),
        f.ethers.ZeroAddress,
      ]),
    ).to.be.revertedWithCustomError(f.paidPlay, "ZeroAddress");
    await expect(f.paidPlay.getPublication(SLUG_HASH))
      .to.be.revertedWithCustomError(f.paidPlay, "PublicationNotFound")
      .withArgs(SLUG_HASH);
    await expect(
      f.paidPlay.connect(f.creator).withdrawEarnings(f.creator.address),
    )
      .to.be.revertedWithCustomError(f.paidPlay, "NothingToWithdraw")
      .withArgs(f.creator.address);

    await createSubmittedBounty(f);
    await f.escrow.connect(f.sponsor).acceptSolution(1n, 1n);
    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(
          f.ethers.ZeroHash,
          1n,
          1n,
          PRICE,
          GAME_CONTENT_HASH,
          METADATA_URI,
        ),
    ).to.be.revertedWithCustomError(f.paidPlay, "EmptyValue");
    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(SLUG_HASH, 1n, 1n, 0n, GAME_CONTENT_HASH, METADATA_URI),
    ).to.be.revertedWithCustomError(f.paidPlay, "EmptyValue");
    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(
          SLUG_HASH,
          1n,
          1n,
          PRICE,
          f.ethers.ZeroHash,
          METADATA_URI,
        ),
    ).to.be.revertedWithCustomError(f.paidPlay, "EmptyValue");
    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(SLUG_HASH, 1n, 1n, PRICE, GAME_CONTENT_HASH, ""),
    ).to.be.revertedWithCustomError(f.paidPlay, "EmptyValue");
    await expect(
      f.paidPlay
        .connect(f.creator)
        .publishGame(
          SLUG_HASH,
          1n,
          1n,
          1n << 96n,
          GAME_CONTENT_HASH,
          METADATA_URI,
        ),
    ).to.be.revertedWithCustomError(f.paidPlay, "PriceTooLarge");
  });
});
