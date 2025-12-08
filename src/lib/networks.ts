import type { AppKitNetwork } from "@reown/appkit-common";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  celo,
  celoAlfajores,
  fantom,
  fantomTestnet,
  gnosis,
  linea,
  lineaSepolia,
  mainnet,
  mantle,
  mantleSepoliaTestnet,
  moonbeam,
  moonbaseAlpha,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  scroll,
  scrollSepolia,
  sepolia,
  zora,
  zoraSepolia,
} from "@reown/appkit/networks";

// Chain ID to logo URL mapping
export const chainLogos: Record<number, string> = {
  1: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg", // Ethereum Mainnet
  11155111: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg", // Sepolia
  42161: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg", // Arbitrum
  421614: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg", // Arbitrum Sepolia
  8453: "https://icons.llamao.fi/icons/chains/rsz_base.jpg", // Base
  84532: "https://icons.llamao.fi/icons/chains/rsz_base.jpg", // Base Sepolia
  10: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg", // Optimism
  11155420: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg", // Optimism Sepolia
  137: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg", // Polygon
  80002: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg", // Polygon Amoy
  56: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg", // BSC
  97: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg", // BSC Testnet
  43114: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg", // Avalanche
  43113: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg", // Avalanche Fuji
  250: "https://icons.llamao.fi/icons/chains/rsz_fantom.jpg", // Fantom
  4002: "https://icons.llamao.fi/icons/chains/rsz_fantom.jpg", // Fantom Testnet
  100: "https://icons.llamao.fi/icons/chains/rsz_gnosis.jpg", // Gnosis
  42220: "https://icons.llamao.fi/icons/chains/rsz_celo.jpg", // Celo
  44787: "https://icons.llamao.fi/icons/chains/rsz_celo.jpg", // Celo Alfajores
  1284: "https://icons.llamao.fi/icons/chains/rsz_moonbeam.jpg", // Moonbeam
  1287: "https://icons.llamao.fi/icons/chains/rsz_moonbeam.jpg", // Moonbase Alpha
  59144: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg", // Linea
  59141: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg", // Linea Sepolia
  5000: "https://icons.llamao.fi/icons/chains/rsz_mantle.jpg", // Mantle
  5003: "https://icons.llamao.fi/icons/chains/rsz_mantle.jpg", // Mantle Sepolia
  534352: "https://icons.llamao.fi/icons/chains/rsz_scroll.jpg", // Scroll
  534351: "https://icons.llamao.fi/icons/chains/rsz_scroll.jpg", // Scroll Sepolia
  7777777: "https://icons.llamao.fi/icons/chains/rsz_zora.jpg", // Zora
  999999999: "https://icons.llamao.fi/icons/chains/rsz_zora.jpg", // Zora Sepolia
};

export const supportedEvmNetworks: [AppKitNetwork, ...AppKitNetwork[]] = [
  mainnet,
  sepolia,
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  bsc,
  bscTestnet,
  avalanche,
  avalancheFuji,
  fantom,
  fantomTestnet,
  gnosis,
  celo,
  celoAlfajores,
  moonbeam,
  moonbaseAlpha,
  linea,
  lineaSepolia,
  mantle,
  mantleSepoliaTestnet,
  scroll,
  scrollSepolia,
  zora,
  zoraSepolia,
];

export const defaultNetwork = mainnet;
