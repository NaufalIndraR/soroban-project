//! # DonasiKomunitas - Micro-Crowdfunding Smart Contract
//!
//! Soroban smart contract untuk penggalangan dana mikro (micro-crowdfunding)
//! di jaringan Stellar. Mendukung donasi XLM native token, penarikan dana
//! oleh admin jika target terpenuhi, dan refund jika kampanye gagal.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, log,
    Address, Env, Symbol,
};

// =============================================================================
// STORAGE KEYS
// =============================================================================

/// Kunci-kunci penyimpanan persistent di ledger Soroban
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Alamat admin (pembuat kampanye)
    Admin,
    /// Token yang diterima (XLM atau stablecoin)
    TokenId,
    /// Jumlah target donasi dalam Stroops
    TargetAmount,
    /// Timestamp deadline (Unix epoch seconds)
    Deadline,
    /// Total dana yang sudah terkumpul
    TotalFunded,
    /// Donasi per-alamat donatur: Address -> i128
    Donor(Address),
    /// Flag apakah dana sudah pernah ditarik admin
    Withdrawn,
}

// =============================================================================
// RETURN TYPES
// =============================================================================

/// Struct status kampanye yang dikembalikan oleh get_status()
#[contracttype]
#[derive(Clone)]
pub struct CampaignStatus {
    pub total_funded: i128,
    pub target_amount: i128,
    pub deadline: u64,
    pub admin: Address,
    pub is_successful: bool,
    pub is_expired: bool,
    pub is_withdrawn: bool,
}

// =============================================================================
// CONTRACT DEFINITION
// =============================================================================

#[contract]
pub struct DonasiKomunitasContract;

#[contractimpl]
impl DonasiKomunitasContract {
    // =========================================================================
    // INITIALIZE
    // =========================================================================

    /// Menginisialisasi kampanye baru.
    ///
    /// # Arguments
    /// * `admin`            - Alamat pemilik kampanye (yang berhak withdraw)
    /// * `token_id`         - Alamat kontrak token (gunakan alamat XLM native wrapper)
    /// * `target_amount`    - Target dana dalam Stroops (1 XLM = 10_000_000 stroops)
    /// * `duration_seconds` - Durasi kampanye dalam detik dari sekarang
    ///
    /// # Panics
    /// - Jika kontrak sudah pernah diinisialisasi sebelumnya
    /// - Jika target_amount <= 0
    /// - Jika duration_seconds == 0
    pub fn initialize(
        env: Env,
        admin: Address,
        token_id: Address,
        target_amount: i128,
        duration_seconds: u64,
    ) {
        // Pastikan belum pernah diinisialisasi
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }

        // Validasi parameter
        if target_amount <= 0 {
            panic!("Target amount must be positive");
        }
        if duration_seconds == 0 {
            panic!("Duration must be greater than zero");
        }

        // Admin harus mengotorisasi inisialisasi
        admin.require_auth();

        // Hitung deadline: waktu sekarang + durasi
        let now = env.ledger().timestamp();
        let deadline = now + duration_seconds;

        // Simpan semua state ke instance storage
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenId, &token_id);
        env.storage().instance().set(&DataKey::TargetAmount, &target_amount);
        env.storage().instance().set(&DataKey::Deadline, &deadline);
        env.storage().instance().set(&DataKey::TotalFunded, &0_i128);
        env.storage().instance().set(&DataKey::Withdrawn, &false);

        // Emit event inisialisasi
        env.events().publish(
            (Symbol::new(&env, "initialize"),),
            (admin, target_amount, deadline),
        );

        log!(&env, "DonasiKomunitas initialized: target={}, deadline={}", target_amount, deadline);
    }

    // =========================================================================
    // DONATE
    // =========================================================================

    /// Mengirim donasi ke kampanye.
    ///
    /// # Arguments
    /// * `donor`  - Alamat pengirim donasi (harus otorisasi)
    /// * `amount` - Jumlah yang didonasikan dalam Stroops
    ///
    /// # Panics
    /// - Jika kampanye belum diinisialisasi
    /// - Jika deadline sudah terlewati
    /// - Jika amount <= 0
    pub fn donate(env: Env, donor: Address, amount: i128) {
        // Donatur harus mengotorisasi transaksi ini
        donor.require_auth();

        // Validasi amount
        if amount <= 0 {
            panic!("Donation amount must be positive");
        }

        // Periksa apakah deadline belum terlewati
        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline)
            .expect("Contract not initialized");
        let now = env.ledger().timestamp();

        if now >= deadline {
            panic!("Campaign has ended");
        }

        // Ambil token_id dan total saat ini
        let token_id: Address = env.storage().instance().get(&DataKey::TokenId)
            .expect("Token not set");
        let mut total_funded: i128 = env.storage().instance().get(&DataKey::TotalFunded)
            .unwrap_or(0);

        // Transfer token dari donor ke kontrak ini menggunakan token client
        let token_client = token::Client::new(&env, &token_id);
        token_client.transfer(&donor, &env.current_contract_address(), &amount);

        // Update total dana terkumpul
        total_funded += amount;
        env.storage().instance().set(&DataKey::TotalFunded, &total_funded);

        // Catat donasi per-donatur (accumulate)
        let donor_key = DataKey::Donor(donor.clone());
        let prev_donation: i128 = env.storage().persistent().get(&donor_key).unwrap_or(0);
        env.storage().persistent().set(&donor_key, &(prev_donation + amount));

        // Emit event donasi
        env.events().publish(
            (Symbol::new(&env, "donate"),),
            (donor.clone(), amount, total_funded),
        );

        log!(&env, "Donated {} stroops from {}. Total: {}", amount, donor, total_funded);
    }

    // =========================================================================
    // WITHDRAW (Admin)
    // =========================================================================

    /// Admin menarik seluruh dana kampanye yang berhasil.
    ///
    /// # Kondisi
    /// - Hanya bisa dipanggil admin
    /// - `total_funded >= target_amount`
    /// - Deadline sudah terlewati
    /// - Belum pernah di-withdraw sebelumnya
    ///
    /// # Panics
    /// - Jika bukan admin yang memanggil
    /// - Jika syarat-syarat di atas tidak terpenuhi
    pub fn withdraw(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized");

        // Admin harus mengotorisasi
        admin.require_auth();

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline)
            .expect("Deadline not set");
        let target_amount: i128 = env.storage().instance().get(&DataKey::TargetAmount)
            .expect("Target not set");
        let total_funded: i128 = env.storage().instance().get(&DataKey::TotalFunded)
            .unwrap_or(0);
        let withdrawn: bool = env.storage().instance().get(&DataKey::Withdrawn)
            .unwrap_or(false);
        let now = env.ledger().timestamp();

        // Validasi kondisi withdraw
        if withdrawn {
            panic!("Already withdrawn");
        }
        if now < deadline {
            panic!("Campaign has not ended yet");
        }
        if total_funded < target_amount {
            panic!("Campaign did not reach its target");
        }

        // Tandai sudah di-withdraw
        env.storage().instance().set(&DataKey::Withdrawn, &true);

        // Transfer semua dana ke admin
        let token_id: Address = env.storage().instance().get(&DataKey::TokenId)
            .expect("Token not set");
        let token_client = token::Client::new(&env, &token_id);
        token_client.transfer(&env.current_contract_address(), &admin, &total_funded);

        // Emit event withdraw
        env.events().publish(
            (Symbol::new(&env, "withdraw"),),
            (admin.clone(), total_funded),
        );

        log!(&env, "Withdrawn {} stroops to admin {}", total_funded, admin);
    }

    // =========================================================================
    // REFUND (Donor)
    // =========================================================================

    /// Donatur meminta refund jika kampanye gagal.
    ///
    /// # Arguments
    /// * `donor` - Alamat donatur yang meminta refund
    ///
    /// # Kondisi
    /// - Deadline sudah terlewati
    /// - `total_funded < target_amount` (kampanye gagal)
    /// - Donatur memiliki donasi yang bisa di-refund
    /// - Dana belum pernah di-withdraw admin
    ///
    /// # Panics
    /// - Jika syarat-syarat di atas tidak terpenuhi
    pub fn refund(env: Env, donor: Address) {
        // Donatur harus mengotorisasi
        donor.require_auth();

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline)
            .expect("Contract not initialized");
        let target_amount: i128 = env.storage().instance().get(&DataKey::TargetAmount)
            .expect("Target not set");
        let total_funded: i128 = env.storage().instance().get(&DataKey::TotalFunded)
            .unwrap_or(0);
        let withdrawn: bool = env.storage().instance().get(&DataKey::Withdrawn)
            .unwrap_or(false);
        let now = env.ledger().timestamp();

        // Validasi: kampanye harus sudah berakhir
        if now < deadline {
            panic!("Campaign has not ended yet");
        }

        // Validasi: kampanye harus gagal (belum capai target)
        if total_funded >= target_amount {
            panic!("Campaign was successful, no refunds available");
        }

        // Validasi: dana belum di-withdraw
        if withdrawn {
            panic!("Funds already withdrawn");
        }

        // Ambil jumlah donasi dari donor ini
        let donor_key = DataKey::Donor(donor.clone());
        let donor_amount: i128 = env.storage().persistent().get(&donor_key)
            .unwrap_or(0);

        if donor_amount <= 0 {
            panic!("No donation found for this address");
        }

        // Reset donasi donor ke 0 (cegah double refund)
        env.storage().persistent().set(&donor_key, &0_i128);

        // Update total funded
        let new_total = total_funded - donor_amount;
        env.storage().instance().set(&DataKey::TotalFunded, &new_total);

        // Transfer dana kembali ke donor
        let token_id: Address = env.storage().instance().get(&DataKey::TokenId)
            .expect("Token not set");
        let token_client = token::Client::new(&env, &token_id);
        token_client.transfer(&env.current_contract_address(), &donor, &donor_amount);

        // Emit event refund
        env.events().publish(
            (Symbol::new(&env, "refund"),),
            (donor.clone(), donor_amount),
        );

        log!(&env, "Refunded {} stroops to donor {}", donor_amount, donor);
    }

    // =========================================================================
    // GET STATUS (View)
    // =========================================================================

    /// Mengembalikan status lengkap kampanye saat ini.
    ///
    /// # Returns
    /// `CampaignStatus` struct berisi semua info kampanye
    pub fn get_status(env: Env) -> CampaignStatus {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized");
        let target_amount: i128 = env.storage().instance().get(&DataKey::TargetAmount)
            .expect("Target not set");
        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline)
            .expect("Deadline not set");
        let total_funded: i128 = env.storage().instance().get(&DataKey::TotalFunded)
            .unwrap_or(0);
        let is_withdrawn: bool = env.storage().instance().get(&DataKey::Withdrawn)
            .unwrap_or(false);

        let now = env.ledger().timestamp();
        let is_expired = now >= deadline;
        let is_successful = total_funded >= target_amount;

        CampaignStatus {
            total_funded,
            target_amount,
            deadline,
            admin,
            is_successful,
            is_expired,
            is_withdrawn,
        }
    }

    // =========================================================================
    // GET DONOR AMOUNT (View)
    // =========================================================================

    /// Melihat jumlah donasi dari satu donatur tertentu.
    ///
    /// # Arguments
    /// * `donor` - Alamat donatur yang dicek
    ///
    /// # Returns
    /// Jumlah donasi dalam Stroops (0 jika tidak pernah donasi)
    pub fn get_donor_amount(env: Env, donor: Address) -> i128 {
        let donor_key = DataKey::Donor(donor);
        env.storage().persistent().get(&donor_key).unwrap_or(0)
    }
}

// =============================================================================
// UNIT TESTS
// =============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env,
    };

    /// Helper: setup environment dan deploy token mock
    fn setup() -> (Env, Address, Address, Address, DonasiKomunitasContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let donor = Address::generate(&env);

        // Deploy token kontrak (SAC - Stellar Asset Contract)
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_admin_client = StellarAssetClient::new(&env, &token_id.address());

        // Mint token ke donor untuk keperluan test
        token_admin_client.mint(&donor, &10_000_000_000_i128); // 1000 XLM

        // Deploy DonasiKomunitas contract
        let contract_id = env.register(DonasiKomunitasContract, ());
        let client = DonasiKomunitasContractClient::new(&env, &contract_id);

        (env, admin, donor, token_id.address(), client)
    }

    #[test]
    fn test_initialize() {
        let (env, admin, _, token_id, client) = setup();

        client.initialize(
            &admin,
            &token_id,
            &5_000_000_000_i128, // 500 XLM target
            &86400_u64,           // 1 hari
        );

        let status = client.get_status();
        assert_eq!(status.target_amount, 5_000_000_000_i128);
        assert_eq!(status.total_funded, 0_i128);
        assert!(!status.is_expired);
        assert!(!status.is_successful);
    }

    #[test]
    fn test_donate_success() {
        let (env, admin, donor, token_id, client) = setup();

        client.initialize(&admin, &token_id, &5_000_000_000_i128, &86400_u64);

        // Donasi 100 XLM
        client.donate(&donor, &1_000_000_000_i128);

        let status = client.get_status();
        assert_eq!(status.total_funded, 1_000_000_000_i128);

        let donor_amount = client.get_donor_amount(&donor);
        assert_eq!(donor_amount, 1_000_000_000_i128);
    }

    #[test]
    #[should_panic(expected = "Campaign has ended")]
    fn test_donate_after_deadline() {
        let (env, admin, donor, token_id, client) = setup();

        client.initialize(&admin, &token_id, &5_000_000_000_i128, &100_u64);

        // Lompat waktu melewati deadline
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp + 200;
        });

        client.donate(&donor, &1_000_000_000_i128);
    }

    #[test]
    fn test_withdraw_success() {
        let (env, admin, donor, token_id, client) = setup();

        client.initialize(&admin, &token_id, &1_000_000_000_i128, &100_u64); // Target 100 XLM

        // Donasi lebih dari target
        client.donate(&donor, &2_000_000_000_i128);

        // Lompat waktu melewati deadline
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp + 200;
        });

        // Admin tarik dana
        client.withdraw();

        let status = client.get_status();
        assert!(status.is_withdrawn);
    }

    #[test]
    fn test_refund_success() {
        let (env, admin, donor, token_id, client) = setup();

        let token_client = TokenClient::new(&env, &token_id);
        let initial_balance = token_client.balance(&donor);

        client.initialize(&admin, &token_id, &5_000_000_000_i128, &100_u64); // Target 500 XLM

        // Donasi hanya 100 XLM (tidak cukup)
        client.donate(&donor, &1_000_000_000_i128);

        // Lompat waktu melewati deadline
        env.ledger().with_mut(|li| {
            li.timestamp = li.timestamp + 200;
        });

        // Donor minta refund
        client.refund(&donor);

        // Cek saldo donor kembali ke semula
        let final_balance = token_client.balance(&donor);
        assert_eq!(final_balance, initial_balance);

        // Donasi donor kini 0
        let donor_amount = client.get_donor_amount(&donor);
        assert_eq!(donor_amount, 0_i128);
    }
}
