<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { supportedEvmNetworks } from "$lib/networks";

  type StoredContract = {
    name: string;
    chain_id: number;
    contract_address: string;
    contract_abi: string;
    created_at?: string;
    id?: string;
  };

  const API_BASE = "https://abiui-api.xiaosongfu.workers.dev/contract";
  const walletAddress = $page.params.wallet_address;

  const chainOptions = supportedEvmNetworks.map((network) => ({
    id: Number(network.id),
    label: network.name ?? `Chain ${network.id}`,
  }));
  const chainLabel = new Map(chainOptions.map((c) => [c.id, c.label]));

  let contracts: StoredContract[] = [];
  let contractsLoading = false;
  let contractsError = "";

  async function fetchContracts(address: string) {
    contractsLoading = true;
    contractsError = "";
    try {
      const res = await fetch(`${API_BASE}/${address}`);
      if (!res.ok) {
        throw new Error("无法获取合约列表");
      }
      const data = await res.json();
      contracts = data.data ?? [];
    } catch (error) {
      console.error(error);
      contractsError =
        error instanceof Error ? error.message : "获取合约列表失败";
    } finally {
      contractsLoading = false;
    }
  }

  function getAbiLength(contract: StoredContract) {
    try {
      const abi = JSON.parse(contract.contract_abi);
      return Array.isArray(abi) ? abi.length : 0;
    } catch {
      return 0;
    }
  }

  function shorten(address: string) {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  onMount(() => {
    if (walletAddress) {
      fetchContracts(walletAddress);
    }
  });
</script>

<svelte:head>
  <title>我的合约 · {shorten(walletAddress)}</title>
</svelte:head>

<div class="page">
  <header class="page-header">
    <div>
      <a href="/" class="breadcrumb">← 返回首页</a>
      <h1>我的合约</h1>
      <p class="subtitle">
        正在显示钱包地址 {shorten(walletAddress)} 下保存的所有合约
      </p>
    </div>
  </header>

  <section class="card list">
    {#if contractsLoading}
      <p class="muted empty">加载中...</p>
    {:else if contractsError}
      <p class="notice error">{contractsError}</p>
    {:else if contracts.length === 0}
      <p class="muted empty">该钱包地址下没有保存任何合约。</p>
    {:else}
      <ul>
        {#each contracts as contract (contract.id ?? `${contract.chain_id}-${contract.contract_address}`)}
          <li>
            <a
              class="item-link"
              href={`/${walletAddress}/${contract.chain_id}/${contract.contract_address}`}
              target="_blank"
            >
              <div>
                <p class="item-title">{contract.name}</p>
                <p class="item-secondary">
                  {chainLabel.get(Number(contract.chain_id)) ??
                    `Chain ${contract.chain_id}`}
                  · {contract.contract_address}
                </p>
              </div>
              <span class="badge small">
                ABI {getAbiLength(contract)}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family:
      "Inter",
      "SF Pro Display",
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    background: radial-gradient(circle at top, #101828, #030712 40%);
    color: #f8fafc;
  }

  .page {
    min-height: 100vh;
    padding: 4rem clamp(1rem, 4vw, 4rem) 6rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
    max-width: 800px;
    margin: 0 auto;
  }

  .page-header h1 {
    font-size: clamp(2rem, 4vw, 2.8rem);
    margin: 0.4rem 0 1rem;
  }

  .breadcrumb {
    letter-spacing: 0.1em;
    font-size: 0.8rem;
    text-transform: uppercase;
    color: #94a3b8;
    text-decoration: none;
  }

  .subtitle {
    color: #cbd5f5;
    margin-top: 0;
  }

  .card {
    background: rgba(15, 23, 42, 0.85);
    border-radius: 1.5rem;
    padding: 2rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    box-shadow: 0 30px 80px rgba(15, 23, 42, 0.5);
  }

  .badge {
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .badge.small {
    background: rgba(148, 163, 184, 0.2);
    color: #cbd5f5;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  li {
    padding: 0;
    border-radius: 1rem;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.15);
  }

  .item-link {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.2rem;
    color: inherit;
    text-decoration: none;
  }

  .item-link:hover {
    background: rgba(59, 130, 246, 0.08);
    border-radius: inherit;
  }

  .item-title {
    margin: 0;
    font-weight: 600;
  }

  .item-secondary {
    margin: 0.2rem 0 0;
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .notice.error {
    background: rgba(248, 113, 113, 0.15);
    color: #fecaca;
    border: 1px solid rgba(239, 68, 68, 0.4);
    padding: 0.75rem 1rem;
    border-radius: 0.9rem;
    font-size: 0.9rem;
  }

  .muted {
    color: #94a3b8;
  }

  .empty {
    margin: 4rem 0;
    text-align: center;
  }
</style>
