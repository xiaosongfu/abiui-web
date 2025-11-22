<script lang="ts">
    import { onMount } from "svelte";
    import { appKit } from "$lib/appkit";
    import { supportedEvmNetworks } from "$lib/networks";
    import { API_BASE } from "$lib/constants";
    import {
        createPublicClient,
        createWalletClient,
        custom,
        http,
        type Abi,
        type AbiFunction,
        type AbiParameter,
        type Chain,
    } from "viem";

    type StoredContract = {
        id?: string;
        name: string;
        chain_id: number;
        contract_address: string;
        contract_abi: string;
        created_at?: string;
        wallet_address?: string;
    };

    type MethodState = {
        inputs: string[];
        loading: boolean;
        error: string;
        result?: string;
        txHash?: string;
    };

    const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

    let { data } = $props();
    const routeWalletAddress = data.walletAddress as `0x${string}`;
    const targetChainId = data.chainId;
    const targetAddress = data.contractAddress as `0x${string}`;
    const targetNetwork = supportedEvmNetworks.find(
        (n) => Number(n.id) === targetChainId,
    );
    const viemChain = targetNetwork as unknown as Chain | undefined;

    let walletAddress = $state("");
    let accountStatus = $state<
        "disconnected" | "connecting" | "connected" | "reconnecting"
    >("disconnected");
    let activeChainId = $state<number | undefined>(undefined);
    let chainMismatch = $state(false);
    let walletMismatch = $state(false);
    let switchingChain = $state(false);
    let switchError = $state("");
    let copyAbiLoading = $state(false);

    // Temporary contract address editing
    let isEditingAddress = $state(false);
    let tempContractAddress = $state(targetAddress);

    // Temporary chain ID editing
    let isEditingChainId = $state(false);
    let tempChainId = $state(targetChainId);

    type ToastMessage = {
        id: number;
        text: string;
        type: "success" | "error" | "info";
    };

    let toastMessages = $state<ToastMessage[]>([]);
    let nextToastId = $state(1);

    let loadingContract = $state(false);
    let contractError = $state("");
    let contract = $state<StoredContract | null>(null);

    let abi = $state<Abi | null>(null);
    let abiError = $state("");
    let readMethods = $state<AbiFunction[]>([]);
    let writeMethods = $state<AbiFunction[]>([]);
    let methodStates = $state<Record<string, MethodState>>({});

    const formatter = new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
    });

    function getMethodKey(fn: AbiFunction) {
        return `${fn.name ?? "fn"}(${fn.inputs?.map((i) => i.type).join(",") ?? ""})`;
    }

    function resetAbiState() {
        abi = null;
        abiError = "";
        readMethods = [];
        writeMethods = [];
        methodStates = {};
    }

    function resolveAbi(payload: unknown): Abi {
        if (Array.isArray(payload)) {
            return payload as Abi;
        }
        if (typeof payload === "string") {
            const trimmed = payload.trim();
            if (!trimmed) {
                throw new Error("ABI 内容为空");
            }
            return resolveAbi(JSON.parse(trimmed));
        }
        if (
            payload &&
            typeof payload === "object" &&
            Array.isArray((payload as { abi?: unknown }).abi)
        ) {
            return resolveAbi((payload as { abi: unknown }).abi);
        }
        throw new Error("ABI 格式必须是数组");
    }

    function prepareAbi(raw: string) {
        resetAbiState();
        try {
            const parsed = resolveAbi(raw);
            abi = parsed;
            const functions = parsed.filter(
                (item) => item.type === "function",
            ) as AbiFunction[];
            readMethods = functions.filter(
                (fn) =>
                    fn.stateMutability === "view" ||
                    fn.stateMutability === "pure",
            );
            writeMethods = functions.filter((fn) => !readMethods.includes(fn));
            [...readMethods, ...writeMethods].forEach((fn) => {
                methodStates[getMethodKey(fn)] = {
                    inputs: fn.inputs?.map(() => "") ?? [],
                    loading: false,
                    error: "",
                };
            });
        } catch (error) {
            console.error(error);
            abiError = error instanceof Error ? error.message : "ABI 解析失败";
        }
    }

    async function fetchContract() {
        loadingContract = true;
        contractError = "";
        contract = null;
        resetAbiState();
        try {
            if (!targetNetwork) {
                throw new Error("当前链尚未在前端支持列表中");
            }
            const res = await fetch(
                `${API_BASE}/${routeWalletAddress}/${targetChainId}/${targetAddress}`,
            );
            if (!res.ok) {
                throw new Error("获取合约数据失败");
            }
            const response = await res.json();
            const found = (response?.data ?? response) as
                | StoredContract
                | undefined;
            if (!found || Array.isArray(found)) {
                contractError = "未找到该合约，请确认信息是否正确。";
                return;
            }
            contract = found;
            prepareAbi(found.contract_abi);
        } catch (error) {
            console.error(error);
            contractError =
                error instanceof Error ? error.message : "加载合约失败";
        } finally {
            loadingContract = false;
        }
    }

    function updateChainMismatch() {
        chainMismatch = Boolean(activeChainId) && activeChainId !== tempChainId;
    }

    function updateWalletMismatch() {
        walletMismatch =
            Boolean(walletAddress) &&
            walletAddress.toLowerCase() !== routeWalletAddress.toLowerCase();
    }

    function handleInputChange(
        methodKey: string,
        index: number,
        value: string,
    ) {
        methodStates[methodKey].inputs[index] = value;
    }

    function parseArgument(raw: string, input: AbiParameter) {
        if (!raw.length) {
            throw new Error(`请输入参数 ${input.name ?? input.type}`);
        }
        if (input.type.includes("[")) {
            return JSON.parse(raw);
        }
        if (input.type.startsWith("uint") || input.type.startsWith("int")) {
            return BigInt(raw);
        }
        if (input.type === "address") {
            const normalized = raw.toLowerCase();
            if (!normalized.startsWith("0x") || normalized.length !== 42) {
                throw new Error("地址格式不正确");
            }
            return normalized;
        }
        if (input.type === "bool") {
            return raw === "true" || raw === "1";
        }
        if (input.type.startsWith("tuple")) {
            return JSON.parse(raw);
        }
        return raw;
    }

    function buildArgs(fn: AbiFunction, key: string) {
        const state = methodStates[key];
        return (fn.inputs ?? []).map((input, index) =>
            parseArgument(state.inputs[index] ?? "", input),
        );
    }

    function formatResult(value: unknown) {
        if (value === undefined) return "无返回值";
        if (typeof value === "string") return value;
        if (typeof value === "bigint") return value.toString();
        return JSON.stringify(value, null, 2);
    }

    async function ensureChain() {
        if (!appKit || !targetNetwork || !chainMismatch) return;
        switchingChain = true;
        switchError = "";
        try {
            await appKit.switchNetwork(targetNetwork);
        } catch (error) {
            console.error(error);
            switchError = error instanceof Error ? error.message : "切换链失败";
        } finally {
            switchingChain = false;
        }
    }

    async function callRead(fn: AbiFunction) {
        const key = getMethodKey(fn);
        const state = methodStates[key];
        if (!abi || !state) return;
        const tempViemChain = supportedEvmNetworks.find(
            (n) => Number(n.id) === tempChainId,
        ) as unknown as Chain | undefined;
        if (!tempViemChain) {
            state.error = "该链暂未支持调用";
            state.loading = false;
            return;
        }
        state.loading = true;
        state.error = "";
        state.result = undefined;
        try {
            const args = buildArgs(fn, key);
            const client = createPublicClient({
                chain: tempViemChain,
                transport: http(),
            });
            const result = await client.readContract({
                abi,
                address: tempContractAddress as `0x${string}`,
                functionName: fn.name!,
                args,
            });
            state.result = formatResult(result);
        } catch (error) {
            console.error(error);
            state.error = error instanceof Error ? error.message : "调用失败";
        } finally {
            state.loading = false;
        }
    }

    async function callWrite(fn: AbiFunction) {
        const key = getMethodKey(fn);
        const state = methodStates[key];
        if (!abi || !state) return;
        state.loading = true;
        state.error = "";
        state.txHash = undefined;
        try {
            if (!walletAddress) {
                throw new Error("请先连接钱包");
            }
            if (walletMismatch) {
                throw new Error("请切换至该合约所属的钱包地址后再操作");
            }
            if (chainMismatch) {
                await ensureChain();
                if (chainMismatch) {
                    throw new Error("请切换至目标链后再操作");
                }
            }
            const tempViemChain = supportedEvmNetworks.find(
                (n) => Number(n.id) === tempChainId,
            ) as unknown as Chain | undefined;
            if (!tempViemChain) {
                throw new Error("该链暂未支持发送交易");
            }
            const provider = appKit?.getWalletProvider();
            if (!provider) {
                throw new Error("无法获取钱包 Provider");
            }
            const walletClient = createWalletClient({
                chain: tempViemChain,
                transport: custom(provider as any),
            });
            const args = buildArgs(fn, key);
            const txHash = await walletClient.writeContract({
                chain: tempViemChain,
                account: walletAddress as `0x${string}`,
                abi,
                address: tempContractAddress as `0x${string}`,
                functionName: fn.name!,
                args,
            });
            state.txHash = txHash;
            state.result = undefined;
        } catch (error) {
            console.error(error);
            state.error =
                error instanceof Error ? error.message : "发送交易失败";
        } finally {
            state.loading = false;
        }
    }

    function methodLabel(fn: AbiFunction) {
        return `${fn.name ?? "function"}(${fn.inputs?.map((i) => i.type).join(", ") ?? ""})`;
    }

    onMount(() => {
        fetchContract();
        if (!appKit) return;
        appKit.subscribeAccount((account) => {
            walletAddress = account.address ?? "";
            accountStatus =
                (account.status as typeof accountStatus) ?? "disconnected";
            updateWalletMismatch();
        });
        const unsubscribeNetwork = appKit.subscribeNetwork?.(({ chainId }) => {
            activeChainId =
                typeof chainId === "number"
                    ? Number(chainId)
                    : Number(chainId ?? 0) || undefined;
            updateChainMismatch();
        });

        const account = appKit.getAccount();
        if (account?.address) {
            walletAddress = account.address;
            updateWalletMismatch();
        }

        return () => {
            unsubscribeNetwork?.();
        };
    });

    async function copyAbiToClipboard() {
        if (!contract || !contract.contract_abi) {
            showToast("ABI 数据不存在", "error");
            return;
        }

        copyAbiLoading = true;

        try {
            await navigator.clipboard.writeText(contract.contract_abi);
            showToast("ABI 已复制到剪切板", "success");
        } catch (error) {
            console.error("复制失败:", error);
            showToast("复制失败，请手动复制", "error");
        } finally {
            copyAbiLoading = false;
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

    async function copyToClipboard(text: string, type: string) {
        try {
            await navigator.clipboard.writeText(text);
            showToast(type === "address" ? "地址已复制" : "已复制", "success");
        } catch (error) {
            console.error("复制失败:", error);
            showToast("复制失败", "error");
        }
    }

    function handleEditAddress() {
        isEditingAddress = true;
    }

    function handleCancelEdit() {
        tempContractAddress = targetAddress;
        isEditingAddress = false;
    }

    function handleSaveAddress() {
        const address = tempContractAddress.trim().toLowerCase();
        if (!address) {
            showToast("请输入合约地址", "error");
            return;
        }
        if (!ADDRESS_REGEX.test(address)) {
            showToast("合约地址格式不正确", "error");
            return;
        }
        isEditingAddress = false;
        showToast("合约地址已更新", "success");
    }

    function handleResetAddress() {
        tempContractAddress = targetAddress;
        isEditingAddress = false;
        showToast("已恢复原始合约地址", "success");
    }

    function handleEditChainId() {
        isEditingChainId = true;
    }

    function handleCancelEditChainId() {
        tempChainId = targetChainId;
        isEditingChainId = false;
    }

    function handleSaveChainId() {
        const chainId = Number(tempChainId);
        if (!chainId || isNaN(chainId)) {
            showToast("请输入有效的链 ID", "error");
            return;
        }
        isEditingChainId = false;
        showToast("链 ID 已更新", "success");
    }

    function handleResetChainId() {
        tempChainId = targetChainId;
        isEditingChainId = false;
        showToast("已恢复原始链 ID", "success");
    }
</script>

<svelte:head>
    <title>{contract?.name ?? "合约名称"} · {targetAddress}</title>
</svelte:head>

<div class="detail-page">
    <header class="detail-hero">
        <div>
            <h1>{contract?.name ?? "合约名称"}</h1>
            <div class="address-row">
                <span class="label">链：</span>
                {#if isEditingChainId}
                    <div class="address-edit-container">
                        <input
                            type="number"
                            class="address-input chain-id-input"
                            bind:value={tempChainId}
                            placeholder="Chain ID"
                            onkeydown={(e) => {
                                if (e.key === "Enter") handleSaveChainId();
                                if (e.key === "Escape")
                                    handleCancelEditChainId();
                            }}
                        />
                        <button
                            type="button"
                            class="edit-btn save"
                            onclick={handleSaveChainId}
                            title="保存"
                        >
                            ✓
                        </button>
                        <button
                            type="button"
                            class="edit-btn cancel"
                            onclick={handleCancelEditChainId}
                            title="取消"
                        >
                            ✕
                        </button>
                    </div>
                {:else}
                    <div class="chain-with-copy">
                        <span class="address-text"
                            >{supportedEvmNetworks.find(
                                (n) => Number(n.id) === tempChainId,
                            )?.name ?? tempChainId}</span
                        >
                    </div>
                    <button
                        type="button"
                        class="edit-btn"
                        onclick={handleEditChainId}
                        title="临时修改链 ID"
                    >
                        ✏️
                    </button>
                    {#if tempChainId !== targetChainId}
                        <button
                            type="button"
                            class="edit-btn reset"
                            onclick={handleResetChainId}
                            title="恢复原始链 ID"
                        >
                            ♻️
                        </button>
                    {/if}
                {/if}
                <span class="divider">·</span>
                <span class="label">合约地址：</span>
                {#if isEditingAddress}
                    <div class="address-edit-container">
                        <input
                            type="text"
                            class="address-input"
                            bind:value={tempContractAddress}
                            placeholder="0x..."
                            spellcheck="false"
                            onkeydown={(e) => {
                                if (e.key === "Enter") handleSaveAddress();
                                if (e.key === "Escape") handleCancelEdit();
                            }}
                        />
                        <button
                            type="button"
                            class="edit-btn save"
                            onclick={handleSaveAddress}
                            title="保存"
                        >
                            ✓
                        </button>
                        <button
                            type="button"
                            class="edit-btn cancel"
                            onclick={handleCancelEdit}
                            title="取消"
                        >
                            ✕
                        </button>
                    </div>
                {:else}
                    <button
                        type="button"
                        class="address-text clickable"
                        onclick={() =>
                            copyToClipboard(tempContractAddress, "address")}
                        title="点击复制合约地址"
                    >
                        {tempContractAddress}
                    </button>
                    <button
                        type="button"
                        class="edit-btn"
                        onclick={handleEditAddress}
                        title="临时修改合约地址"
                    >
                        ✏️
                    </button>
                    {#if tempContractAddress !== targetAddress}
                        <button
                            type="button"
                            class="edit-btn reset"
                            onclick={handleResetAddress}
                            title="恢复原始地址"
                        >
                            ♻️
                        </button>
                    {/if}
                {/if}
                <span class="divider">·</span>
                <button
                    class="copy-btn small"
                    type="button"
                    onclick={copyAbiToClipboard}
                    disabled={copyAbiLoading || !contract?.contract_abi}
                    title="复制 ABI"
                >
                    {copyAbiLoading ? "复制中..." : "📋 复制 ABI"}
                </button>
            </div>
            {#if contract?.created_at}
                <p class="meta">
                    保存时间：{formatter.format(new Date(contract.created_at))}
                </p>
            {/if}
        </div>
        <div class="status-tools"></div>
    </header>

    {#if chainMismatch}
        <div class="chain-warning">
            <p>
                当前钱包链 ID ({activeChainId ?? "未知"}) 与目标链 ({tempChainId})
                不一致。
            </p>
            <div class="chain-actions">
                <button
                    class="primary"
                    onclick={ensureChain}
                    disabled={switchingChain}
                >
                    {switchingChain
                        ? "切换中..."
                        : `切换至 ${supportedEvmNetworks.find((n) => Number(n.id) === tempChainId)?.name ?? tempChainId}`}
                </button>
                {#if switchError}
                    <span class="notice error">{switchError}</span>
                {/if}
            </div>
        </div>
    {/if}

    {#if walletMismatch}
        <div class="wallet-warning">
            <p>
                当前连接钱包 {walletAddress} 与该合约所属钱包 {routeWalletAddress}
                不一致。
            </p>
            <p class="muted">你仍可调用读方法，但写方法需要切换到目标钱包。</p>
        </div>
    {/if}

    <section class="contract-panel">
        {#if loadingContract}
            <p class="muted">加载合约数据中...</p>
        {:else if contractError}
            <p class="notice error">{contractError}</p>
        {:else if !contract}
            <p class="muted">未找到合约数据。</p>
        {:else if abiError}
            <p class="notice error">ABI 错误：{abiError}</p>
        {:else}
            {#if !walletAddress}
                <p class="notice warning">
                    连接钱包后即可发送写方法；读方法可直接调用。
                </p>
            {:else if walletMismatch}
                <p class="notice warning">
                    当前连接钱包 {walletAddress} 与目标钱包 {routeWalletAddress}
                    不一致，仅可调用读方法。
                </p>
            {/if}
            <div class="methods-grid">
                <div class="card">
                    <header>
                        <h2>读方法</h2>
                        <p>不消耗 gas，可直接查询链上数据</p>
                    </header>
                    {#if readMethods.length === 0}
                        <p class="empty">暂无可用的读方法</p>
                    {:else}
                        <ul class="method-list">
                            {#each readMethods as method (getMethodKey(method))}
                                {@const key = getMethodKey(method)}
                                <li>
                                    <div class="method-header">
                                        <div>
                                            <p class="method-title">
                                                {method.name}
                                            </p>
                                            <p class="method-signature">
                                                {methodLabel(method)}
                                            </p>
                                        </div>
                                        <button
                                            class="ghost"
                                            onclick={() => callRead(method)}
                                            disabled={methodStates[key].loading}
                                        >
                                            {methodStates[key].loading
                                                ? "调用中..."
                                                : "调用"}
                                        </button>
                                    </div>
                                    {#if method.inputs?.length}
                                        <div class="inputs">
                                            {#each method.inputs as input, index}
                                                <label>
                                                    <span
                                                        >{input.name ??
                                                            `arg${index}`} · {input.type}</span
                                                    >
                                                    <input
                                                        placeholder="输入参数"
                                                        value={methodStates[key]
                                                            .inputs[index]}
                                                        oninput={(event) =>
                                                            handleInputChange(
                                                                key,
                                                                index,
                                                                event
                                                                    .currentTarget
                                                                    .value,
                                                            )}
                                                    />
                                                </label>
                                            {/each}
                                        </div>
                                    {/if}
                                    {#if methodStates[key].error}
                                        <p class="notice error">
                                            {methodStates[key].error}
                                        </p>
                                    {/if}
                                    {#if methodStates[key].result}
                                        <pre class="result">{methodStates[key]
                                                .result}</pre>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>

                <div class="card">
                    <header>
                        <h2>写方法</h2>
                        <p>需要发送交易，消耗 gas</p>
                    </header>
                    {#if writeMethods.length === 0}
                        <p class="empty">暂无可用的写方法</p>
                    {:else}
                        <ul class="method-list">
                            {#each writeMethods as method (getMethodKey(method))}
                                {@const key = getMethodKey(method)}
                                <li>
                                    <div class="method-header">
                                        <div>
                                            <p class="method-title">
                                                {method.name}
                                            </p>
                                            <p class="method-signature">
                                                {methodLabel(method)}
                                            </p>
                                        </div>
                                        <button
                                            class="primary"
                                            onclick={() => callWrite(method)}
                                            disabled={methodStates[key].loading}
                                        >
                                            {methodStates[key].loading
                                                ? "发送中..."
                                                : "发送交易"}
                                        </button>
                                    </div>
                                    {#if method.inputs?.length}
                                        <div class="inputs">
                                            {#each method.inputs as input, index}
                                                <label>
                                                    <span
                                                        >{input.name ??
                                                            `arg${index}`} · {input.type}</span
                                                    >
                                                    <input
                                                        placeholder="输入参数"
                                                        value={methodStates[key]
                                                            .inputs[index]}
                                                        oninput={(event) =>
                                                            handleInputChange(
                                                                key,
                                                                index,
                                                                event
                                                                    .currentTarget
                                                                    .value,
                                                            )}
                                                    />
                                                </label>
                                            {/each}
                                        </div>
                                    {/if}
                                    {#if methodStates[key].error}
                                        <p class="notice error">
                                            {methodStates[key].error}
                                        </p>
                                    {/if}
                                    {#if methodStates[key].txHash}
                                        <p class="notice success">
                                            交易已发送：{methodStates[key]
                                                .txHash}
                                        </p>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            </div>
        {/if}
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
        background: radial-gradient(circle at top, #050b18, #010409 55%);
        color: #e2e8f0;
    }

    .detail-page {
        min-height: 100vh;
        padding: 3rem clamp(1rem, 4vw, 4rem) 4rem;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        background: radial-gradient(circle at top, #050b18, #010409 55%);
        color: #e2e8f0;
    }

    .detail-hero {
        display: flex;
        justify-content: space-between;
        gap: 2rem;
        flex-wrap: wrap;
    }

    h1 {
        margin: 0.3rem 0;
        font-size: clamp(2rem, 4vw, 3rem);
    }

    .address-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0.5rem 0 0;
        flex-wrap: wrap;
    }

    .label {
        color: #94a3b8;
        font-size: 0.95rem;
        white-space: nowrap;
    }

    .chain-with-copy,
    .address-with-copy {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .chain-with-copy .address-text {
        font-family: "Courier New", monospace;
        font-size: 0.95rem;
        color: #cbd5f5;
        background: rgba(30, 41, 59, 0.4);
        padding: 0.25rem 0.5rem;
        border-radius: 0.35rem;
        border: 1px solid rgba(148, 163, 184, 0.2);
        white-space: nowrap;
    }

    .address-text {
        font-family: "Courier New", monospace;
        font-size: 0.95rem;
        color: #cbd5f5;
        background: rgba(30, 41, 59, 0.4);
        padding: 0.25rem 0.5rem;
        border-radius: 0.35rem;
        border: 1px solid rgba(148, 163, 184, 0.2);
        white-space: nowrap;
    }

    .address-text.clickable {
        cursor: pointer;
        transition: all 0.2s;
        background: transparent;
        border: none;
        padding: 0.25rem 0.5rem;
        font: inherit;
        color: inherit;
    }

    .address-text.clickable:hover {
        background: rgba(16, 185, 129, 0.2);
        border: 1px solid rgba(16, 185, 129, 0.5);
        border-radius: 0.35rem;
        transform: translateY(-1px);
    }

    .address-edit-container {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }

    .address-input {
        font-family: "Courier New", monospace;
        font-size: 0.9rem;
        color: #cbd5f5;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(148, 163, 184, 0.4);
        border-radius: 0.35rem;
        padding: 0.25rem 0.5rem;
        min-width: 340px;
        max-width: 420px;
        transition: all 0.2s;
    }

    .address-input:focus {
        outline: none;
        border-color: rgba(16, 185, 129, 0.6);
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }

    .chain-id-input {
        min-width: 120px !important;
        max-width: 150px !important;
    }

    .edit-btn {
        border: none;
        border-radius: 0.35rem;
        padding: 0.25rem 0.5rem;
        font-size: 0.9rem;
        cursor: pointer;
        transition: all 0.2s;
        background: rgba(30, 41, 59, 0.6);
        color: #e2e8f0;
        border: 1px solid rgba(148, 163, 184, 0.3);
    }

    .edit-btn:hover {
        background: rgba(16, 185, 129, 0.2);
        border-color: rgba(16, 185, 129, 0.5);
        transform: translateY(-1px);
    }

    .edit-btn.save:hover {
        background: rgba(16, 185, 129, 0.3);
        border-color: rgba(16, 185, 129, 0.6);
    }

    .edit-btn.cancel:hover {
        background: rgba(248, 113, 113, 0.2);
        border-color: rgba(248, 113, 113, 0.5);
    }

    .edit-btn.reset:hover {
        background: rgba(250, 204, 21, 0.2);
        border-color: rgba(250, 204, 21, 0.5);
    }

    .divider {
        color: #64748b;
        font-size: 1.2rem;
        margin: 0 0.25rem;
    }

    .copy-btn {
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(30, 41, 59, 0.6);
        color: #e2e8f0;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .copy-btn.small {
        padding: 0.35rem 0.7rem;
        font-size: 0.85rem;
    }

    .copy-btn:hover:not(:disabled) {
        background: rgba(16, 185, 129, 0.2);
        border-color: rgba(16, 185, 129, 0.5);
        transform: translateY(-1px);
    }

    .copy-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .meta {
        margin-top: 0.5rem;
        color: #94a3b8;
    }

    .connect-btn {
        border: none;
        border-radius: 1rem;
        background: linear-gradient(135deg, #3b82f6, #a855f7);
        color: white;
        font-size: 1rem;
        font-weight: 600;
        padding: 0.9rem 1.4rem;
        cursor: pointer;
        transition:
            transform 0.15s ease,
            box-shadow 0.15s ease;
    }

    .connect-btn:disabled {
        opacity: 0.65;
        cursor: progress;
        box-shadow: none;
    }

    .connect-btn:not(:disabled):hover {
        transform: translateY(-1px);
        box-shadow: 0 15px 35px rgba(59, 130, 246, 0.35);
    }

    .chain-warning {
        border-radius: 1rem;
        padding: 1rem 1.25rem;
        background: rgba(250, 204, 21, 0.1);
        border: 1px solid rgba(250, 204, 21, 0.5);
        color: #facc15;
    }

    .wallet-warning {
        border-radius: 1rem;
        padding: 1rem 1.25rem;
        background: rgba(59, 130, 246, 0.12);
        border: 1px solid rgba(59, 130, 246, 0.45);
        color: #bfdbfe;
    }

    .chain-actions {
        margin-top: 0.5rem;
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: center;
    }

    .contract-panel {
        background: rgba(15, 23, 42, 0.85);
        border-radius: 1.5rem;
        padding: 2rem;
        border: 1px solid rgba(148, 163, 184, 0.2);
    }

    .methods-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 1.5rem;
    }

    .card {
        background: rgba(2, 6, 23, 0.5);
        border-radius: 1.25rem;
        padding: 1.5rem;
        border: 1px solid rgba(148, 163, 184, 0.2);
    }

    .card header h2 {
        margin: 0;
    }

    .card header p {
        margin: 0.2rem 0 1rem;
        color: #94a3b8;
    }

    .method-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .method-list li {
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 1rem;
        padding: 1rem;
        background: rgba(15, 23, 42, 0.5);
    }

    .method-header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
        align-items: center;
    }

    .method-title {
        margin: 0;
        font-weight: 600;
    }

    .method-signature {
        margin: 0.2rem 0 0;
        color: #94a3b8;
        font-size: 0.85rem;
    }

    .inputs {
        margin-top: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        font-size: 0.85rem;
    }

    input {
        border-radius: 0.8rem;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.6);
        color: #f8fafc;
        padding: 0.7rem 0.9rem;
    }

    pre.result {
        margin: 0.8rem 0 0;
        padding: 0.9rem;
        border-radius: 0.8rem;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(148, 163, 184, 0.2);
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 0.85rem;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .primary,
    .ghost {
        border-radius: 999px;
        padding: 0.65rem 1.2rem;
        border: none;
        cursor: pointer;
        font-weight: 600;
    }

    .primary {
        background: linear-gradient(135deg, #3b82f6, #a855f7);
        color: white;
    }

    .primary:disabled {
        opacity: 0.6;
        cursor: progress;
    }

    .ghost {
        background: transparent;
        border: 1px solid rgba(148, 163, 184, 0.4);
        color: #cbd5f5;
    }

    .notice {
        margin: 0.8rem 0 0;
        padding: 0.7rem 1rem;
        border-radius: 0.8rem;
        font-size: 0.9rem;
    }

    .notice.error {
        background: rgba(248, 113, 113, 0.12);
        border: 1px solid rgba(248, 113, 113, 0.4);
        color: #fecaca;
    }

    .notice.warning {
        background: rgba(250, 204, 21, 0.12);
        border: 1px solid rgba(250, 204, 21, 0.4);
        color: #facc15;
    }

    .contract-panel > .notice.warning {
        margin-bottom: 1.25rem;
    }

    .notice.success {
        background: rgba(16, 185, 129, 0.12);
        border: 1px solid rgba(16, 185, 129, 0.4);
        color: #a7f3d0;
    }

    .muted {
        color: #94a3b8;
    }

    .empty {
        margin: 2rem 0;
        text-align: center;
        color: #94a3b8;
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

    @media (max-width: 720px) {
        .detail-page {
            padding: 2rem 1rem 3rem;
        }

        .methods-grid {
            grid-template-columns: 1fr;
        }

        .toast-container {
            bottom: 1rem;
            right: 1rem;
            left: 1rem;
            max-width: none;
        }
    }
</style>
