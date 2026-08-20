// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IHexBountyPaidPlayWithdraw {
    function withdrawEarnings(address payable recipient) external;
}

contract RejectingPaidPlayReceiver {
    receive() external payable {
        revert("native transfer rejected");
    }
}

contract ReenteringPaidPlayReceiver {
    IHexBountyPaidPlayWithdraw public registry;
    uint256 public received;
    bool public reentryRejected;

    function withdraw(IHexBountyPaidPlayWithdraw registry_) external {
        registry = registry_;
        registry_.withdrawEarnings(payable(address(this)));
    }

    receive() external payable {
        received += msg.value;
        (bool success,) = address(registry).call(
            abi.encodeCall(
                IHexBountyPaidPlayWithdraw.withdrawEarnings,
                (payable(address(this)))
            )
        );
        reentryRejected = !success;
    }
}
