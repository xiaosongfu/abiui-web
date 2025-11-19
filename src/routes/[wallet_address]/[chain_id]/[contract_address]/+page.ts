import { error } from "@sveltejs/kit";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export const load = ({ params }) => {
  const walletAddress = params.wallet_address?.toLowerCase();
  if (!walletAddress || !ADDRESS_REGEX.test(walletAddress)) {
    throw error(404, "钱包地址无效");
  }

  const chainId = Number(params.chain_id);
  if (!Number.isFinite(chainId)) {
    throw error(404, "链 ID 无效");
  }

  const contractAddress = params.contract_address?.toLowerCase();
  if (!contractAddress || !ADDRESS_REGEX.test(contractAddress)) {
    throw error(404, "合约地址无效");
  }

  return {
    walletAddress,
    chainId,
    contractAddress,
  };
};

