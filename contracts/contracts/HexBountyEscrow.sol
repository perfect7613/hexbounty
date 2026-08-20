// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HexBountyEscrow
/// @notice Testnet-only escrow for software-reconstruction bounties.
/// @dev The sponsor decides whether to accept a submission. Evidence hashes are
///      commitments, not correctness oracles and not proofs of equivalence.
contract HexBountyEscrow is ReentrancyGuard {
    uint16 public constant PLATFORM_FEE_BPS = 250;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    enum BountyState {
        Open,
        Submitted,
        Awarded,
        Refunded
    }

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

    error ZeroAddress();
    error EmptyValue();
    error InvalidDeadline();
    error RewardTooLarge();
    error BountyNotFound(uint256 bountyId);
    error SubmissionNotFound(uint256 bountyId, uint32 submissionId);
    error BountyNotOpen(uint256 bountyId);
    error BountyNotSubmitted(uint256 bountyId);
    error BountyExpired(uint256 bountyId);
    error DeadlineNotReached(uint256 bountyId);
    error Unauthorized(address caller);
    error NativeTransferFailed(address recipient, uint256 amount);

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed sponsor,
        uint256 reward,
        uint64 deadline,
        string metadataURI
    );
    event BountyFunded(
        uint256 indexed bountyId,
        address indexed funder,
        uint256 amount,
        uint256 totalReward
    );
    event SolutionSubmitted(
        uint256 indexed bountyId,
        uint32 indexed submissionId,
        address indexed builder,
        bytes32 artifactHash,
        bytes32 evidenceHash,
        string evidenceURI,
        string liveURL
    );
    event SolutionAccepted(
        uint256 indexed bountyId,
        uint32 indexed submissionId,
        address indexed sponsor,
        address builder,
        uint256 builderPayout,
        uint256 platformFee
    );
    event BountyRefunded(
        uint256 indexed bountyId,
        address indexed sponsor,
        uint256 amount
    );

    address public immutable feeRecipient;
    uint256 public bountyCount;
    uint256 public totalEscrowed;

    mapping(uint256 bountyId => Bounty bounty) private _bounties;
    mapping(uint256 bountyId => uint32 count) private _submissionCounts;
    mapping(uint256 bountyId => mapping(uint32 submissionId => Submission submission))
        private _submissions;

    constructor(address feeRecipient_) {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeRecipient = feeRecipient_;
    }

    function createBounty(string calldata metadataURI, uint64 deadline)
        external
        payable
        returns (uint256 bountyId)
    {
        if (msg.value == 0 || bytes(metadataURI).length == 0) revert EmptyValue();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (msg.value > type(uint96).max) revert RewardTooLarge();

        bountyId = ++bountyCount;
        _bounties[bountyId] = Bounty({
            sponsor: msg.sender,
            reward: uint96(msg.value),
            deadline: deadline,
            state: BountyState.Open,
            acceptedSubmissionId: 0,
            metadataURI: metadataURI
        });
        totalEscrowed += msg.value;

        emit BountyCreated(bountyId, msg.sender, msg.value, deadline, metadataURI);
    }

    function fundBounty(uint256 bountyId) external payable {
        Bounty storage bounty = _requireBounty(bountyId);
        if (bounty.state != BountyState.Open) revert BountyNotOpen(bountyId);
        if (block.timestamp >= bounty.deadline) revert BountyExpired(bountyId);
        if (msg.value == 0) revert EmptyValue();

        uint256 newReward = uint256(bounty.reward) + msg.value;
        if (newReward > type(uint96).max) revert RewardTooLarge();

        bounty.reward = uint96(newReward);
        totalEscrowed += msg.value;

        emit BountyFunded(bountyId, msg.sender, msg.value, newReward);
    }

    function submitSolution(
        uint256 bountyId,
        bytes32 artifactHash,
        bytes32 evidenceHash,
        string calldata evidenceURI,
        string calldata liveURL
    ) external returns (uint32 submissionId) {
        Bounty storage bounty = _requireBounty(bountyId);
        if (
            bounty.state != BountyState.Open
                && bounty.state != BountyState.Submitted
        ) revert BountyNotOpen(bountyId);
        if (block.timestamp >= bounty.deadline) revert BountyExpired(bountyId);
        if (
            artifactHash == bytes32(0) || evidenceHash == bytes32(0)
                || bytes(evidenceURI).length == 0 || bytes(liveURL).length == 0
        ) revert EmptyValue();

        submissionId = ++_submissionCounts[bountyId];
        _submissions[bountyId][submissionId] = Submission({
            builder: msg.sender,
            artifactHash: artifactHash,
            evidenceHash: evidenceHash,
            evidenceURI: evidenceURI,
            liveURL: liveURL
        });
        bounty.state = BountyState.Submitted;

        emit SolutionSubmitted(
            bountyId,
            submissionId,
            msg.sender,
            artifactHash,
            evidenceHash,
            evidenceURI,
            liveURL
        );
    }

    function acceptSolution(uint256 bountyId, uint32 submissionId)
        external
        nonReentrant
    {
        Bounty storage bounty = _requireBounty(bountyId);
        if (msg.sender != bounty.sponsor) revert Unauthorized(msg.sender);
        if (bounty.state != BountyState.Submitted) {
            revert BountyNotSubmitted(bountyId);
        }

        Submission storage submission = _submissions[bountyId][submissionId];
        if (submission.builder == address(0)) {
            revert SubmissionNotFound(bountyId, submissionId);
        }

        uint256 reward = bounty.reward;
        uint256 platformFee = (reward * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 builderPayout = reward - platformFee;

        bounty.state = BountyState.Awarded;
        bounty.acceptedSubmissionId = submissionId;
        totalEscrowed -= reward;

        _sendNative(submission.builder, builderPayout);
        if (platformFee != 0) _sendNative(feeRecipient, platformFee);

        emit SolutionAccepted(
            bountyId,
            submissionId,
            msg.sender,
            submission.builder,
            builderPayout,
            platformFee
        );
    }

    function refundExpiredBounty(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _requireBounty(bountyId);
        if (msg.sender != bounty.sponsor) revert Unauthorized(msg.sender);
        if (
            bounty.state != BountyState.Open
                && bounty.state != BountyState.Submitted
        ) revert BountyNotOpen(bountyId);
        if (block.timestamp < bounty.deadline) revert DeadlineNotReached(bountyId);

        uint256 refund = bounty.reward;
        bounty.state = BountyState.Refunded;
        totalEscrowed -= refund;

        _sendNative(bounty.sponsor, refund);
        emit BountyRefunded(bountyId, bounty.sponsor, refund);
    }

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return _requireBounty(bountyId);
    }

    function getSubmission(uint256 bountyId, uint32 submissionId)
        external
        view
        returns (Submission memory)
    {
        _requireBounty(bountyId);
        Submission storage submission = _submissions[bountyId][submissionId];
        if (submission.builder == address(0)) {
            revert SubmissionNotFound(bountyId, submissionId);
        }
        return submission;
    }

    function getSubmissionCount(uint256 bountyId) external view returns (uint32) {
        _requireBounty(bountyId);
        return _submissionCounts[bountyId];
    }

    function _requireBounty(uint256 bountyId)
        private
        view
        returns (Bounty storage bounty)
    {
        if (bountyId == 0 || bountyId > bountyCount) {
            revert BountyNotFound(bountyId);
        }
        return _bounties[bountyId];
    }

    function _sendNative(address recipient, uint256 amount) private {
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert NativeTransferFailed(recipient, amount);
    }
}
