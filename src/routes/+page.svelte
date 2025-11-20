<script lang="ts">
    import { browser } from "$app/environment";
    import { onMount } from "svelte";
    import { appKit } from "$lib/appkit";
    import { defaultNetwork, supportedEvmNetworks } from "$lib/networks";
    import { API_BASE } from "$lib/constants";

    type StoredContract = {
        name: string;
        chain_id: number;
        contract_address: string;
        contract_abi: string;
        created_at?: string;
        id?: string;
    };

    const chainOptions = supportedEvmNetworks.map((network) => ({
        id: Number(network.id),
        label: network.name ?? `Chain ${network.id}`,
        badge: network.testnet ? "Testnet" : "Mainnet",
        symbol: network.nativeCurrency?.symbol ?? "",
    }));
    const abiPlaceholder = '[{"type":"function","name":"transfer"}]';

    const chainLabel = new Map(chainOptions.map((c) => [c.id, c.label]));

    let walletAddress = $state("");
    let contracts = $state<StoredContract[]>([]);
    let contractsLoading = $state(false);
    let contractsError = $state("");
    let submitLoading = $state(false);
    let submitError = $state("");
    let hasMoreContracts = $state(false);

    type ToastMessage = {
        id: number;
        text: string;
        type: "success" | "error" | "info";
    };

    let toastMessages = $state<ToastMessage[]>([]);
    let nextToastId = $state(1);

    let form = $state({
        name: "",
        chainId: defaultNetwork.id,
        contractAddress: "",
        contractAbi: "",
    });

    async function fetchContracts(address: string) {
        contractsLoading = true;
        contractsError = "";
        hasMoreContracts = false;
        try {
            const res = await fetch(`${API_BASE}/${address}?limit=6`);
            if (!res.ok) {
                throw new Error("无法获取合约列表");
            }
            const data = await res.json();
            const result = data.data ?? [];
            if (result.length > 5) {
                hasMoreContracts = true;
                contracts = result.slice(0, 5);
            } else {
                contracts = result;

                //
                hasMoreContracts = true;
            }
        } catch (error) {
            console.error(error);
            contractsError =
                error instanceof Error ? error.message : "获取合约列表失败";
        } finally {
            contractsLoading = false;
        }
    }

    function parseAbi(raw: string) {
        if (!raw.trim()) {
            throw new Error("合约 ABI 不能为空");
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            throw new Error("ABI 必须是 JSON 数组");
        }
        return parsed;
    }

    async function handleSubmit(event: SubmitEvent) {
        event.preventDefault();
        submitError = "";
        if (!walletAddress) {
            return;
        }
        try {
            const abi = parseAbi(form.contractAbi);
            submitLoading = true;
            const payload = {
                wallet_address: walletAddress,
                name: form.name.trim(),
                chain_id: Number(form.chainId),
                contract_address: form.contractAddress.trim(),
                contract_abi: JSON.stringify(abi),
            };
            if (!payload.name || !payload.contract_address) {
                throw new Error("请完整填写表单");
            }
            const res = await fetch(API_BASE, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const message = await res.text();
                throw new Error(message || "保存失败");
            }
            showToast("合约已保存", "success");
            form = {
                name: "",
                chainId: form.chainId,
                contractAddress: "",
                contractAbi: "",
            };
            await fetchContracts(walletAddress);
        } catch (error) {
            console.error(error);
            submitError = error instanceof Error ? error.message : "提交失败";
        } finally {
            submitLoading = false;
        }
    }

    function showToast(
        text: string,
        type: "success" | "error" | "info" = "success",
    ) {
        const id = nextToastId++;
        const message: ToastMessage = { id, text, type };
        toastMessages = [...toastMessages, message];
        setTimeout(() => {
            removeToast(id);
        }, 3000);
    }

    function removeToast(id: number) {
        toastMessages = toastMessages.filter((msg) => msg.id !== id);
    }

    function shorten(address: string) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
    <title>ABIUI · EVM 合约控制台</title>
    <meta
        name="description"
        content="上传 EVM 合约 ABI，连接钱包后即可管理并调用任意合约方法。"
    />
</svelte:head>

<div class="page">
    <section class="hero">
        <div class="hero__content">
            <p class="eyebrow">ABIUI</p>
            <h1>连接钱包，管理你的 EVM 合约</h1>
            <p class="subheading">
                上传并保存任意合约
                ABI，随时查看方法列表并发起调用。支持多链网络，
                用最简单的方式掌握复杂合约。
            </p>
        </div>
        <div class="hero__card">
            <div class="hero__glow" aria-hidden="true"></div>
            <p>支持的链</p>
            <div class="chip-grid">
                {#each chainOptions.slice(0, 12) as chain}
                    <span class="chip">{chain.label}</span>
                {/each}
                {#if chainOptions.length > 12}
                    <span class="chip muted"
                        >+ {chainOptions.length - 12} more</span
                    >
                {/if}
            </div>
        </div>
    </section>

    <section class="grid">
        <form class="card form" onsubmit={handleSubmit}>
            <header>
                <div>
                    <h2>保存合约</h2>
                    <p>填写合约信息并上传 ABI</p>
                </div>
            </header>

            <label>
                <span>合约名称</span>
                <input
                    name="name"
                    placeholder="例如：MyToken"
                    bind:value={form.name}
                    required
                />
            </label>

            <label>
                <span>所属链</span>
                <select name="chain" bind:value={form.chainId}>
                    {#each chainOptions as chain}
                        <option value={chain.id}>
                            {chain.label} · {chain.badge}
                        </option>
                    {/each}
                </select>
            </label>

            <label>
                <span>合约地址</span>
                <input
                    name="address"
                    placeholder="0x..."
                    bind:value={form.contractAddress}
                    required
                />
            </label>

            <label>
                <span>合约 ABI</span>
                <textarea
                    name="abi"
                    rows="6"
                    placeholder={abiPlaceholder}
                    bind:value={form.contractAbi}
                    required
                ></textarea>
            </label>

            {#if submitError}
                <p class="notice error">{submitError}</p>
            {/if}

            <button
                class="primary"
                type="submit"
                disabled={submitLoading || !walletAddress}
            >
                {submitLoading ? "保存中..." : "保存合约"}
            </button>
        </form>

        <section class="card list">
            <header>
                <div>
                    <h2>我的合约</h2>
                    <p>自动读取当前钱包地址的数据</p>
                </div>
                <button
                    class="ghost"
                    type="button"
                    disabled={contractsLoading}
                    onclick={() =>
                        walletAddress && fetchContracts(walletAddress)}
                >
                    {contractsLoading ? "刷新中" : "刷新"}
                </button>
            </header>

            {#if !walletAddress}
                <p class="muted empty">连接钱包后即可查看已保存的合约。</p>
            {:else if contractsLoading}
                <p class="muted empty">加载中...</p>
            {:else if contractsError}
                <p class="notice error">{contractsError}</p>
            {:else if contracts.length === 0}
                <p class="muted empty">暂时没有数据，先添加一个合约吧。</p>
            {:else}
                <ul>
                    {#each contracts as contract (contract.id ?? `${contract.chain_id}-${contract.contract_address}`)}
                        <li>
                            <a
                                class="item-link"
                                data-sveltekit-preload
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
                {#if hasMoreContracts}
                    <div class="list-footer">
                        <a class="ghost" href={`/contracts`}> 查看全部 </a>
                    </div>
                {/if}
            {/if}
        </section>
    </section>

    <div class="toast-container">
        {#each toastMessages as message (message.id)}
            <div class="toast toast-{message.type}">
                {message.text}
            </div>
        {/each}
    </div>
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
        gap: 3rem;
    }

    .hero {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 2rem;
        align-items: center;
    }

    .hero__content h1 {
        font-size: clamp(2.4rem, 4vw, 3.6rem);
        margin: 0.4rem 0 1rem;
    }

    .eyebrow {
        letter-spacing: 0.3em;
        font-size: 0.8rem;
        text-transform: uppercase;
        color: #94a3b8;
    }

    .subheading {
        color: #cbd5f5;
        margin-top: 0;
    }

    .hero__actions {
        margin-top: 1.75rem;
        display: flex;
        gap: 1rem;
        align-items: center;
        flex-wrap: wrap;
    }

    .hero__card {
        position: relative;
        border-radius: 1.5rem;
        padding: 1.5rem;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(148, 163, 184, 0.2);
        min-height: 220px;
    }

    .hero__glow {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(
            circle at 30% 30%,
            rgba(59, 130, 246, 0.4),
            transparent 65%
        );
        pointer-events: none;
        z-index: 0;
    }

    .hero__card > * {
        position: relative;
        z-index: 1;
    }

    .chip-grid {
        margin-top: 1rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
    }

    .chip {
        padding: 0.35rem 0.9rem;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        font-size: 0.85rem;
        color: #cbd5f5;
    }

    .chip.muted {
        border-style: dashed;
        color: #94a3b8;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 2rem;
    }

    .card {
        background: rgba(15, 23, 42, 0.85);
        border-radius: 1.5rem;
        padding: 2rem;
        border: 1px solid rgba(148, 163, 184, 0.2);
        box-shadow: 0 30px 80px rgba(15, 23, 42, 0.5);
    }

    .card header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1.5rem;
    }

    .card header h2 {
        margin: 0;
    }

    .card header p {
        margin: 0.2rem 0 0;
        color: #94a3b8;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        font-size: 0.9rem;
        color: #cbd5f5;
    }

    label + label {
        margin-top: 1.2rem;
    }

    input,
    select,
    textarea {
        border-radius: 0.9rem;
        border: 1px solid rgba(148, 163, 184, 0.3);
        padding: 0.85rem 1rem;
        background: rgba(15, 23, 42, 0.6);
        color: #f1f5f9;
        font-size: 1rem;
    }

    textarea {
        font-family:
            "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    }

    button {
        cursor: pointer;
        border: none;
    }

    .primary {
        margin-top: 1.5rem;
        width: 100%;
        padding: 0.95rem 1rem;
        border-radius: 1rem;
        background: linear-gradient(135deg, #3b82f6, #a855f7);
        color: white;
        font-size: 1rem;
        font-weight: 600;
    }

    .primary:disabled {
        opacity: 0.6;
        cursor: progress;
    }

    .ghost {
        padding: 0.6rem 1rem;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.4);
        background: transparent;
        color: #e2e8f0;
    }

    .badge {
        padding: 0.25rem 0.75rem;
        border-radius: 999px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: rgba(34, 197, 94, 0.15);
        color: #86efac;
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

    .notice {
        margin: 0.4rem 0 0;
        padding: 0.75rem 1rem;
        border-radius: 0.9rem;
        font-size: 0.9rem;
    }

    .notice.error {
        background: rgba(248, 113, 113, 0.15);
        color: #fecaca;
        border: 1px solid rgba(239, 68, 68, 0.4);
    }

    .notice.success {
        background: rgba(34, 197, 94, 0.15);
        color: #bbf7d0;
        border: 1px solid rgba(34, 197, 94, 0.4);
    }

    .muted {
        color: #94a3b8;
    }

    .empty {
        margin: 4rem 0;
        text-align: center;
    }

    .list-footer {
        margin-top: 1.5rem;
        text-align: center;
    }

    .toast-container {
        position: fixed;
        bottom: 2rem;
        right: 2rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        z-index: 1000;
        pointer-events: none;
    }

    .toast {
        padding: 1rem 1.25rem;
        border-radius: 0.75rem;
        border: 1px solid;
        font-size: 0.95rem;
        font-weight: 500;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        pointer-events: auto;
        animation: slideIn 0.3s ease-out;
        max-width: 400px;
        word-wrap: break-word;
    }

    .toast-success {
        background: rgba(16, 185, 129, 0.15);
        border-color: rgba(16, 185, 129, 0.4);
        color: #6ee7b7;
    }

    .toast-error {
        background: rgba(248, 113, 113, 0.15);
        border-color: rgba(248, 113, 113, 0.4);
        color: #fca5a5;
    }

    .toast-info {
        background: rgba(59, 130, 246, 0.15);
        border-color: rgba(59, 130, 246, 0.4);
        color: #93c5fd;
    }

    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @media (max-width: 640px) {
        .page {
            padding: 2rem 1rem 4rem;
        }

        .card {
            padding: 1.5rem;
        }

        li {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
        }

        .toast-container {
            bottom: 1rem;
            right: 1rem;
            left: 1rem;
            max-width: none;
        }
    }
</style>
