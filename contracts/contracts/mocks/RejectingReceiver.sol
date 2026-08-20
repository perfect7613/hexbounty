// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IHexBountyEscrow {
    function createBounty(string calldata metadataURI, uint64 deadline)
        external
        payable
        returns (uint256 bountyId);

    function submitSolution(
        uint256 bountyId,
        bytes32 artifactHash,
        bytes32 evidenceHash,
        string calldata evidenceURI,
        string calldata liveURL
    ) external returns (uint32 submissionId);

    function refundExpiredBounty(uint256 bountyId) external;
}

contract RejectingReceiver {
    receive() external payable {
        revert("native transfer rejected");
    }

    function createBounty(
        IHexBountyEscrow escrow,
        string calldata metadataURI,
        uint64 deadline
    ) external payable returns (uint256) {
        return escrow.createBounty{value: msg.value}(metadataURI, deadline);
    }

    function submitSolution(
        IHexBountyEscrow escrow,
        uint256 bountyId,
        bytes32 artifactHash,
        bytes32 evidenceHash,
        string calldata evidenceURI,
        string calldata liveURL
    ) external returns (uint32) {
        return escrow.submitSolution(
            bountyId,
            artifactHash,
            evidenceHash,
            evidenceURI,
            liveURL
        );
    }

    function refundExpiredBounty(IHexBountyEscrow escrow, uint256 bountyId)
        external
    {
        escrow.refundExpiredBounty(bountyId);
    }
}
