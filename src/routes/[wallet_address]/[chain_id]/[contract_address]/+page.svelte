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
        toFunctionSelector,
        decodeErrorResult,
        decodeEventLog,
        decodeFunctionData,
        decodeFunctionResult,
        parseEther,
        type Abi,
        type AbiEvent,
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
        value?: string; // ETH value for payable methods
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

    // Decoder states
    let errorDecodeInput = $state("");
    let errorDecodeResult = $state("");
    let errorDecodeError = $state("");
    let errorDecodeLoading = $state(false);

    let eventDecodeData = $state("");
    let eventDecodeTopic0 = $state("");
    let eventDecodeTopic1 = $state("");
    let eventDecodeTopic2 = $state("");
    let eventDecodeTopic3 = $state("");
    let eventDecodeResult = $state("");
    let eventDecodeError = $state("");
    let eventDecodeLoading = $state(false);

    let calldataDecodeInput = $state("");
    let calldataDecodeResult = $state("");
    let calldataDecodeError = $state("");
    let calldataDecodeLoading = $state(false);

    let returnDecodeInput = $state("");
    let returnDecodeFunctionSelector = $state("");
    let returnDecodeResult = $state("");
    let returnDecodeError = $state("");
    let returnDecodeLoading = $state(false);

    // Extract ABI items by type
    type AbiErrorItem = Extract<Abi[number], { type: "error" }>;
    let abiErrors = $derived<AbiErrorItem[]>(
        (abi?.filter((item) => item.type === "error") as AbiErrorItem[]) ?? [],
    );
    let abiEvents = $derived<AbiEvent[]>(
        (abi?.filter((item) => item.type === "event") as AbiEvent[]) ?? [],
    );
    let abiFunctions = $derived<AbiFunction[]>(
        (abi?.filter((item) => item.type === "function") as AbiFunction[]) ??
            [],
    );
    let abiFunctionsWithOutputs = $derived<AbiFunction[]>(
        abiFunctions.filter((fn) => fn.outputs && fn.outputs.length > 0),
    );

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
            writeMethods = functions.filter(
                (fn) =>
                    fn.stateMutability === "nonpayable" ||
                    fn.stateMutability === "payable",
            );
            [...readMethods, ...writeMethods].forEach((fn) => {
                methodStates[getMethodKey(fn)] = {
                    inputs: fn.inputs?.map(() => "") ?? [],
                    loading: false,
                    error: "",
                    value: fn.stateMutability === "payable" ? "" : undefined,
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
        return JSON.stringify(
            value,
            (key, val) => (typeof val === "bigint" ? val.toString() : val),
            2,
        );
    }

    async function ensureChain() {
        if (!appKit || !chainMismatch) return;
        const tempNetwork = supportedEvmNetworks.find(
            (n) => Number(n.id) === tempChainId,
        );
        if (!tempNetwork) {
            switchError = "目标链不在支持列表中";
            return;
        }
        switchingChain = true;
        switchError = "";
        try {
            await appKit.switchNetwork(tempNetwork);
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
            const txOptions: {
                chain: Chain;
                account: `0x${string}`;
                abi: Abi;
                address: `0x${string}`;
                functionName: string;
                args: unknown[];
                value?: bigint;
            } = {
                chain: tempViemChain,
                account: walletAddress as `0x${string}`,
                abi,
                address: tempContractAddress as `0x${string}`,
                functionName: fn.name!,
                args,
            };
            // Add value for payable methods
            if (fn.stateMutability === "payable" && state.value) {
                const trimmedValue = state.value.trim();
                if (trimmedValue) {
                    txOptions.value = parseEther(trimmedValue);
                }
            }
            const txHash = await walletClient.writeContract(txOptions);
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

    // Decoder functions
    function decodeError() {
        if (!abi) {
            errorDecodeError = "请先加载合约 ABI";
            return;
        }
        errorDecodeLoading = true;
        errorDecodeError = "";
        errorDecodeResult = "";
        try {
            const data = errorDecodeInput.trim() as `0x${string}`;
            if (!data.startsWith("0x")) {
                throw new Error("数据必须以 0x 开头");
            }
            const result = decodeErrorResult({
                abi,
                data,
            });
            errorDecodeResult = JSON.stringify(
                {
                    errorName: result.errorName,
                    args: result.args,
                },
                (key, val) => (typeof val === "bigint" ? val.toString() : val),
                2,
            );
        } catch (error) {
            console.error(error);
            errorDecodeError =
                error instanceof Error ? error.message : "解码失败";
        } finally {
            errorDecodeLoading = false;
        }
    }

    function decodeEvent() {
        if (!abi) {
            eventDecodeError = "请先加载合约 ABI";
            return;
        }
        eventDecodeLoading = true;
        eventDecodeError = "";
        eventDecodeResult = "";
        try {
            const data = eventDecodeData.trim() as `0x${string}`;
            const topics: `0x${string}`[] = [];
            if (eventDecodeTopic0.trim()) {
                topics.push(eventDecodeTopic0.trim() as `0x${string}`);
            }
            if (eventDecodeTopic1.trim()) {
                topics.push(eventDecodeTopic1.trim() as `0x${string}`);
            }
            if (eventDecodeTopic2.trim()) {
                topics.push(eventDecodeTopic2.trim() as `0x${string}`);
            }
            if (eventDecodeTopic3.trim()) {
                topics.push(eventDecodeTopic3.trim() as `0x${string}`);
            }
            if (topics.length === 0) {
                throw new Error("至少需要提供 topic0 (事件签名)");
            }
            const result = decodeEventLog({
                abi,
                data: data || "0x",
                topics: topics as [`0x${string}`, ...`0x${string}`[]],
            });
            eventDecodeResult = JSON.stringify(
                {
                    eventName: result.eventName,
                    args: result.args,
                },
                (key, val) => (typeof val === "bigint" ? val.toString() : val),
                2,
            );
        } catch (error) {
            console.error(error);
            eventDecodeError =
                error instanceof Error ? error.message : "解码失败";
        } finally {
            eventDecodeLoading = false;
        }
    }

    function decodeCalldata() {
        if (!abi) {
            calldataDecodeError = "请先加载合约 ABI";
            return;
        }
        calldataDecodeLoading = true;
        calldataDecodeError = "";
        calldataDecodeResult = "";
        try {
            const data = calldataDecodeInput.trim() as `0x${string}`;
            if (!data.startsWith("0x")) {
                throw new Error("数据必须以 0x 开头");
            }
            if (data.length < 10) {
                throw new Error("Calldata 至少需要 4 字节函数选择器");
            }
            const result = decodeFunctionData({
                abi,
                data,
            });
            calldataDecodeResult = JSON.stringify(
                {
                    functionName: result.functionName,
                    args: result.args,
                },
                (key, val) => (typeof val === "bigint" ? val.toString() : val),
                2,
            );
        } catch (error) {
            console.error(error);
            calldataDecodeError =
                error instanceof Error ? error.message : "解码失败";
        } finally {
            calldataDecodeLoading = false;
        }
    }

    function decodeReturn() {
        if (!abi) {
            returnDecodeError = "请先加载合约 ABI";
            return;
        }
        if (!returnDecodeFunctionSelector.trim()) {
            returnDecodeError = "请选择或输入函数签名/选择器";
            return;
        }
        returnDecodeLoading = true;
        returnDecodeError = "";
        returnDecodeResult = "";
        try {
            const data = returnDecodeInput.trim() as `0x${string}`;
            if (!data.startsWith("0x")) {
                throw new Error("数据必须以 0x 开头");
            }
            // Find the function by selector or name
            const selectorInput = returnDecodeFunctionSelector.trim();
            let targetFunction: AbiFunction | undefined;

            for (const fn of abiFunctions) {
                const fnSelector = toFunctionSelector(fn);
                if (fnSelector === selectorInput || fn.name === selectorInput) {
                    targetFunction = fn;
                    break;
                }
            }

            if (!targetFunction) {
                throw new Error(`未找到匹配的函数: ${selectorInput}`);
            }

            const result = decodeFunctionResult({
                abi,
                functionName: targetFunction.name,
                data,
            });

            // Format the result with output names if available
            let formattedResult: unknown;
            if (targetFunction.outputs && targetFunction.outputs.length > 0) {
                if (targetFunction.outputs.length === 1) {
                    formattedResult = {
                        [`${targetFunction.outputs[0].name || "result"}`]:
                            result,
                    };
                } else if (Array.isArray(result)) {
                    const obj: Record<string, unknown> = {};
                    targetFunction.outputs.forEach((output, index) => {
                        obj[output.name || `arg${index}`] = result[index];
                    });
                    formattedResult = obj;
                } else {
                    formattedResult = result;
                }
            } else {
                formattedResult = result;
            }

            returnDecodeResult = JSON.stringify(
                {
                    functionName: targetFunction.name,
                    result: formattedResult,
                },
                (key, val) => (typeof val === "bigint" ? val.toString() : val),
                2,
            );
        } catch (error) {
            console.error(error);
            returnDecodeError =
                error instanceof Error ? error.message : "解码失败";
        } finally {
            returnDecodeLoading = false;
        }
    }

    // Generate example value for a parameter type
    function generateExampleValue(param: AbiParameter): unknown {
        const type = param.type;

        // Handle tuple (struct) types
        if (type === "tuple" || type.startsWith("tuple")) {
            const components = (
                param as AbiParameter & { components?: AbiParameter[] }
            ).components;
            if (components) {
                const obj: Record<string, unknown> = {};
                for (const comp of components) {
                    obj[comp.name || "field"] = generateExampleValue(comp);
                }
                // Handle tuple array
                if (type.includes("[")) {
                    return [obj];
                }
                return obj;
            }
            return {};
        }

        // Handle arrays
        if (type.includes("[")) {
            const baseType = type.replace(/\[\d*\]$/, "");
            const baseExample = generateExampleValue({
                ...param,
                type: baseType,
            });
            return [baseExample];
        }

        // Handle basic types
        if (type.startsWith("uint") || type.startsWith("int")) {
            return "0";
        }
        if (type === "address") {
            return "0x0000000000000000000000000000000000000000";
        }
        if (type === "bool") {
            return false;
        }
        if (type.startsWith("bytes")) {
            return "0x";
        }
        if (type === "string") {
            return "";
        }
        return "";
    }

    // Generate placeholder text for input
    function getInputPlaceholder(param: AbiParameter): string {
        const type = param.type;

        if (type === "tuple" || type.startsWith("tuple")) {
            return "输入 JSON 格式的结构体";
        }
        if (type.includes("[")) {
            return "输入 JSON 格式的数组";
        }
        if (type.startsWith("uint") || type.startsWith("int")) {
            return "输入整数";
        }
        if (type === "address") {
            return "输入地址 0x...";
        }
        if (type === "bool") {
            return "输入 true 或 false";
        }
        if (type.startsWith("bytes")) {
            return "输入十六进制 0x...";
        }
        return "输入参数";
    }

    // Format tuple structure for display
    function formatTupleStructure(param: AbiParameter): string {
        const components = (
            param as AbiParameter & { components?: AbiParameter[] }
        ).components;
        if (!components) return "{}";

        const example = generateExampleValue(param);
        return JSON.stringify(example, null, 2);
    }

    // Check if parameter is a tuple type
    function isTupleType(param: AbiParameter): boolean {
        return param.type === "tuple" || param.type.startsWith("tuple");
    }

    function methodLabel(fn: AbiFunction) {
        let returns = "";
        if (fn.outputs?.length > 0) {
            returns =
                "returns (" +
                (fn.outputs?.map((o) => o.type + " " + o.name).join(", ") ??
                    "") +
                ")";
        }

        const parameters =
            fn.inputs?.map((i) => i.type + " " + i.name).join(", ") ?? "";

        return `${fn.name ?? "function"}(${parameters}) ${returns}`;
    }

    onMount(() => {
        fetchContract();
        if (!appKit) return;
        appKit.subscribeAccount((account) => {
            walletAddress = account.address ?? "";
            accountStatus =
                (account.status as typeof accountStatus) ?? "disconnected";
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
        updateChainMismatch();
        showToast("链 ID 已更新", "success");
    }

    function handleResetChainId() {
        tempChainId = targetChainId;
        isEditingChainId = false;
        updateChainMismatch();
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
                        <select
                            class="chain-select"
                            bind:value={tempChainId}
                            onkeydown={(e) => {
                                if (e.key === "Enter") handleSaveChainId();
                                if (e.key === "Escape")
                                    handleCancelEditChainId();
                            }}
                        >
                            {#each supportedEvmNetworks as network}
                                <option value={Number(network.id)}>
                                    {network.name} (ID: {network.id})
                                </option>
                            {/each}
                        </select>
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
            {/if}
            <div class="methods-grid">
                <div class="card">
                    <header>
                        <h2>读合约</h2>
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
                                                <span class="function-selector"
                                                    >{toFunctionSelector(
                                                        method,
                                                    )}</span
                                                >
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
                                                    {#if isTupleType(input)}
                                                        <textarea
                                                            placeholder={getInputPlaceholder(
                                                                input,
                                                            )}
                                                            rows="3"
                                                            value={methodStates[
                                                                key
                                                            ].inputs[index]}
                                                            oninput={(event) =>
                                                                handleInputChange(
                                                                    key,
                                                                    index,
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )}
                                                        ></textarea>
                                                        <details
                                                            class="tuple-hint"
                                                        >
                                                            <summary
                                                                >查看结构体格式</summary
                                                            >
                                                            <pre>{formatTupleStructure(
                                                                    input,
                                                                )}</pre>
                                                        </details>
                                                    {:else}
                                                        <input
                                                            placeholder={getInputPlaceholder(
                                                                input,
                                                            )}
                                                            value={methodStates[
                                                                key
                                                            ].inputs[index]}
                                                            oninput={(event) =>
                                                                handleInputChange(
                                                                    key,
                                                                    index,
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )}
                                                        />
                                                    {/if}
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
                        <h2>写合约</h2>
                        <p>需要发送交易，会消耗 gas</p>
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
                                                <span class="function-selector"
                                                    >{toFunctionSelector(
                                                        method,
                                                    )}</span
                                                >
                                            </p>
                                            <p class="method-signature">
                                                {methodLabel(method)}
                                                {#if method.stateMutability === "payable"}
                                                    <span class="payable-badge"
                                                        >payable</span
                                                    >
                                                {/if}
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
                                    {#if method.stateMutability === "payable"}
                                        <div class="inputs payable-input">
                                            <label>
                                                <span class="payable-label"
                                                    >💰 发送 ETH 数量</span
                                                >
                                                <input
                                                    type="text"
                                                    placeholder="0.0"
                                                    value={methodStates[key]
                                                        .value ?? ""}
                                                    oninput={(event) => {
                                                        methodStates[
                                                            key
                                                        ].value =
                                                            event.currentTarget.value;
                                                    }}
                                                />
                                            </label>
                                        </div>
                                    {/if}
                                    {#if method.inputs?.length}
                                        <div class="inputs">
                                            {#each method.inputs as input, index}
                                                <label>
                                                    <span
                                                        >{input.name ??
                                                            `arg${index}`} · {input.type}</span
                                                    >
                                                    {#if isTupleType(input)}
                                                        <textarea
                                                            placeholder={getInputPlaceholder(
                                                                input,
                                                            )}
                                                            rows="3"
                                                            value={methodStates[
                                                                key
                                                            ].inputs[index]}
                                                            oninput={(event) =>
                                                                handleInputChange(
                                                                    key,
                                                                    index,
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )}
                                                        ></textarea>
                                                        <details
                                                            class="tuple-hint"
                                                        >
                                                            <summary
                                                                >查看结构体格式</summary
                                                            >
                                                            <pre>{formatTupleStructure(
                                                                    input,
                                                                )}</pre>
                                                        </details>
                                                    {:else}
                                                        <input
                                                            placeholder={getInputPlaceholder(
                                                                input,
                                                            )}
                                                            value={methodStates[
                                                                key
                                                            ].inputs[index]}
                                                            oninput={(event) =>
                                                                handleInputChange(
                                                                    key,
                                                                    index,
                                                                    event
                                                                        .currentTarget
                                                                        .value,
                                                                )}
                                                        />
                                                    {/if}
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

    <!-- Decoder Section -->
    {#if abi && !abiError}
        <section class="contract-panel decoder-section">
            <h2 class="section-title">🔍 ABI 解码</h2>
            <p class="section-desc">使用当前合约的 ABI 解码链上数据</p>

            <div class="decoder-grid">
                <!-- Error Decoder -->
                <div class="card decoder-card">
                    <header>
                        <h3>自定义错误解码</h3>
                        <p>解码合约抛出的自定义错误数据</p>
                    </header>
                    <div class="decoder-content">
                        <label>
                            <span>错误数据 (0x...)</span>
                            <textarea
                                placeholder="输入错误返回数据，例如: 0x..."
                                bind:value={errorDecodeInput}
                                rows="3"
                            ></textarea>
                        </label>
                        <button
                            class="ghost"
                            onclick={decodeError}
                            disabled={errorDecodeLoading ||
                                !errorDecodeInput.trim()}
                        >
                            {errorDecodeLoading ? "解码中..." : "解码错误"}
                        </button>
                        {#if errorDecodeError}
                            <p class="notice error">{errorDecodeError}</p>
                        {/if}
                        {#if errorDecodeResult}
                            <pre class="result">{errorDecodeResult}</pre>
                        {/if}
                        {#if abiErrors.length > 0}
                            <details class="abi-items-list">
                                <summary
                                    >已定义的错误 ({abiErrors.length})</summary
                                >
                                <ul>
                                    {#each abiErrors as error}
                                        <li>
                                            <code
                                                >{error.name}({error.inputs
                                                    ?.map(
                                                        (i: { type: string }) =>
                                                            i.type,
                                                    )
                                                    .join(", ") ?? ""})</code
                                            >
                                        </li>
                                    {/each}
                                </ul>
                            </details>
                        {/if}
                    </div>
                </div>

                <!-- Event Decoder -->
                <div class="card decoder-card">
                    <header>
                        <h3>事件解码</h3>
                        <p>解码事件日志数据</p>
                    </header>
                    <div class="decoder-content">
                        <label>
                            <span>Topic0 (事件签名) *</span>
                            <input
                                type="text"
                                placeholder="0x..."
                                bind:value={eventDecodeTopic0}
                            />
                        </label>
                        <label>
                            <span>Topic1 (可选)</span>
                            <input
                                type="text"
                                placeholder="0x..."
                                bind:value={eventDecodeTopic1}
                            />
                        </label>
                        <label>
                            <span>Topic2 (可选)</span>
                            <input
                                type="text"
                                placeholder="0x..."
                                bind:value={eventDecodeTopic2}
                            />
                        </label>
                        <label>
                            <span>Topic3 (可选)</span>
                            <input
                                type="text"
                                placeholder="0x..."
                                bind:value={eventDecodeTopic3}
                            />
                        </label>
                        <label>
                            <span>Data (非索引参数)</span>
                            <textarea
                                placeholder="事件的 data 字段，例如: 0x..."
                                bind:value={eventDecodeData}
                                rows="2"
                            ></textarea>
                        </label>
                        <button
                            class="ghost"
                            onclick={decodeEvent}
                            disabled={eventDecodeLoading ||
                                !eventDecodeTopic0.trim()}
                        >
                            {eventDecodeLoading ? "解码中..." : "解码事件"}
                        </button>
                        {#if eventDecodeError}
                            <p class="notice error">{eventDecodeError}</p>
                        {/if}
                        {#if eventDecodeResult}
                            <pre class="result">{eventDecodeResult}</pre>
                        {/if}
                        {#if abiEvents.length > 0}
                            <details class="abi-items-list">
                                <summary
                                    >已定义的事件 ({abiEvents.length})</summary
                                >
                                <ul>
                                    {#each abiEvents as event}
                                        <li>
                                            <code
                                                >{event.name}({event.inputs
                                                    ?.map(
                                                        (i) =>
                                                            (i.indexed
                                                                ? "indexed "
                                                                : "") + i.type,
                                                    )
                                                    .join(", ") ?? ""})</code
                                            >
                                        </li>
                                    {/each}
                                </ul>
                            </details>
                        {/if}
                    </div>
                </div>

                <!-- Calldata Decoder -->
                <div class="card decoder-card">
                    <header>
                        <h3>函数入参解码</h3>
                        <p>解码交易的 calldata (input data)</p>
                    </header>
                    <div class="decoder-content">
                        <label>
                            <span>Calldata (0x...)</span>
                            <textarea
                                placeholder="输入交易的 input data，例如: 0x..."
                                bind:value={calldataDecodeInput}
                                rows="3"
                            ></textarea>
                        </label>
                        <button
                            class="ghost"
                            onclick={decodeCalldata}
                            disabled={calldataDecodeLoading ||
                                !calldataDecodeInput.trim()}
                        >
                            {calldataDecodeLoading ? "解码中..." : "解码入参"}
                        </button>
                        {#if calldataDecodeError}
                            <p class="notice error">{calldataDecodeError}</p>
                        {/if}
                        {#if calldataDecodeResult}
                            <pre class="result">{calldataDecodeResult}</pre>
                        {/if}
                    </div>
                </div>

                <!-- Return Value Decoder -->
                <div class="card decoder-card">
                    <header>
                        <h3>函数返回值解码</h3>
                        <p>解码函数调用的返回数据</p>
                    </header>
                    <div class="decoder-content">
                        <label>
                            <span>函数选择器或函数名 *</span>
                            <div class="function-selector-input">
                                <input
                                    type="text"
                                    placeholder="输入函数选择器 (0x...) 或函数名"
                                    bind:value={returnDecodeFunctionSelector}
                                    list="function-list"
                                />
                                <datalist id="function-list">
                                    {#each abiFunctionsWithOutputs as fn}
                                        <option value={toFunctionSelector(fn)}
                                            >{fn.name} - {toFunctionSelector(
                                                fn,
                                            )}</option
                                        >
                                    {/each}
                                </datalist>
                            </div>
                        </label>
                        <label>
                            <span>返回数据 (0x...)</span>
                            <textarea
                                placeholder="输入函数返回的数据，例如: 0x..."
                                bind:value={returnDecodeInput}
                                rows="3"
                            ></textarea>
                        </label>
                        <button
                            class="ghost"
                            onclick={decodeReturn}
                            disabled={returnDecodeLoading ||
                                !returnDecodeInput.trim() ||
                                !returnDecodeFunctionSelector.trim()}
                        >
                            {returnDecodeLoading ? "解码中..." : "解码返回值"}
                        </button>
                        {#if returnDecodeError}
                            <p class="notice error">{returnDecodeError}</p>
                        {/if}
                        {#if returnDecodeResult}
                            <pre class="result">{returnDecodeResult}</pre>
                        {/if}
                        {#if abiFunctionsWithOutputs.length > 0}
                            <details class="abi-items-list">
                                <summary
                                    >可用函数 ({abiFunctionsWithOutputs.length})</summary
                                >
                                <ul>
                                    {#each abiFunctionsWithOutputs as fn}
                                        <li>
                                            <button
                                                type="button"
                                                class="function-item-btn"
                                                onclick={() => {
                                                    returnDecodeFunctionSelector =
                                                        toFunctionSelector(fn);
                                                }}
                                            >
                                                <span class="fn-selector"
                                                    >{toFunctionSelector(
                                                        fn,
                                                    )}</span
                                                >
                                                {fn.name}({fn.inputs
                                                    ?.map((i) => i.type)
                                                    .join(", ") ?? ""}) → ({fn.outputs
                                                    ?.map((o) => o.type)
                                                    .join(", ") ?? ""})
                                            </button>
                                        </li>
                                    {/each}
                                </ul>
                            </details>
                        {/if}
                    </div>
                </div>
            </div>
        </section>
    {/if}

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

    .chain-select {
        font-family: "Courier New", monospace;
        font-size: 0.9rem;
        color: #cbd5f5;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(148, 163, 184, 0.4);
        border-radius: 0.35rem;
        padding: 0.25rem 0.5rem;
        min-width: 200px;
        max-width: 300px;
        transition: all 0.2s;
        cursor: pointer;
    }

    .chain-select:hover {
        border-color: rgba(148, 163, 184, 0.6);
    }

    .chain-select:focus {
        outline: none;
        border-color: rgba(16, 185, 129, 0.6);
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }

    .chain-select option {
        background: rgba(15, 23, 42, 0.95);
        color: #cbd5f5;
        padding: 0.5rem;
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

    .function-selector {
        font-weight: 400;
        font-size: 0.85rem;
        color: #94a3b8;
        margin-left: 0.5rem;
        font-family: monospace;
    }

    .method-signature {
        margin: 0.2rem 0 0;
        color: #94a3b8;
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .payable-badge {
        display: inline-block;
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: #fff;
        font-size: 0.7rem;
        font-weight: 600;
        padding: 0.15rem 0.5rem;
        border-radius: 0.375rem;
        text-transform: uppercase;
        letter-spacing: 0.025em;
    }

    .payable-input {
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.3);
        border-radius: 0.5rem;
        padding: 0.75rem;
    }

    .payable-label {
        color: #f59e0b;
        font-weight: 500;
    }

    .tuple-hint {
        margin-top: 0.5rem;
        font-size: 0.8rem;
    }

    .tuple-hint summary {
        color: #60a5fa;
        cursor: pointer;
        user-select: none;
    }

    .tuple-hint summary:hover {
        text-decoration: underline;
    }

    .tuple-hint pre {
        margin-top: 0.5rem;
        padding: 0.75rem;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 0.5rem;
        font-size: 0.75rem;
        color: #94a3b8;
        overflow-x: auto;
    }

    .inputs textarea {
        width: 100%;
        min-height: 60px;
        padding: 0.5rem;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 0.5rem;
        background: rgba(15, 23, 42, 0.6);
        color: #e2e8f0;
        font-family: monospace;
        font-size: 0.85rem;
        resize: vertical;
    }

    .inputs textarea:focus {
        outline: none;
        border-color: #3b82f6;
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
        background: linear-gradient(135deg, #10b981, #34d399);
        border: none;
        color: white;
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

    /* Decoder styles */
    .decoder-section {
        margin-top: 1rem;
    }

    .section-title {
        margin: 0 0 0.25rem;
        font-size: 1.5rem;
    }

    .section-desc {
        margin: 0 0 1.5rem;
        color: #94a3b8;
    }

    .decoder-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 1.5rem;
    }

    .decoder-card header h3 {
        margin: 0;
        font-size: 1.1rem;
    }

    .decoder-card header p {
        margin: 0.2rem 0 0;
        color: #94a3b8;
        font-size: 0.85rem;
    }

    .decoder-content {
        margin-top: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.8rem;
    }

    .decoder-content textarea {
        border-radius: 0.8rem;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.6);
        color: #f8fafc;
        padding: 0.7rem 0.9rem;
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 0.85rem;
        resize: vertical;
        min-height: 60px;
    }

    .decoder-content textarea:focus {
        outline: none;
        border-color: rgba(16, 185, 129, 0.6);
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }

    .function-selector-input {
        position: relative;
    }

    .function-selector-input input {
        width: 100%;
        box-sizing: border-box;
    }

    .abi-items-list {
        margin-top: 0.5rem;
        font-size: 0.85rem;
        color: #94a3b8;
    }

    .abi-items-list summary {
        cursor: pointer;
        padding: 0.4rem 0;
        user-select: none;
    }

    .abi-items-list summary:hover {
        color: #e2e8f0;
    }

    .abi-items-list ul {
        margin: 0.5rem 0 0;
        padding-left: 1rem;
        list-style: none;
        max-height: 200px;
        overflow-y: auto;
    }

    .abi-items-list li {
        padding: 0.25rem 0;
    }

    .abi-items-list code {
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 0.8rem;
        background: rgba(15, 23, 42, 0.5);
        padding: 0.2rem 0.4rem;
        border-radius: 0.25rem;
        display: inline-block;
        word-break: break-all;
    }

    .abi-items-list .function-item-btn {
        cursor: pointer;
        transition: all 0.2s;
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 0.8rem;
        background: rgba(15, 23, 42, 0.5);
        padding: 0.2rem 0.4rem;
        border-radius: 0.25rem;
        display: inline-block;
        word-break: break-all;
        border: none;
        color: #94a3b8;
        text-align: left;
    }

    .abi-items-list .function-item-btn:hover {
        background: rgba(16, 185, 129, 0.2);
        color: #a7f3d0;
    }

    .fn-selector {
        color: #64748b;
        margin-right: 0.5rem;
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
