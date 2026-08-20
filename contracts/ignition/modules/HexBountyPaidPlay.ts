import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("HexBountyPaidPlayModule", (m) => {
  const escrow = m.getParameter("escrow");
  const feeRecipient = m.getParameter("feeRecipient", m.getAccount(0));
  const paidPlay = m.contract("HexBountyPaidPlay", [escrow, feeRecipient]);

  return { paidPlay };
});
