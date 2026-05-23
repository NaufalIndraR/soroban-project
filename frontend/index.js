/**
 * ============================================================================
 * DonasiKomunitas — Frontend JavaScript (index.js)
 * Micro-Crowdfunding dApp on Stellar / Soroban
 *
 * Stack:
 *   - @stellar/freighter-api  : Koneksi & penandatanganan transaksi wallet
 *   - @stellar/stellar-sdk    : Membangun transaksi & memanggil Soroban RPC
 *
 * Jalankan via server lokal (misalnya: npx serve . atau Live Server)
 * ============================================================================
 */

// ============================================================================
// IMPORTS — menggunakan ESM CDN (Skypack / jspm.io)
// ============================================================================
import {
    isConnected,
    getAddress,
    signTransaction,
    isAllowed,
    requestAccess,
} from "https://cdnjs.cloudflare.com/ajax/libs/freighter-api/5.9.0/index.min.js";

import {
    SorobanRpc,
    TransactionBuilder,
    Networks,
    BASE_FEE,
    Contract,
    nativeToScVal,
    Address,
    scValToNative,
    xdr,
    Keypair,
} from "https://cdnjs.cloudflare.com/ajax/libs/stellar-sdk/13.1.0/stellar-sdk.min.js";

// ============================================================================
// KONFIGURASI — GANTI nilai ini setelah deploy kontrak
// ============================================================================
const CONFIG = {
    /**
     * ⚠️  GANTI dengan Contract ID hasil `soroban contract deploy`
     * Contoh: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
     */
    CONTRACT_ID: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",

    /**
     * Jaringan Stellar yang digunakan
     * Untuk Testnet: Networks.TESTNET
     * Untuk Mainnet: Networks.PUBLIC
     */
    NETWORK_PASSPHRASE: Networks.TESTNET,

    /**
     * Soroban RPC endpoint untuk Testnet
     * Daftar endpoints resmi: https://soroban.stellar.org/docs/reference/rpc-list
     */
    RPC_URL: "https://soroban-testnet.stellar.org",

    /**
     * Horizon Server URL untuk cek saldo
     */
    HORIZON_URL: "https://horizon-testnet.stellar.org",

    /**
     * Konversi: 1 XLM = 10,000,000 Stroops
     */
    STROOPS_PER_XLM: 10_000_000n,
};

// ============================================================================
// STATE APLIKASI
// ============================================================================
let state = {
    walletAddress: null,         // Public key wallet yang terhubung
    campaignStatus: null,        // Data status dari kontrak
    countdownInterval: null,     // Interval timer countdown
    isLoading: false,            // Flag loading global
    txLog: [],                   // Log transaksi lokal
};

// ============================================================================
// DOM REFERENCES
// ============================================================================
const dom = {
    btnConnectWallet:    () => document.getElementById("btn-connect-wallet"),
    walletLabel:         () => document.getElementById("wallet-label"),
    statCollected:       () => document.getElementById("stat-collected"),
    statTarget:          () => document.getElementById("stat-target"),
    statPercentage:      () => document.getElementById("stat-percentage"),
    statDonors:          () => document.getElementById("stat-donors"),
    progressBar:         () => document.getElementById("progress-bar"),
    cdDays:              () => document.getElementById("cd-days"),
    cdHours:             () => document.getElementById("cd-hours"),
    cdMinutes:           () => document.getElementById("cd-minutes"),
    cdSeconds:           () => document.getElementById("cd-seconds"),
    deadlineDisplay:     () => document.getElementById("deadline-display"),
    campaignStatusBadge: () => document.getElementById("campaign-status-badge"),
    btnDonate:           () => document.getElementById("btn-donate"),
    donationAmount:      () => document.getElementById("donation-amount"),
    stroopsPreview:      () => document.getElementById("stroops-preview"),
    walletBalance:       () => document.getElementById("wallet-balance"),
    walletWarning:       () => document.getElementById("wallet-warning"),
    txLogContainer:      () => document.getElementById("tx-log"),
    actionSection:       () => document.getElementById("action-section"),
    btnWithdraw:         () => document.getElementById("btn-withdraw"),
    btnRefund:           () => document.getElementById("btn-refund"),
    infoContractId:      () => document.getElementById("info-contract-id"),
    myDonationCard:      () => document.getElementById("my-donation-card"),
    myDonationAmount:    () => document.getElementById("my-donation-amount"),
};

// ============================================================================
// SOROBAN RPC CLIENT
// ============================================================================
const rpc = new SorobanRpc.Server(CONFIG.RPC_URL, { allowHttp: true });

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** Konversi BigInt Stroops ke XLM dengan 2 desimal */
function stroopsToXlm(stroops) {
    const n = BigInt(stroops);
    const whole = n / CONFIG.STROOPS_PER_XLM;
    const fraction = n % CONFIG.STROOPS_PER_XLM;
    const fractionStr = fraction.toString().padStart(7, "0").slice(0, 2);
    return `${whole.toString()}.${fractionStr}`;
}

/** Konversi XLM ke Stroops */
function xlmToStroops(xlm) {
    const num = parseFloat(xlm);
    if (isNaN(num) || num <= 0) return 0n;
    return BigInt(Math.round(num * 10_000_000));
}

/** Format angka besar dengan pemisah ribuan */
function formatNumber(num) {
    return new Intl.NumberFormat("id-ID").format(num);
}

/** Truncate alamat Stellar (G... -> G...xxxx) */
function truncateAddress(addr) {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Pad angka ke 2 digit */
function pad(num) {
    return String(Math.max(0, num)).padStart(2, "0");
}

/** Format Unix timestamp ke tanggal lokal */
function formatTimestamp(ts) {
    return new Date(Number(ts) * 1000).toLocaleString("id-ID", {
        day: "2-digit", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
}

// ============================================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================================

/**
 * Tampilkan notifikasi toast
 * @param {string} message - Pesan yang ditampilkan
 * @param {'success'|'error'|'info'|'warning'} type - Tipe notifikasi
 * @param {number} duration - Durasi tampil dalam ms (default 5000)
 */
function showToast(message, type = "info", duration = 5000) {
    const container = document.getElementById("toast-container");

    const icons = {
        success: `<svg class="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
        error:   `<svg class="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
        info:    `<svg class="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
        warning: `<svg class="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
    };

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        ${icons[type] || icons.info}
        <div class="flex-1">
            <p class="text-sm font-medium text-white">${message}</p>
        </div>
        <button onclick="this.parentElement.remove()" class="flex-shrink-0 ml-2 text-white/40 hover:text-white transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </button>
    `;

    container.appendChild(toast);

    // Auto-remove
    setTimeout(() => {
        toast.style.animation = "slideOutRight 0.3s ease forwards";
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ============================================================================
// TX LOG
// ============================================================================

/** Tambah entri ke log transaksi */
function addTxLog(type, txHash, amount = null) {
    const container = dom.txLogContainer();
    if (!container) return;

    // Hapus placeholder jika ada
    const placeholder = container.querySelector(".text-center");
    if (placeholder) placeholder.remove();

    const typeColors = {
        donate:   { bg: "rgba(26,71,255,0.1)",  border: "rgba(26,71,255,0.25)",  text: "#7a9cff",  label: "Donasi" },
        withdraw: { bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.25)", text: "#34d399",  label: "Withdraw" },
        refund:   { bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.25)",  text: "#f87171",  label: "Refund" },
    };

    const c = typeColors[type] || typeColors.donate;
    const entry = document.createElement("div");
    entry.className = "flex items-center gap-3 p-3 rounded-xl text-xs animate-in";
    entry.style.cssText = `background: ${c.bg}; border: 1px solid ${c.border};`;
    entry.innerHTML = `
        <div class="flex-shrink-0 font-bold px-2 py-0.5 rounded-md text-xs" style="background: ${c.bg}; color: ${c.text};">${c.label}</div>
        <div class="flex-1 min-w-0">
            ${amount ? `<p class="font-bold" style="color: ${c.text};">${amount} XLM</p>` : ""}
            <p class="font-mono truncate" style="color: rgba(255,255,255,0.5);">${txHash}</p>
        </div>
        <a href="https://stellar.expert/explorer/testnet/tx/${txHash}" target="_blank"
           class="flex-shrink-0 text-xs px-2 py-1 rounded hover:bg-white/10 transition-colors" style="color: rgba(255,255,255,0.4);">
           ↗
        </a>
    `;

    container.insertBefore(entry, container.firstChild);
    state.txLog.unshift({ type, txHash, amount, time: Date.now() });
}

/** Hapus semua log transaksi */
window.clearTxLog = function () {
    state.txLog = [];
    dom.txLogContainer().innerHTML = `
        <div class="text-xs text-center py-6" style="color: rgba(255,255,255,0.4);">
            <svg class="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Belum ada transaksi
        </div>
    `;
};

// ============================================================================
// COUNTDOWN TIMER
// ============================================================================

/** Mulai countdown dari deadline Unix timestamp */
function startCountdown(deadlineTs) {
    if (state.countdownInterval) clearInterval(state.countdownInterval);

    const update = () => {
        const now = Math.floor(Date.now() / 1000);
        const diff = Number(deadlineTs) - now;

        if (diff <= 0) {
            dom.cdDays().textContent    = "00";
            dom.cdHours().textContent   = "00";
            dom.cdMinutes().textContent = "00";
            dom.cdSeconds().textContent = "00";
            clearInterval(state.countdownInterval);
            checkPostDeadlineActions();
            return;
        }

        const days    = Math.floor(diff / 86400);
        const hours   = Math.floor((diff % 86400) / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;

        dom.cdDays().textContent    = pad(days);
        dom.cdHours().textContent   = pad(hours);
        dom.cdMinutes().textContent = pad(minutes);
        dom.cdSeconds().textContent = pad(seconds);
    };

    update();
    state.countdownInterval = setInterval(update, 1000);
}

// ============================================================================
// UI UPDATE FUNCTIONS
// ============================================================================

/** Update seluruh UI berdasarkan data kampanye dari kontrak */
function updateCampaignUI(status) {
    state.campaignStatus = status;

    const { total_funded, target_amount, deadline, is_successful, is_expired, is_withdrawn } = status;

    // Konversi ke XLM
    const collectedXlm  = stroopsToXlm(total_funded);
    const targetXlm     = stroopsToXlm(target_amount);

    // Update stat numbers
    dom.statCollected().innerHTML = `<span class="count-up">${formatNumber(parseFloat(collectedXlm))} XLM</span>`;
    dom.statTarget().innerHTML    = `<span>${formatNumber(parseFloat(targetXlm))} XLM</span>`;

    // Progress percentage
    const pct = target_amount > 0n
        ? Math.min(100, Math.round(Number(total_funded * 100n / target_amount)))
        : 0;
    dom.statPercentage().textContent = `${pct}%`;
    dom.progressBar().style.width   = `${pct}%`;

    // Donors placeholder (kontrak tidak menyimpan jumlah donatur, tampilkan "-")
    dom.statDonors().textContent = "Pantau via Explorer";

    // Deadline display
    dom.deadlineDisplay().textContent = formatTimestamp(deadline);
    startCountdown(deadline);

    // Status badge
    updateStatusBadge(is_expired, is_successful, is_withdrawn);

    // Action section
    updateActionSection(is_expired, is_successful, is_withdrawn);

    // Contract info
    dom.infoContractId().textContent = CONFIG.CONTRACT_ID;
}

/** Update badge status kampanye */
function updateStatusBadge(isExpired, isSuccessful, isWithdrawn) {
    const badge = dom.campaignStatusBadge();

    if (!isExpired) {
        badge.className = "inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 status-badge badge-active badge-shimmer";
        badge.innerHTML = `<div class="pulse-dot bg-blue-400"></div><span>Kampanye Aktif</span>`;
    } else if (isSuccessful) {
        badge.className = "inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 status-badge badge-success";
        badge.innerHTML = `<span>✅ Target Tercapai!</span>`;
    } else {
        badge.className = "inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 status-badge badge-failed";
        badge.innerHTML = `<span>❌ Kampanye Gagal</span>`;
    }
}

/** Tampilkan/sembunyikan tombol aksi pasca-deadline */
function updateActionSection(isExpired, isSuccessful, isWithdrawn) {
    if (!isExpired) {
        dom.actionSection().classList.add("hidden");
        return;
    }

    dom.actionSection().classList.remove("hidden");

    const isAdmin = state.walletAddress && state.campaignStatus &&
        state.walletAddress === scValToNative(state.campaignStatus.admin);

    if (isSuccessful && !isWithdrawn && isAdmin) {
        dom.btnWithdraw().classList.remove("hidden");
        dom.btnRefund().classList.add("hidden");
    } else if (!isSuccessful && !isWithdrawn) {
        dom.btnRefund().classList.remove("hidden");
        dom.btnWithdraw().classList.add("hidden");
    } else {
        dom.btnWithdraw().classList.add("hidden");
        dom.btnRefund().classList.add("hidden");
        dom.actionSection().querySelector("p").textContent =
            isWithdrawn ? "Dana sudah berhasil diklaim oleh admin." : "Tidak ada aksi yang tersedia.";
    }
}

/** Update info donasi wallet yang terhubung */
function updateMyDonationCard(amount) {
    if (!state.walletAddress || amount === null) return;
    const xlm = stroopsToXlm(amount);
    dom.myDonationCard().classList.remove("hidden");
    dom.myDonationAmount().textContent = `${parseFloat(xlm).toFixed(2)} XLM`;
}

// ============================================================================
// SOROBAN CONTRACT INTERACTIONS
// ============================================================================

/**
 * Panggil fungsi READ-ONLY (view/simulate) dari kontrak Soroban
 * @param {string} funcName - Nama fungsi kontrak
 * @param {xdr.ScVal[]} args - Argumen dalam format ScVal
 * @returns {Promise<xdr.ScVal>} - Nilai kembalian
 */
async function callContractRead(funcName, args = []) {
    const account = await rpc.getAccount(
        // Gunakan alamat dummy untuk simulasi read-only jika wallet belum connect
        state.walletAddress || "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
    );

    const contract = new Contract(CONFIG.CONTRACT_ID);

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    })
        .addOperation(contract.call(funcName, ...args))
        .setTimeout(30)
        .build();

    const result = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(result)) {
        throw new Error(`Simulation error: ${result.error}`);
    }

    if (!result.result) {
        throw new Error("No result from simulation");
    }

    return scValToNative(result.result.retval);
}

/**
 * Panggil fungsi WRITE (mengubah state) dari kontrak via Freighter
 * @param {string} funcName - Nama fungsi kontrak
 * @param {xdr.ScVal[]} args - Argumen dalam format ScVal
 * @returns {Promise<string>} - Transaction hash
 */
async function callContractWrite(funcName, args = []) {
    if (!state.walletAddress) {
        throw new Error("Wallet belum terhubung");
    }

    showToast("Mempersiapkan transaksi...", "info");

    const account = await rpc.getAccount(state.walletAddress);
    const contract = new Contract(CONFIG.CONTRACT_ID);

    // Build transaksi
    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    })
        .addOperation(contract.call(funcName, ...args))
        .setTimeout(30)
        .build();

    // Simulasi dulu untuk mendapat soroban data
    const simResult = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
        throw new Error(`Simulasi gagal: ${simResult.error}`);
    }

    // Assemble transaksi dengan hasil simulasi
    const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();

    showToast("Silakan tandatangani transaksi di Freighter Wallet...", "info", 8000);

    // Minta tanda tangan dari Freighter
    const signedXdr = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
        network: "TESTNET",
    });

    showToast("Mengirim transaksi ke jaringan Stellar...", "info");

    // Submit transaksi
    const signedTx = TransactionBuilder.fromXDR(signedXdr, CONFIG.NETWORK_PASSPHRASE);
    const sendResult = await rpc.sendTransaction(signedTx);

    if (sendResult.status === "ERROR") {
        throw new Error(`Transaksi gagal: ${JSON.stringify(sendResult.errorResult)}`);
    }

    // Tunggu konfirmasi
    const txHash = sendResult.hash;
    let txResponse;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
        txResponse = await rpc.getTransaction(txHash);

        if (txResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
            return txHash;
        }
        if (txResponse.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
            throw new Error("Transaksi ditolak oleh jaringan");
        }

        // Masih pending, tunggu 2 detik
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
    }

    throw new Error("Timeout: transaksi tidak terkonfirmasi dalam waktu yang ditentukan");
}

// ============================================================================
// FETCH CAMPAIGN DATA
// ============================================================================

/** Ambil data status kampanye dari kontrak dan update UI */
async function fetchCampaignStatus() {
    try {
        const status = await callContractRead("get_status");
        updateCampaignUI(status);

        // Fetch donasi personal jika wallet terhubung
        if (state.walletAddress) {
            fetchMyDonation();
        }
    } catch (err) {
        console.error("Gagal mengambil data kampanye:", err);
        showToast(
            `Gagal memuat data kontrak. Pastikan Contract ID sudah benar dan jaringan tersambung.`,
            "error",
            8000
        );

        // Tampilkan demo data
        showDemoData();
    }
}

/** Tampilkan data demo jika kontrak belum di-deploy */
function showDemoData() {
    const now = Math.floor(Date.now() / 1000);
    const demoStatus = {
        total_funded: 150_000_000_0n,   // 1500 XLM
        target_amount: 500_000_000_0n,  // 5000 XLM
        deadline: BigInt(now + 86400 * 3), // 3 hari lagi
        admin: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        is_successful: false,
        is_expired: false,
        is_withdrawn: false,
    };
    updateCampaignUI(demoStatus);
    showToast("Mode Demo: Contract ID belum dikonfigurasi. Ganti CONTRACT_ID di index.js", "warning", 10000);
}

/** Ambil jumlah donasi wallet yang terhubung */
async function fetchMyDonation() {
    if (!state.walletAddress) return;
    try {
        const addr = new Address(state.walletAddress).toScVal();
        const amount = await callContractRead("get_donor_amount", [addr]);
        updateMyDonationCard(BigInt(amount));
    } catch (err) {
        console.warn("Gagal mengambil data donasi personal:", err);
    }
}

/** Ambil saldo XLM wallet yang terhubung */
async function fetchWalletBalance() {
    if (!state.walletAddress) return;
    try {
        const res = await fetch(`${CONFIG.HORIZON_URL}/accounts/${state.walletAddress}`);
        if (!res.ok) return;
        const data = await res.json();
        const xlmBalance = data.balances?.find(b => b.asset_type === "native")?.balance ?? "0";
        dom.walletBalance().textContent = `${parseFloat(xlmBalance).toFixed(2)} XLM`;
        dom.walletBalance().style.color = "rgba(255,255,255,0.7)";
    } catch (err) {
        console.warn("Gagal mengambil saldo:", err);
    }
}

// ============================================================================
// WALLET CONNECTION
// ============================================================================

/** Handler tombol Connect/Disconnect Wallet */
window.handleWalletConnection = async function () {
    if (state.walletAddress) {
        // Disconnect
        state.walletAddress = null;
        updateWalletUI(null);
        dom.myDonationCard().classList.add("hidden");
        showToast("Wallet berhasil diputus", "info");
        return;
    }

    const btn = dom.btnConnectWallet();
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div><span>Menghubungkan...</span>`;

    try {
        // Cek apakah Freighter terinstall
        const connected = await isConnected();
        if (!connected) {
            showToast(
                "Freighter Wallet tidak ditemukan! Silakan install ekstensi Freighter.",
                "error",
                8000
            );
            window.open("https://freighter.app", "_blank");
            return;
        }

        // Minta izin akses
        const allowed = await isAllowed();
        if (!allowed) {
            await requestAccess();
        }

        // Ambil alamat wallet
        const address = await getAddress();
        state.walletAddress = address;
        updateWalletUI(address);
        fetchWalletBalance();
        fetchMyDonation();

        showToast(`Wallet terhubung: ${truncateAddress(address)}`, "success");
    } catch (err) {
        console.error("Gagal menghubungkan wallet:", err);
        showToast(`Gagal menghubungkan wallet: ${err.message}`, "error");
    } finally {
        btn.disabled = false;
    }
};

/** Update tampilan wallet di header */
function updateWalletUI(address) {
    const btn = dom.btnConnectWallet();
    const label = dom.walletLabel();
    const warning = dom.walletWarning();

    if (address) {
        btn.classList.add("connected");
        label.innerHTML = `
            <span class="wallet-address">${truncateAddress(address)}</span>
        `;
        btn.innerHTML = `
            <div class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-slow"></div>
            <span class="wallet-address">${truncateAddress(address)}</span>
        `;
        if (warning) warning.style.display = "none";
    } else {
        btn.classList.remove("connected");
        btn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/>
            </svg>
            <span>Hubungkan Freighter</span>
        `;
        if (warning) warning.style.display = "block";
    }
}

// ============================================================================
// DONATE HANDLER
// ============================================================================

/** Handler tombol Kirim Donasi */
window.handleDonate = async function () {
    if (!state.walletAddress) {
        showToast("Hubungkan Freighter Wallet terlebih dahulu!", "warning");
        return;
    }

    const amountInput = dom.donationAmount();
    const xlmAmount = parseFloat(amountInput.value);

    if (isNaN(xlmAmount) || xlmAmount <= 0) {
        showToast("Masukkan jumlah donasi yang valid!", "warning");
        amountInput.focus();
        return;
    }

    if (state.campaignStatus?.is_expired) {
        showToast("Kampanye sudah berakhir. Tidak dapat berdonasi.", "error");
        return;
    }

    const stroops = xlmToStroops(xlmAmount);
    const btn = dom.btnDonate();

    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div><span>Memproses...</span>`;

    try {
        // Argumen: donor (Address ScVal), amount (i128 ScVal)
        const donorArg  = new Address(state.walletAddress).toScVal();
        const amountArg = nativeToScVal(stroops, { type: "i128" });

        const txHash = await callContractWrite("donate", [donorArg, amountArg]);

        showToast(`✅ Donasi ${xlmAmount} XLM berhasil! TX: ${truncateAddress(txHash)}`, "success", 8000);
        addTxLog("donate", txHash, xlmAmount.toString());

        amountInput.value = "";
        dom.stroopsPreview().textContent = "—";

        // Refresh data kampanye
        await fetchCampaignStatus();

    } catch (err) {
        console.error("Donasi gagal:", err);
        showToast(`Donasi gagal: ${err.message}`, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
            </svg>
            <span>Kirim Donasi</span>
        `;
    }
};

// ============================================================================
// WITHDRAW HANDLER (Admin)
// ============================================================================

/** Handler tombol Klaim Dana (admin only) */
window.handleWithdraw = async function () {
    if (!state.walletAddress) {
        showToast("Hubungkan wallet terlebih dahulu!", "warning");
        return;
    }

    const btn = dom.btnWithdraw();
    btn.disabled = true;
    btn.textContent = "Memproses...";

    try {
        const txHash = await callContractWrite("withdraw", []);
        showToast(`✅ Dana berhasil diklaim! TX: ${truncateAddress(txHash)}`, "success", 8000);
        addTxLog("withdraw", txHash);
        await fetchCampaignStatus();
    } catch (err) {
        console.error("Withdraw gagal:", err);
        showToast(`Gagal klaim dana: ${err.message}`, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "💰 Klaim Dana (Admin)";
    }
};

// ============================================================================
// REFUND HANDLER (Donor)
// ============================================================================

/** Handler tombol Minta Refund */
window.handleRefund = async function () {
    if (!state.walletAddress) {
        showToast("Hubungkan wallet terlebih dahulu!", "warning");
        return;
    }

    const btn = dom.btnRefund();
    btn.disabled = true;
    btn.textContent = "Memproses...";

    try {
        const donorArg = new Address(state.walletAddress).toScVal();
        const txHash = await callContractWrite("refund", [donorArg]);
        showToast(`✅ Refund berhasil! Dana dikembalikan. TX: ${truncateAddress(txHash)}`, "success", 8000);
        addTxLog("refund", txHash);
        await fetchCampaignStatus();
    } catch (err) {
        console.error("Refund gagal:", err);
        showToast(`Gagal refund: ${err.message}`, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "↩️ Minta Refund";
    }
};

// ============================================================================
// QUICK AMOUNT BUTTONS
// ============================================================================

/** Set nilai cepat di input donasi */
window.setQuickAmount = function (amount) {
    const input = dom.donationAmount();
    input.value = amount;

    // Update stroops preview
    const stroops = xlmToStroops(amount);
    dom.stroopsPreview().textContent = `${formatNumber(Number(stroops))} stroops`;

    // Highlight tombol yang dipilih
    document.querySelectorAll(".quick-amt").forEach(btn => {
        btn.style.background = "rgba(26,71,255,0.12)";
        btn.style.borderColor = "rgba(26,71,255,0.25)";
    });
    event.target.style.background = "rgba(26,71,255,0.3)";
    event.target.style.borderColor = "rgba(26,71,255,0.6)";
};

// ============================================================================
// INPUT LISTENERS
// ============================================================================

/** Live preview konversi XLM → Stroops saat user mengetik */
function initInputListeners() {
    const input = dom.donationAmount();
    if (!input) return;

    input.addEventListener("input", () => {
        const val = parseFloat(input.value);
        if (!isNaN(val) && val > 0) {
            const stroops = xlmToStroops(val);
            dom.stroopsPreview().textContent = `${formatNumber(Number(stroops))} stroops`;
        } else {
            dom.stroopsPreview().textContent = "—";
        }
    });
}

// ============================================================================
// CHECK POST-DEADLINE ACTIONS
// ============================================================================

/** Periksa dan tampilkan aksi yang tersedia setelah deadline */
function checkPostDeadlineActions() {
    if (!state.campaignStatus) return;
    updateActionSection(true, state.campaignStatus.is_successful, state.campaignStatus.is_withdrawn);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/** Inisialisasi aplikasi saat halaman dimuat */
async function init() {
    console.log("🚀 DonasiKomunitas dApp Starting...");
    console.log("📋 Contract ID:", CONFIG.CONTRACT_ID);
    console.log("🌐 RPC URL:", CONFIG.RPC_URL);

    // Init listeners
    initInputListeners();

    // Cek apakah Freighter sudah terhubung sebelumnya
    try {
        const connected = await isConnected();
        if (connected) {
            const allowed = await isAllowed();
            if (allowed) {
                const address = await getAddress();
                state.walletAddress = address;
                updateWalletUI(address);
                fetchWalletBalance();
                console.log("✅ Auto-connected wallet:", address);
            }
        }
    } catch (err) {
        console.warn("Freighter tidak tersedia:", err.message);
    }

    // Load data kampanye
    await fetchCampaignStatus();

    // Auto-refresh setiap 30 detik
    setInterval(fetchCampaignStatus, 30_000);

    console.log("✅ App initialized");
}

// Start!
init().catch(console.error);
