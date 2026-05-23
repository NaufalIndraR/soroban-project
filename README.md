# DonasiKomunitas — Micro-Crowdfunding dApp on Stellar/Soroban

> Platform donasi terdesentralisasi berbasis Stellar Blockchain. Transparan, aman, tanpa perantara.

---

## 📁 Struktur Proyek

```
soroban-project/
├── Cargo.toml                          # Workspace Rust manifest
├── Cargo.lock
├── contracts/
│   └── donasi-komunitas/               # Smart Contract Soroban
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs                  # Kode kontrak utama
└── frontend/
    ├── index.html                      # UI (Tailwind CSS)
    └── index.js                        # Logika (Stellar SDK + Freighter)
```

---

## ⚙️ Prasyarat

### Tools yang Diperlukan

| Tool | Versi | Link Instalasi |
|------|-------|----------------|
| Rust + Cargo | stable | https://rustup.rs |
| Soroban CLI | ≥ 22.x | `cargo install --locked soroban-cli` |
| Freighter Wallet | Latest | https://freighter.app (ekstensi Chrome/Firefox) |
| Node.js | ≥ 18.x | https://nodejs.org |

### Install Soroban CLI

```bash
cargo install --locked soroban-cli --features opt
```

### Tambahkan target WebAssembly

```bash
rustup target add wasm32-unknown-unknown
```

---

## 🔨 Langkah 1 — Compile Smart Contract

Dari direktori root `soroban-project/`:

```bash
# Build semua contract di workspace
soroban contract build

# atau spesifik ke donasi-komunitas saja
cd contracts/donasi-komunitas
cargo build --target wasm32-unknown-unknown --release
```

File WASM akan ada di:
```
target/wasm32-unknown-unknown/release/donasi_komunitas.wasm
```

> **Tip:** Gunakan `soroban contract build` dari root workspace untuk path yang benar.

---

## 🆔 Langkah 2 — Setup Identity (Keypair) di Testnet

```bash
# Generate keypair baru untuk admin kampanye
soroban keys generate admin --network testnet

# Tampilkan public key admin
soroban keys address admin

# Fund akun dengan Friendbot (faucet Testnet)
soroban keys fund admin --network testnet
```

---

## 🚀 Langkah 3 — Deploy Kontrak ke Testnet

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/donasi_komunitas.wasm \
  --source admin \
  --network testnet
```

**Output:** Contract ID dalam format `C...` (56 karakter)

```
ℹ️  Simulating deploy transaction…
🔑 Signing transaction: ...
📡 Sending transaction…
✅ Transaction included in ledger.
Contract ID: CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Simpan Contract ID ini!** Anda akan menggunakannya di langkah berikutnya.

---

## 🎛️ Langkah 4 — Initialize Kampanye

Setelah deploy, panggil `initialize` untuk mengatur parameter kampanye:

```bash
# Cari alamat XLM Native Asset Contract (diperlukan sebagai token_id)
soroban contract id asset \
  --asset native \
  --network testnet

# Initialize kontrak
soroban contract invoke \
  --id <CONTRACT_ID_ANDA> \
  --source admin \
  --network testnet \
  -- \
  initialize \
  --admin $(soroban keys address admin) \
  --token_id <NATIVE_ASSET_CONTRACT_ID> \
  --target_amount 50000000000 \
  --duration_seconds 604800
```

### Parameter Initialize:

| Parameter | Contoh | Keterangan |
|-----------|--------|------------|
| `admin` | Alamat G... | Public key pembuat kampanye |
| `token_id` | Alamat C... | Contract ID XLM Native Asset |
| `target_amount` | `50000000000` | 5000 XLM (1 XLM = 10^7 stroops) |
| `duration_seconds` | `604800` | 7 hari (7 × 24 × 3600) |

---

## 🖥️ Langkah 5 — Konfigurasi Frontend

Edit file `frontend/index.js` dan ganti nilai `CONTRACT_ID`:

```javascript
const CONFIG = {
    // ⚠️ Ganti dengan Contract ID hasil deploy Anda
    CONTRACT_ID: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    
    NETWORK_PASSPHRASE: Networks.TESTNET,
    RPC_URL: "https://soroban-testnet.stellar.org",
    HORIZON_URL: "https://horizon-testnet.stellar.org",
    STROOPS_PER_XLM: 10_000_000n,
};
```

---

## 🌐 Langkah 6 — Jalankan Frontend

Frontend ini adalah file statis. Jalankan menggunakan server lokal:

```bash
# Opsi 1: npx serve (direkomendasikan)
cd frontend
npx serve .

# Opsi 2: Python HTTP server
cd frontend
python -m http.server 8080

# Opsi 3: VS Code Live Server
# Klik kanan index.html → Open with Live Server
```

Buka browser: **http://localhost:3000** (atau port yang ditampilkan)

---

## 📋 Referensi Perintah Soroban CLI

### Cek Status Kampanye

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  get_status
```

### Donasi Manual (tanpa frontend)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source donor-keypair \
  --network testnet \
  -- \
  donate \
  --donor <ALAMAT_DONOR> \
  --amount 10000000
```

### Withdraw (Admin)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source admin \
  --network testnet \
  -- \
  withdraw
```

### Refund (Donor)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source donor-keypair \
  --network testnet \
  -- \
  refund \
  --donor <ALAMAT_DONOR>
```

### Cek Donasi Per Alamat

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- \
  get_donor_amount \
  --donor <ALAMAT>
```

---

## 🧪 Jalankan Unit Tests

```bash
# Dari direktori kontrak
cd contracts/donasi-komunitas
cargo test

# Dengan output verbose
cargo test -- --nocapture
```

---

## 🔍 Konversi Satuan

| XLM | Stroops |
|-----|---------|
| 1 XLM | 10,000,000 |
| 10 XLM | 100,000,000 |
| 100 XLM | 1,000,000,000 |
| 1000 XLM | 10,000,000,000 |
| 5000 XLM | 50,000,000,000 |

---

## 🌐 RPC Endpoints Stellar Testnet

| Endpoint | URL |
|----------|-----|
| Soroban RPC | https://soroban-testnet.stellar.org |
| Horizon | https://horizon-testnet.stellar.org |
| Explorer | https://stellar.expert/explorer/testnet |
| Friendbot | https://friendbot.stellar.org |

---

## 📖 Resources

- [Soroban Docs](https://soroban.stellar.org/docs)
- [Stellar SDK JS](https://stellar.github.io/js-stellar-sdk/)
- [Freighter API Docs](https://docs.freighter.app/)
- [Stellar Lab (Testnet)](https://laboratory.stellar.org/#account-creator?network=test)
