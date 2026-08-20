# contracts

`HexBountyEscrow` — the Monad Testnet escrow contract. **Implemented, tested,
deployed, and source-verified.**

`HexBountyPaidPlay` — a separate paid-access registry for accepted bounty
submissions. **Implemented, tested, deployed, and source-verified.**

A single non-upgradeable Solidity contract. It escrows a sponsor's testnet MON
against a bounty, records artifact and evidence commitments from builders, and
pays out on the sponsor's acceptance or refunds after the deadline.

It stores **hashes and discovery URLs only** — never binaries, never evidence
payloads.

## Paid play registry

`HexBountyPaidPlay` references the existing escrow rather than replacing it.
An accepted builder can publish exactly one game for the accepted submission,
select a unique URL slug hash, and set a nonzero native-MON play price. The
creator always has access; each other wallet purchases permanent access once.

### Monad Testnet deployment

| Field | Value |
|---|---|
| Chain | Monad Testnet (`10143`) |
| Contract | [`0xef61C98BE27E1381cB7188975F8D7e938d1a0E64`](https://testnet.monadscan.com/address/0xef61C98BE27E1381cB7188975F8D7e938d1a0E64) |
| Deployment transaction | [`0x07ad324122f56daa095fc90db256c1ae6a57251994245a5f1a29d1bd7111d04e`](https://testnet.monadscan.com/tx/0x07ad324122f56daa095fc90db256c1ae6a57251994245a5f1a29d1bd7111d04e) |
| Block | `54204437` |
| Existing escrow | `0xc3F9fb30d87CFf804F394C680Ed7856B055F7c96` |
| Fee recipient | `0xEB155dc01Be246C2C0fd9d6a96BB359894865981` |
| Source verification | [Exact creation and runtime match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0xef61C98BE27E1381cB7188975F8D7e938d1a0E64) on MonadVision Sourcify |
| Deployment cost | `0.1299684 MON` (`1,274,200` gas at `102 gwei`) |

The machine-readable public record is
[`deployments/monad-testnet-paid-play-10143.json`](deployments/monad-testnet-paid-play-10143.json).

The registry deliberately stores only `gameContentHash`, not the reconstructed
binary's storage URL. Every contract field is public. Putting a raw UploadThing
URL onchain would make the paywall cosmetic because anyone could read and share
it. The application should keep the game object private and, after checking
`hasAccess(slugHash, wallet)`, return a short-lived download URL whose bytes
match `gameContentHash`.

`metadataURI` is different: it is the public JSON description for discovery
(name, console, screenshots, creator address, evidence links, and content
hash). It must not contain the private game URL or an upload service key.

### Paid-play interface

```solidity
struct Publication {
    address creator;
    uint96 playPrice;
    uint32 submissionId;
    uint64 purchaseCount;
    uint256 bountyId;
    bytes32 gameContentHash;
    string metadataURI;
}

publishGame(
    bytes32 slugHash,
    uint256 bountyId,
    uint32 submissionId,
    uint256 playPrice,
    bytes32 gameContentHash,
    string metadataURI
)
updatePlayPrice(bytes32 slugHash, uint256 newPrice)
purchaseAccess(bytes32 slugHash) payable
withdrawEarnings(address payable recipient)
hasAccess(bytes32 slugHash, address player)
getPublication(bytes32 slugHash)
getSlugForSubmission(uint256 bountyId, uint32 submissionId)
```

Events: `GamePublished`, `PlayPriceUpdated`, `AccessPurchased`, and
`EarningsWithdrawn`.

Purchases accrue 97.5% to the accepted builder and 2.5% to the platform fee
recipient. Both withdraw later. This pull-payment design means a creator or fee
recipient that rejects MON cannot block a player's purchase. Withdrawals use
checks-effects-interactions and `ReentrancyGuard`, and callers can redirect a
withdrawal to another recipient.

`slugHash` must be calculated consistently by every client:

```ts
const normalizedSlug = slug.trim().toLowerCase();
const slugHash = keccak256(toBytes(normalizedSlug));
```

Enforce the application's slug grammar before hashing (recommended:
`^[a-z0-9]+(?:-[a-z0-9]+)*$`). The contract guarantees hash uniqueness; the
application owns human-readable normalization.

### Monad Testnet deployment inputs

The canonical deployment above is complete. For an intentional future
redeployment, first confirm these public constructor parameters in
[`ignition/parameters/monad-testnet-paid-play.json`](ignition/parameters/monad-testnet-paid-play.json):

- `escrow`: the existing, source-verified Monad Testnet `HexBountyEscrow`
  (`0xc3F9fb30d87CFf804F394C680Ed7856B055F7c96`).
- `feeRecipient`: the wallet that accrues the 2.5% platform share. It can be the
  deployer, but should be explicitly approved before deployment.

The deployment machine needs only:

```dotenv
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_DEPLOYER_PRIVATE_KEY=0x... # funded throwaway Monad Testnet key
MONAD_EXPLORER_API_KEY=...       # Monadscan source-verification key
```

The deployer needs enough testnet MON for contract deployment. No UploadThing,
Modal, Vercel, or frontend environment variables are used by the contracts.
After reviewing the two constructor addresses, deploy and verify with:

```bash
cd contracts
npm run compile
npm test
npm run deploy:paid-play:testnet
```

Because Monad charges for the submitted gas limit rather than gas ultimately
used, clients should estimate each write immediately before sending and add no
more than a small buffer (at most 10%). Do not reuse Ethereum-style oversized
gas limits. `purchaseAccess` touches a small, fixed set of storage slots and
makes no external calls; withdrawals make one external call after accounting
is cleared.

## Monad Testnet deployment

| Field | Value |
|---|---|
| Chain | Monad Testnet (`10143`) |
| Contract | [`0xc3F9fb30d87CFf804F394C680Ed7856B055F7c96`](https://testnet.monadscan.com/address/0xc3F9fb30d87CFf804F394C680Ed7856B055F7c96) |
| Deployment transaction | [`0xeb89ef8a2204dda71e3c8f7139372678a4aa30a933f4158ccada5ea4c9fd4624`](https://testnet.monadscan.com/tx/0xeb89ef8a2204dda71e3c8f7139372678a4aa30a933f4158ccada5ea4c9fd4624) |
| Block | `54183176` |
| Fee recipient | `0xEB155dc01Be246C2C0fd9d6a96BB359894865981` (the testnet deployer) |
| Source verification | [Exact creation and runtime match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0xc3F9fb30d87CFf804F394C680Ed7856B055F7c96) on MonadVision Sourcify |
| Deployment cost | `0.138673692 MON` (`1,359,546` gas at `102 gwei`) |

The machine-readable public record is
[`deployments/monad-testnet-10143.json`](deployments/monad-testnet-10143.json).

## Layout

```text
contracts/
  contracts/HexBountyEscrow.sol
  ignition/modules/HexBountyEscrow.ts
  scripts/
  test/HexBountyEscrow.test.ts
  deployments/
```

## Interface

```solidity
enum BountyState { Open, Submitted, Awarded, Refunded }

struct Bounty {
    address sponsor;
    uint96 reward;
    uint64 deadline;
    BountyState state;
    uint32 acceptedSubmissionId;
    string metadataURI;
}

struct Submission {
    address builder;
    bytes32 artifactHash;
    bytes32 evidenceHash;
    string evidenceURI;
    string liveURL;
}

createBounty(string metadataURI, uint64 deadline) payable
fundBounty(uint256 bountyId) payable
submitSolution(
    uint256 bountyId,
    bytes32 artifactHash,
    bytes32 evidenceHash,
    string evidenceURI,
    string liveURL
)
acceptSolution(uint256 bountyId, uint32 submissionId)
refundExpiredBounty(uint256 bountyId)
getBounty(uint256 bountyId)
getSubmission(uint256 bountyId, uint32 submissionId)
```

Events: `BountyCreated`, `BountyFunded`, `SolutionSubmitted`, `SolutionAccepted`,
`BountyRefunded`.

`evidenceHash` is `keccak256` over the RFC 8785 canonical form of the evidence
document. The browser recomputes it independently, so the contract's
expectations and the pipeline's output have to agree byte for byte.

## Rules

- Require a nonzero creation deposit.
- Require a future deadline.
- Allow funding only while open.
- Allow submissions only before closure or refund.
- Only the sponsor may accept or refund.
- Refund only after the deadline.
- Prevent double acceptance and double refund.
- Reject empty artifact and evidence hashes.
- Fixed 2.5% platform fee, charged only on accepted bounties.
- Checks-effects-interactions, with reentrancy protection.
- Immutable fee recipient.

## Required tests

All nine Hardhat tests currently pass. They cover:

- successful create, fund, submit, accept, and refund
- invalid reward and deadline
- unauthorized acceptance and refund
- submission to a missing, expired, awarded, or refunded bounty
- exact payout and platform-fee accounting
- double-action prevention
- event arguments
- failed-recipient behavior
- contract balance always covers unresolved rewards

## Not in scope

No token, no NFT, no DAO governance, no decentralized arbitration, no correctness
oracle, no upgradeability, no mainnet deployment. The contract escrows value
against a sponsor's decision; it does not adjudicate whether a reconstruction is
correct.
