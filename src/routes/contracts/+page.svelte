<script lang="ts">
    import { onMount } from "svelte";
    import { browser } from "$app/environment";
    import { appKit } from "$lib/appkit";
    import { supportedEvmNetworks } from "$lib/networks";
    import { API_BASE } from "$lib/constants";

    type StoredContract = {
        name: string;
        chain_id: number;
        contract_address: string;
        contract_abi: string;
        created_at?: string;
        id?: string;
    };

    let walletAddress = $state("");

    const chainOptions = supportedEvmNetworks.map((network) => ({
        id: Number(network.id),
        label: network.name ?? `Chain ${network.id}`,
    }));
    const chainLabel = new Map(chainOptions.map((c) => [c.id, c.label]));

    let contracts = $state<StoredContract[]>([]);
    let contractsLoading = $state(false);
    let contractsError = $state("");
    let searchQuery = $state("");

    let filteredContracts = $derived(
        searchQuery.trim()
            ? contracts.filter((contract) =>
                  contract.name
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase()),
              )
            : contracts,
    );

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

    onMount(() => {
        if (!browser || !appKit) return;
        appKit.subscribeAccount((account) => {
            walletAddress = account.address ?? "";
            if (walletAddress) {
                fetchContracts(walletAddress);
            } else {
                contracts = [];
            }
        });

        const account = appKit.getAccount();
        if (account?.address) {
            walletAddress = account.address;
            fetchContracts(walletAddress);
        }
    });
</script>

<svelte:head>
    <title>我的合约</title>
</svelte:head>

<div class="page">
    <section class="card list">
        {#if !walletAddress}
            <div class="empty-state">
                <p class="muted">连接钱包后即可查看已保存的合约。</p>
            </div>
        {:else if contractsLoading}
            <p class="muted empty">加载中...</p>
        {:else if contractsError}
            <p class="notice error">{contractsError}</p>
        {:else}
            <div class="search-container">
                <input
                    type="text"
                    placeholder="搜索合约名称..."
                    bind:value={searchQuery}
                    class="search-input"
                />
            </div>

            {#if filteredContracts.length === 0}
                {#if searchQuery.trim()}
                    <p class="muted empty">没有找到匹配的合约。</p>
                {:else}
                    <p class="muted empty">该钱包地址下没有保存任何合约。</p>
                {/if}
            {:else}
                <p class="result-count">
                    {searchQuery.trim()
                        ? `找到 ${filteredContracts.length} 个匹配的合约`
                        : `共 ${contracts.length} 个合约`}
                </p>
                <ul>
                    {#each filteredContracts as contract (contract.id ?? `${contract.chain_id}-${contract.contract_address}`)}
                        <li>
                            <a
                                class="item-link"
                                href={`/${walletAddress}/${contract.chain_id}/${contract.contract_address}`}
                                target="_blank"
                            >
                                <div>
                                    <p class="item-title">{contract.name}</p>
                                    <p class="item-secondary">
                                        {chainLabel.get(
                                            Number(contract.chain_id),
                                        ) ?? `Chain ${contract.chain_id}`}
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
        background: radial-gradient(circle at top, #050b18, #010409 55%);
        color: #e2e8f0;
    }

    .page {
        min-height: 100vh;
        padding: 3rem clamp(1rem, 4vw, 4rem) 4rem;
        display: flex;
        flex-direction: column;
        gap: 2rem;
        background: radial-gradient(circle at top, #050b18, #010409 55%);
        color: #e2e8f0;
    }

    .card {
        background: rgba(15, 23, 42, 0.5);
        border-radius: 1.5rem;
        padding: 2rem;
        border: 1px solid rgba(148, 163, 184, 0.1);
        box-shadow: 0 30px 80px rgba(15, 23, 42, 0.3);
        backdrop-filter: blur(10px);
    }

    .badge {
        padding: 0.25rem 0.75rem;
        border-radius: 999px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .badge.small {
        background: rgba(148, 163, 184, 0.15);
        color: #94a3b8;
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
        background: rgba(15, 23, 42, 0.3);
        border: 1px solid rgba(148, 163, 184, 0.08);
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
        background: rgba(59, 130, 246, 0.12);
        border-radius: inherit;
    }

    .item-title {
        margin: 0;
        font-weight: 600;
        color: #e2e8f0;
    }

    .item-secondary {
        margin: 0.2rem 0 0;
        color: #64748b;
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

    .empty-state {
        margin: 4rem 0;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        align-items: center;
    }

    .search-container {
        width: 97%;
        margin-bottom: 1.5rem;
    }

    .search-input {
        width: 100%;
        padding: 0.9rem 1.2rem;
        border-radius: 0.9rem;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.6);
        color: #f8fafc;
        font-size: 1rem;
        transition: all 0.2s;
    }

    .search-input:focus {
        outline: none;
        border-color: rgba(59, 130, 246, 0.5);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .search-input::placeholder {
        color: #64748b;
    }

    .result-count {
        margin: 0 0 1rem 0;
        color: #94a3b8;
        font-size: 0.9rem;
    }
</style>
