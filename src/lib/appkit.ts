// lib/appkit.ts
import { browser } from "$app/environment";
import { createAppKit } from "@reown/appkit";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia, mainnet } from "@reown/appkit/networks";

// Only initialize in browser environment
let appKit: ReturnType<typeof createAppKit> | undefined = undefined;

if (browser) {
  const projectId = "e088e315502c9545cc27b9ff89822516"; //import.meta.env.VITE_PROJECT_ID
  if (!projectId) {
    throw new Error("VITE_PROJECT_ID is not set");
  }

  const networks = [sepolia, mainnet];

  // Create adapter
  const wagmiAdapter = new WagmiAdapter({
    networks,
    projectId,
  });

  // Initialize AppKit
  appKit = createAppKit({
    adapters: [wagmiAdapter],
    networks: [sepolia, mainnet],
    defaultNetwork: sepolia,
    projectId,
    metadata: {
      name: "abiui",
      description: "abiui web",
      url: "https://abiui.numalabs.dev",
      icons: ["https://avatars.githubusercontent.com/u/179229932?s=200&v=4"],
    },
  });
}

export { appKit };
