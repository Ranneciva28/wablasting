-- =====================================================================
-- WABlast — skema database lengkap (SQLite)
-- =====================================================================
-- File ini adalah gambaran utuh database WABlast dalam satu tempat,
-- dikelompokkan per fungsi. Isinya identik dengan hasil migrasi di
-- src/store.js; test/schema.test.js gagal kalau keduanya berbeda.
--
-- Aplikasi membuat dan memigrasi database ini sendiri saat start
-- (data/app.sqlite). File ini tidak perlu dijalankan manual. Gunakan
-- untuk memahami struktur, membuat database kosong untuk keperluan
-- lain, atau sebagai acuan saat menulis migrasi baru.
--
-- Konvensi:
--   * ID berupa UUID teks, kecuali disebut lain.
--   * Semua waktu disimpan sebagai epoch milidetik (INTEGER),
--     contoh 1763622000000 = 20 Nov 2026 14:00 WIB.
--   * Nomor telepon tanpa tanda +, format internasional: 628123456789.
--   * Uang dalam rupiah penuh (INTEGER), tanpa desimal.
--   * Boolean disimpan 0/1.
--   * ID workspace = ID user pemiliknya (owner). Karena itu beberapa
--     kolom bernama "user" sebenarnya berisi ID workspace; ditandai
--     di komentar kolom.
--   * Kolom bertanda [terenkripsi] disimpan AES-256-GCM memakai
--     SESSION_ENCRYPTION_KEY; tanpa kunci itu isinya tidak terbaca.
-- =====================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;


-- ---------------------------------------------------------------------
-- 1. AKUN & LOGIN
-- ---------------------------------------------------------------------

-- Akun orang yang bisa login (owner, anggota tim, atau admin platform).
CREATE TABLE users (
  id        TEXT PRIMARY KEY,                -- UUID akun
  email     TEXT UNIQUE,                     -- email login, huruf kecil
  password  TEXT NOT NULL,                   -- hash scrypt + salt, bukan password asli
  verified  INTEGER NOT NULL DEFAULT 0       -- 1 = email sudah diverifikasi
);

-- Sesi login di browser. Dihapus otomatis setelah kedaluwarsa.
CREATE TABLE sessions (
  token    TEXT PRIMARY KEY,                 -- hash SHA-256 dari cookie sesi
  user     TEXT REFERENCES users (id),       -- akun yang login
  expires  INTEGER NOT NULL                  -- waktu sesi berakhir
);

-- Token sekali pakai yang dikirim lewat email.
CREATE TABLE tokens (
  hash     TEXT PRIMARY KEY,                 -- hash SHA-256 dari token di tautan
  user     TEXT REFERENCES users (id),
  kind     TEXT NOT NULL,                    -- 'verify' (verifikasi email) | 'reset' (reset password)
  expires  INTEGER NOT NULL
);


-- ---------------------------------------------------------------------
-- 2. WORKSPACE, TIM & LANGGANAN
-- ---------------------------------------------------------------------

-- Satu bisnis pelanggan. Dibuat saat owner mendaftar.
CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY REFERENCES users (id),  -- = ID user owner
  name          TEXT NOT NULL,                           -- nama bisnis
  plan          TEXT NOT NULL DEFAULT 'trial',           -- 'trial' | 'starter' | 'growth' | 'business'
  status        TEXT NOT NULL DEFAULT 'active',          -- 'active' | 'suspended' (dinonaktifkan admin)
  period_start  INTEGER NOT NULL,                        -- awal periode paket berjalan
  period_end    INTEGER NOT NULL,                        -- akhir periode; lewat dari ini paket tidak aktif
  created       INTEGER NOT NULL
);

-- Siapa saja anggota workspace dan perannya.
CREATE TABLE members (
  workspace  TEXT REFERENCES workspaces (id),
  user       TEXT REFERENCES users (id),
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator')),
  PRIMARY KEY (workspace, user)
);

-- Undangan anggota yang belum diterima. Dihapus setelah diterima/kedaluwarsa.
CREATE TABLE invites (
  hash       TEXT PRIMARY KEY,               -- hash SHA-256 dari token di tautan undangan
  workspace  TEXT REFERENCES workspaces (id),
  email      TEXT NOT NULL,                  -- email yang diundang
  role       TEXT NOT NULL,                  -- 'admin' | 'operator'
  expires    INTEGER NOT NULL
);

-- Kuota terpakai per periode paket. Bertambah saat campaign dibuat.
CREATE TABLE usage (
  workspace     TEXT REFERENCES workspaces (id),
  period_start  INTEGER,                     -- = workspaces.period_start periode tsb
  amount        INTEGER NOT NULL DEFAULT 0,  -- jumlah penerima yang sudah dipesan
  PRIMARY KEY (workspace, period_start)
);

-- Tagihan paket (transfer bank manual, diverifikasi admin platform).
CREATE TABLE invoices (
  id         TEXT PRIMARY KEY,               -- UUID, dicantumkan di berita transfer
  workspace  TEXT REFERENCES workspaces (id),
  plan       TEXT NOT NULL,                  -- paket yang dibeli: 'starter' | 'growth' | 'business'
  amount     INTEGER NOT NULL,               -- nominal rupiah, dikunci saat invoice dibuat
  status     TEXT NOT NULL,                  -- 'pending'   menunggu transfer
                                             -- 'review'    pelanggan sudah konfirmasi, menunggu admin
                                             -- 'paid'      disetujui admin, paket aktif
                                             -- 'rejected'  ditolak admin
                                             -- 'cancelled' dibatalkan
                                             -- 'expired'   lewat batas bayar
  created    INTEGER NOT NULL,
  expires    INTEGER NOT NULL,               -- batas bayar
  paid       INTEGER,                        -- waktu disetujui (NULL bila belum)
  reference  TEXT                            -- referensi transfer dari pelanggan/admin
);


-- ---------------------------------------------------------------------
-- 3. KONTAK & PERSETUJUAN
-- ---------------------------------------------------------------------

-- Daftar penerima milik workspace.
CREATE TABLE contacts (
  id     TEXT PRIMARY KEY,
  user   TEXT REFERENCES users (id),         -- ID WORKSPACE (bukan user yang input)
  name   TEXT,                               -- nama untuk {{nama}} di pesan
  phone  TEXT,                               -- 628123456789
  optin  INTEGER DEFAULT 0,                  -- 1 = boleh dikirimi; 0 = opt-out
  UNIQUE (user, phone)
);

-- Bukti persetujuan tiap nomor (dari mana izin didapat).
CREATE TABLE consent (
  workspace  TEXT,                           -- ID workspace
  phone      TEXT,
  source     TEXT NOT NULL,                  -- contoh: "Form member toko, 15 Nov 2026"
  created    INTEGER NOT NULL,
  PRIMARY KEY (workspace, phone)
);

-- Nomor yang tidak boleh dikirimi lagi (balas STOP/BERHENTI/UNSUBSCRIBE
-- atau ditambahkan manual). Dicek ulang tepat sebelum tiap pengiriman.
CREATE TABLE suppressions (
  workspace  TEXT REFERENCES workspaces (id),
  phone      TEXT,
  created    INTEGER NOT NULL,
  PRIMARY KEY (workspace, phone)
);


-- ---------------------------------------------------------------------
-- 4. PESAN: TEMPLATE, CAMPAIGN & PENGIRIMAN
-- ---------------------------------------------------------------------

-- Pesan siap pakai.
CREATE TABLE templates (
  id         TEXT PRIMARY KEY,
  workspace  TEXT REFERENCES workspaces (id),
  name       TEXT NOT NULL,
  message    TEXT NOT NULL                   -- boleh berisi {{nama}}
);

-- Satu kali kirim massal.
CREATE TABLE campaigns (
  id            TEXT PRIMARY KEY,
  user          TEXT REFERENCES users (id),  -- ID WORKSPACE (bukan user pembuat)
  name          TEXT,
  message       TEXT,                        -- isi pesan, {{nama}} diganti per penerima
  status        TEXT DEFAULT 'queued',       -- 'queued'    antre / menunggu jadwal
                                             -- 'running'   sedang mengirim
                                             -- 'paused'    dijeda (manual atau karena error)
                                             -- 'completed' semua penerima diproses
                                             -- 'cancelled' dibatalkan
  created       INTEGER,
  scheduled     INTEGER,                     -- waktu mulai kirim; NULL = segera
  request_key   TEXT,                        -- Idempotency-Key dari browser, cegah campaign dobel
  request_hash  TEXT                         -- hash isi request untuk key yang sama
);

-- Satu baris per penerima campaign. Worker mengirim satu per satu.
CREATE TABLE deliveries (
  id        TEXT PRIMARY KEY,
  campaign  TEXT REFERENCES campaigns (id),
  phone     TEXT,
  name      TEXT,                            -- nama saat campaign dibuat
  status    TEXT DEFAULT 'pending',          -- 'pending'  antre
                                             -- 'sending'  sedang dikirim
                                             -- 'sent'     diterima server WhatsApp
                                             -- 'unknown'  hasil tidak pasti, TIDAK diulang otomatis
                                             -- 'skipped'  dilewati (opt-out / kontak dihapus)
  error     TEXT,                            -- alasan bila unknown/skipped
  waid      TEXT                             -- ID pesan dari WhatsApp bila terkirim
);


-- ---------------------------------------------------------------------
-- 5. KONEKSI WHATSAPP
-- ---------------------------------------------------------------------

-- Kredensial & kunci Signal sesi Baileys, satu set per workspace.
-- Dihapus saat WhatsApp diputus atau logout dari HP.
CREATE TABLE auth (
  user   TEXT,                               -- ID WORKSPACE
  key    TEXT,                               -- nama kunci Baileys, mis. 'creds'
  value  TEXT,                               -- [terenkripsi] JSON
  PRIMARY KEY (user, key)
);


-- ---------------------------------------------------------------------
-- 6. PLATFORM (pengelola layanan)
-- ---------------------------------------------------------------------

-- Akun yang bisa membuka menu Admin platform.
CREATE TABLE platform_admins (
  user  TEXT PRIMARY KEY REFERENCES users (id)
);

-- Pengaturan dari panel: brand, SMTP, rekening, harga. Selalu 1 baris.
CREATE TABLE platform_settings (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  payload  TEXT NOT NULL                     -- [terenkripsi] JSON
);

-- Tautan setup admin pertama. Dihapus setelah admin dibuat.
CREATE TABLE bootstrap (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  hash     TEXT NOT NULL,                    -- hash token tautan /setup
  expires  INTEGER NOT NULL
);


-- ---------------------------------------------------------------------
-- 7. SISTEM: EMAIL, AUDIT & VERSI SKEMA
-- ---------------------------------------------------------------------

-- Antrean email keluar (verifikasi, reset, undangan). Dicoba ulang
-- maksimal 7 kali; yang sent/failed dibersihkan berkala.
CREATE TABLE mail (
  id            TEXT PRIMARY KEY,
  payload       TEXT NOT NULL,               -- [terenkripsi] {to, subject, text}; dikosongkan setelah terkirim
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'sent' | 'failed'
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt  INTEGER NOT NULL,            -- kapan dicoba lagi
  created       INTEGER NOT NULL
);

-- Catatan aktivitas penting (siapa melakukan apa).
CREATE TABLE audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace  TEXT,                           -- ID workspace (NULL untuk aksi platform)
  actor      TEXT,                           -- ID user pelaku (NULL bila sistem)
  action     TEXT NOT NULL,                  -- mis. 'campaign.created', 'contacts.imported'
  detail     TEXT NOT NULL,                  -- JSON tambahan, mis. {"count":240}
  created    INTEGER NOT NULL
);

-- Migrasi yang sudah dijalankan oleh src/store.js.
CREATE TABLE schema_migrations (
  version  INTEGER PRIMARY KEY,
  applied  INTEGER NOT NULL
);


-- ---------------------------------------------------------------------
-- INDEX
-- ---------------------------------------------------------------------

-- Cegah campaign dobel saat tombol diklik dua kali.
CREATE UNIQUE INDEX campaigns_request_key ON campaigns (user, request_key)
  WHERE request_key IS NOT NULL;
CREATE INDEX contacts_owner   ON contacts   (user, name);         -- daftar kontak urut nama
CREATE INDEX campaigns_owner  ON campaigns  (user, created);      -- riwayat campaign
CREATE INDEX deliveries_queue ON deliveries (campaign, status);   -- worker cari penerima 'pending'
CREATE INDEX sessions_expiry  ON sessions   (expires);            -- bersih-bersih sesi lama
CREATE INDEX audit_workspace  ON audit      (workspace, created);
CREATE INDEX tokens_user      ON tokens     (user, kind);
CREATE INDEX mail_pending     ON mail       (status, next_attempt);


-- ---------------------------------------------------------------------
-- Tandai skema ini setara migrasi 1–3, supaya aplikasi tidak menjalankan
-- ulang migrasi bila database dibuat dari file ini.
-- ---------------------------------------------------------------------
INSERT INTO schema_migrations (version, applied) VALUES
  (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  (2, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  (3, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
