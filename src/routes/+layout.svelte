<script lang="ts">
    import favicon from "$lib/assets/favicon.svg";
    import "$lib/appkit";
    import { appKit } from "$lib/appkit";
    import { browser } from "$app/environment";
    import { onMount } from "svelte";

    let { children } = $props();

    let walletAddress = $state("");
    let accountStatus = $state<
        "disconnected" | "connecting" | "connected" | "reconnecting"
    >("disconnected");
    let connectModalLoading = $state(false);

    function shorten(address: string) {
        if (!address) return "";
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    onMount(() => {
        if (!browser || !appKit) return;
        appKit.subscribeAccount((account) => {
            walletAddress = account.address ?? "";
            accountStatus =
                (account.status as typeof accountStatus) ?? "disconnected";
        });
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
    <link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
    <nav class="navbar">
        <div class="navbar-container">
            <a href="/" class="brand">
                <span class="brand-icon">⚡</span>
                <span class="brand-text">ABIUI</span>
            </a>
            <div class="navbar-actions">
                <a href="/" class="nav-link">首页</a>
                <button
                    class="connect-btn"
                    type="button"
                    onclick={openWalletModal}
                    disabled={connectModalLoading}
                >
                    {connectModalLoading
                        ? "打开中..."
                        : walletAddress
                          ? `查看钱包 · ${shorten(walletAddress)}`
                          : "连接钱包"}
                </button>
            </div>
        </div>
    </nav>
    <main class="main-content">
        {@render children()}
    </main>
</div>

<style>
    :global(html, body) {
        margin: 0;
        padding: 0;
    }

    .app {
        min-height: 100vh;
        background: radial-gradient(circle at top, #050b18, #010409 55%);
        color: #e2e8f0;
    }

    .navbar {
        position: sticky;
        top: 0;
        z-index: 100;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        padding: 1rem 0;
    }

    .navbar-container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 0 clamp(1rem, 4vw, 2rem);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .brand {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        text-decoration: none;
        color: #e2e8f0;
        font-weight: 700;
        font-size: 1.2rem;
        transition: transform 0.2s;
    }

    .brand:hover {
        transform: translateY(-1px);
    }

    .brand-icon {
        font-size: 1.5rem;
    }

    .brand-text {
        background: linear-gradient(135deg, #3b82f6, #a855f7);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .navbar-actions {
        display: flex;
        align-items: center;
        gap: 1.5rem;
    }

    .nav-link {
        color: #cbd5f5;
        text-decoration: none;
        font-size: 0.95rem;
        font-weight: 500;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        transition: all 0.2s;
    }

    .nav-link:hover {
        color: #e2e8f0;
        background: rgba(59, 130, 246, 0.15);
    }

    .connect-btn {
        padding: 0.6rem 1.2rem;
        border-radius: 0.75rem;
        border: none;
        background: linear-gradient(135deg, #3b82f6, #a855f7);
        color: white;
        font-size: 0.95rem;
        font-weight: 600;
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
        box-shadow: 0 10px 25px rgba(59, 130, 246, 0.4);
    }

    .main-content {
        min-height: calc(100vh - 70px);
    }

    @media (max-width: 640px) {
        .navbar-container {
            padding: 0 1rem;
        }

        .navbar-actions {
            gap: 0.75rem;
        }

        .nav-link {
            padding: 0.4rem 0.8rem;
            font-size: 0.9rem;
        }

        .connect-btn {
            padding: 0.5rem 1rem;
            font-size: 0.85rem;
        }
    }
</style>
