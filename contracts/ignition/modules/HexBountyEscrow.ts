import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("HexBountyEscrowModule", (m) => {
  const feeRecipient = m.getParameter("feeRecipient", m.getAccount(0));
  const escrow = m.contract("HexBountyEscrow", [feeRecipient]);

  return { escrow };
});
