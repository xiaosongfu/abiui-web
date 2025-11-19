<script lang="ts">
  import { onMount } from "svelte";
  import { appKit } from "$lib/appkit";
  import { supportedEvmNetworks } from "$lib/networks";
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

  const API_BASE = "https://abiui-api.xiaosongfu.workers.dev/contract";

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
  let connectModalLoading = $state(false);

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
        (fn) => fn.stateMutability === "view" || fn.stateMutability === "pure",
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
      const found = (response?.data ?? response) as StoredContract | undefined;
      if (!found || Array.isArray(found)) {
        contractError = "未找到该合约，请确认信息是否正确。";
        return;
      }
      contract = found;
      prepareAbi(found.contract_abi);
    } catch (error) {
      console.error(error);
      contractError = error instanceof Error ? error.message : "加载合约失败";
    } finally {
      loadingContract = false;
    }
  }

  function updateChainMismatch() {
    chainMismatch = Boolean(activeChainId) && activeChainId !== targetChainId;
  }

  function updateWalletMismatch() {
    walletMismatch =
      Boolean(walletAddress) &&
      walletAddress.toLowerCase() !== routeWalletAddress.toLowerCase();
  }

  function handleInputChange(methodKey: string, index: number, value: string) {
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
    if (!viemChain) {
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
        chain: viemChain,
        transport: http(),
      });
      const result = await client.readContract({
        abi,
        address: targetAddress,
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
      if (!viemChain) {
        throw new Error("该链暂未支持发送交易");
      }
      const provider = appKit?.getWalletProvider();
      if (!provider) {
        throw new Error("无法获取钱包 Provider");
      }
      const walletClient = createWalletClient({
        chain: viemChain,
        transport: custom(provider as any),
      });
      const args = buildArgs(fn, key);
      const txHash = await walletClient.writeContract({
        chain: viemChain,
        account: walletAddress as `0x${string}`,
        abi,
        address: targetAddress,
        functionName: fn.name!,
        args,
      });
      state.txHash = txHash;
      state.result = undefined;
    } catch (error) {
      console.error(error);
      state.error = error instanceof Error ? error.message : "发送交易失败";
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
    return () => {
      unsubscribeNetwork?.();
    };
  });

  async function openWalletModal() {
    if (!appKit) return;
    connectModalLoading = true;
    try {
      await appKit.open({
        view: walletAddress ? "Account" : "Connect",
      });
    } catch (error) {
      console.error(error);
    } finally {
      connectModalLoading = false;
    }
  }
</script>

<svelte:head>
  <title>{contract?.name ?? "合约名称"} · {targetAddress}</title>
</svelte:head>

<div class="detail-page">
  <header class="detail-hero">
    <div>
      <h1>{contract?.name ?? "合约名称"}</h1>
      <p class="subtitle">
        链：{targetNetwork?.name ?? targetChainId} · 合约地址：{targetAddress}
      </p>
      {#if contract?.created_at}
        <p class="meta">
          保存时间：{formatter.format(new Date(contract.created_at))}
        </p>
      {/if}
    </div>
    <div class="status-tools">
      <button
        class="connect-btn"
        type="button"
        onclick={openWalletModal}
        disabled={connectModalLoading}
      >
        {connectModalLoading
          ? "打开中..."
          : walletAddress
            ? `查看钱包 · ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
            : "连接钱包"}
      </button>
    </div>
  </header>

  {#if chainMismatch}
    <div class="chain-warning">
      <p>
        当前钱包链 ID ({activeChainId ?? "未知"}) 与目标链 ({targetChainId})
        不一致。
      </p>
      <div class="chain-actions">
        <button class="primary" onclick={ensureChain} disabled={switchingChain}>
          {switchingChain
            ? "切换中..."
            : `切换至 ${targetNetwork?.name ?? targetChainId}`}
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
        当前连接钱包 {walletAddress} 与该合约所属钱包 {routeWalletAddress} 不一致。
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
          当前连接钱包 {walletAddress} 与目标钱包 {routeWalletAddress} 不一致，仅可调用读方法。
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
                      <p class="method-title">{method.name}</p>
                      <p class="method-signature">{methodLabel(method)}</p>
                    </div>
                    <button
                      class="ghost"
                      onclick={() => callRead(method)}
                      disabled={methodStates[key].loading}
                    >
                      {methodStates[key].loading ? "调用中..." : "调用"}
                    </button>
                  </div>
                  {#if method.inputs?.length}
                    <div class="inputs">
                      {#each method.inputs as input, index}
                        <label>
                          <span
                            >{input.name ?? `arg${index}`} · {input.type}</span
                          >
                          <input
                            placeholder="输入参数"
                            value={methodStates[key].inputs[index]}
                            oninput={(event) =>
                              handleInputChange(
                                key,
                                index,
                                event.currentTarget.value,
                              )}
                          />
                        </label>
                      {/each}
                    </div>
                  {/if}
                  {#if methodStates[key].error}
                    <p class="notice error">{methodStates[key].error}</p>
                  {/if}
                  {#if methodStates[key].result}
                    <pre class="result">{methodStates[key].result}</pre>
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
                      <p class="method-title">{method.name}</p>
                      <p class="method-signature">{methodLabel(method)}</p>
                    </div>
                    <button
                      class="primary"
                      onclick={() => callWrite(method)}
                      disabled={methodStates[key].loading}
                    >
                      {methodStates[key].loading ? "发送中..." : "发送交易"}
                    </button>
                  </div>
                  {#if method.inputs?.length}
                    <div class="inputs">
                      {#each method.inputs as input, index}
                        <label>
                          <span
                            >{input.name ?? `arg${index}`} · {input.type}</span
                          >
                          <input
                            placeholder="输入参数"
                            value={methodStates[key].inputs[index]}
                            oninput={(event) =>
                              handleInputChange(
                                key,
                                index,
                                event.currentTarget.value,
                              )}
                          />
                        </label>
                      {/each}
                    </div>
                  {/if}
                  {#if methodStates[key].error}
                    <p class="notice error">{methodStates[key].error}</p>
                  {/if}
                  {#if methodStates[key].txHash}
                    <p class="notice success">
                      交易已发送：{methodStates[key].txHash}
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

  .breadcrumb {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.25em;
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .breadcrumb a {
    color: inherit;
    text-decoration: none;
  }

  h1 {
    margin: 0.3rem 0;
    font-size: clamp(2rem, 4vw, 3rem);
  }

  .subtitle {
    margin: 0;
    color: #cbd5f5;
  }

  .meta {
    margin-top: 0.5rem;
    color: #94a3b8;
  }

  .status-tools {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
    min-width: 280px;
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

  @media (max-width: 720px) {
    .detail-page {
      padding: 2rem 1rem 3rem;
    }

    .methods-grid {
      grid-template-columns: 1fr;
    }

    .status-tools {
      width: 100%;
    }
  }
</style>
