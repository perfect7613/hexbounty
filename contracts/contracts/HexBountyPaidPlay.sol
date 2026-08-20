// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IHexBountyEscrowRead {
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

    function getBounty(uint256 bountyId) external view returns (Bounty memory);

    function getSubmission(uint256 bountyId, uint32 submissionId)
        external
        view
        returns (Submission memory);
}

/// @title HexBountyPaidPlay
/// @notice Publishes accepted HexBounty reconstructions and sells wallet access
///         for native MON. Earnings use pull payments so purchases never depend
///         on the creator or platform recipient accepting an inline transfer.
contract HexBountyPaidPlay is ReentrancyGuard {
    uint16 public constant PLATFORM_FEE_BPS = 250;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    struct Publication {
        address creator;
        uint96 playPrice;
        uint32 submissionId;
        uint64 purchaseCount;
        uint256 bountyId;
        bytes32 gameContentHash;
        string metadataURI;
    }

    error ZeroAddress();
    error EmptyValue();
    error PriceTooLarge();
    error PublicationNotFound(bytes32 slugHash);
    error SlugAlreadyPublished(bytes32 slugHash);
    error SubmissionAlreadyPublished(uint256 bountyId, uint32 submissionId);
    error SubmissionNotAccepted(uint256 bountyId, uint32 submissionId);
    error Unauthorized(address caller);
    error IncorrectPayment(uint256 expected, uint256 received);
    error AccessAlreadyGranted(bytes32 slugHash, address player);
    error NothingToWithdraw(address account);
    error NativeTransferFailed(address recipient, uint256 amount);

    event GamePublished(
        bytes32 indexed slugHash,
        uint256 indexed bountyId,
        uint32 indexed submissionId,
        address creator,
        uint256 playPrice,
        bytes32 gameContentHash,
        string metadataURI
    );
    event PlayPriceUpdated(
        bytes32 indexed slugHash,
        address indexed creator,
        uint256 oldPrice,
        uint256 newPrice
    );
    event AccessPurchased(
        bytes32 indexed slugHash,
        address indexed player,
        address indexed creator,
        uint256 creatorEarnings,
        uint256 platformFee
    );
    event EarningsWithdrawn(
        address indexed account,
        address indexed recipient,
        uint256 amount
    );

    IHexBountyEscrowRead public immutable escrow;
    address public immutable feeRecipient;
    uint256 public totalPendingWithdrawals;

    mapping(bytes32 slugHash => Publication publication) private _publications;
    mapping(bytes32 slugHash => mapping(address player => bool purchased))
        private _purchasedAccess;
    mapping(bytes32 submissionKey => bytes32 slugHash)
        private _slugBySubmission;
    mapping(address account => uint256 amount) public pendingWithdrawals;

    constructor(IHexBountyEscrowRead escrow_, address feeRecipient_) {
        if (address(escrow_) == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        escrow = escrow_;
        feeRecipient = feeRecipient_;
    }

    /// @notice Publish a reconstruction after its bounty sponsor accepts it.
    /// @param slugHash keccak256 of the normalized, human-readable URL slug.
    function publishGame(
        bytes32 slugHash,
        uint256 bountyId,
        uint32 submissionId,
        uint256 playPrice,
        bytes32 gameContentHash,
        string calldata metadataURI
    ) external {
        if (
            slugHash == bytes32(0) || playPrice == 0
                || gameContentHash == bytes32(0)
                || bytes(metadataURI).length == 0
        ) revert EmptyValue();
        if (playPrice > type(uint96).max) revert PriceTooLarge();
        if (_publications[slugHash].creator != address(0)) {
            revert SlugAlreadyPublished(slugHash);
        }

        bytes32 submissionKey = _submissionKey(bountyId, submissionId);
        if (_slugBySubmission[submissionKey] != bytes32(0)) {
            revert SubmissionAlreadyPublished(bountyId, submissionId);
        }

        IHexBountyEscrowRead.Bounty memory bounty = escrow.getBounty(bountyId);
        if (
            bounty.state != IHexBountyEscrowRead.BountyState.Awarded
                || bounty.acceptedSubmissionId != submissionId
        ) revert SubmissionNotAccepted(bountyId, submissionId);

        IHexBountyEscrowRead.Submission memory submission =
            escrow.getSubmission(bountyId, submissionId);
        if (submission.builder != msg.sender) revert Unauthorized(msg.sender);

        _publications[slugHash] = Publication({
            creator: msg.sender,
            playPrice: uint96(playPrice),
            submissionId: submissionId,
            purchaseCount: 0,
            bountyId: bountyId,
            gameContentHash: gameContentHash,
            metadataURI: metadataURI
        });
        _slugBySubmission[submissionKey] = slugHash;

        emit GamePublished(
            slugHash,
            bountyId,
            submissionId,
            msg.sender,
            playPrice,
            gameContentHash,
            metadataURI
        );
    }

    function updatePlayPrice(bytes32 slugHash, uint256 newPrice) external {
        Publication storage publication = _requirePublication(slugHash);
        if (msg.sender != publication.creator) revert Unauthorized(msg.sender);
        if (newPrice == 0) revert EmptyValue();
        if (newPrice > type(uint96).max) revert PriceTooLarge();

        uint256 oldPrice = publication.playPrice;
        publication.playPrice = uint96(newPrice);
        emit PlayPriceUpdated(slugHash, msg.sender, oldPrice, newPrice);
    }

    function purchaseAccess(bytes32 slugHash) external payable {
        Publication storage publication = _requirePublication(slugHash);
        if (hasAccess(slugHash, msg.sender)) {
            revert AccessAlreadyGranted(slugHash, msg.sender);
        }

        uint256 price = publication.playPrice;
        if (msg.value != price) revert IncorrectPayment(price, msg.value);

        uint256 platformFee =
            (price * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorEarnings = price - platformFee;

        _purchasedAccess[slugHash][msg.sender] = true;
        ++publication.purchaseCount;
        pendingWithdrawals[publication.creator] += creatorEarnings;
        pendingWithdrawals[feeRecipient] += platformFee;
        totalPendingWithdrawals += price;

        emit AccessPurchased(
            slugHash,
            msg.sender,
            publication.creator,
            creatorEarnings,
            platformFee
        );
    }

    function withdrawEarnings(address payable recipient) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw(msg.sender);

        pendingWithdrawals[msg.sender] = 0;
        totalPendingWithdrawals -= amount;

        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert NativeTransferFailed(recipient, amount);
        emit EarningsWithdrawn(msg.sender, recipient, amount);
    }

    function hasAccess(bytes32 slugHash, address player)
        public
        view
        returns (bool)
    {
        Publication storage publication = _requirePublication(slugHash);
        return player == publication.creator
            || _purchasedAccess[slugHash][player];
    }

    function getPublication(bytes32 slugHash)
        external
        view
        returns (Publication memory)
    {
        return _requirePublication(slugHash);
    }

    function getSlugForSubmission(uint256 bountyId, uint32 submissionId)
        external
        view
        returns (bytes32)
    {
        return _slugBySubmission[_submissionKey(bountyId, submissionId)];
    }

    function _requirePublication(bytes32 slugHash)
        private
        view
        returns (Publication storage publication)
    {
        publication = _publications[slugHash];
        if (publication.creator == address(0)) {
            revert PublicationNotFound(slugHash);
        }
    }

    function _submissionKey(uint256 bountyId, uint32 submissionId)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(bountyId, submissionId));
    }
}
