# Arsitektur dan kontrol akses

## Deployment

Express + Node.js 24, SQLite WAL, worker lokal, Baileys per workspace, SMTP outbox. Skema v0.1 dimigrasikan secara transaksional dan bertahap saat boot. Backup sebelum upgrade. Akun lama mendapat trial 7 hari saat migrasi dan harus memverifikasi email sebelum menghubungkan WhatsApp/membuat campaign.

ID workspace adalah ID user pembuatnya untuk mempertahankan relasi v0.1. Setiap akun memiliki satu workspace sendiri dan dapat menjadi anggota workspace lain. Kolom `user` pada tabel kontak/campaign/auth lama berarti **workspace ID**, bukan pengguna yang sedang login. Role selalu dicari ulang dari tabel anggota pada setiap request; client tidak menentukan role.

## Akses

| Tindakan                         | Owner | Admin workspace | Operator | Admin platform                |
| -------------------------------- | ----- | --------------- | -------- | ----------------------------- |
| Kontak, template, campaign       | Ya    | Ya              | Ya       | Hanya jika anggota workspace  |
| Hubungkan/putus WhatsApp         | Ya    | Ya              | Tidak    | Hanya jika anggota workspace  |
| Profil bisnis, audit, daftar tim | Ya    | Ya              | Tidak    | Hanya jika anggota workspace  |
| Undang, hapus, ubah role anggota | Ya    | Tidak           | Tidak    | Hanya jika owner workspace    |
| Baca paket/invoice               | Ya    | Ya              | Ya       | Ya melalui ringkasan platform |
| Buat/konfirmasi/batalkan invoice | Ya    | Tidak           | Tidak    | Hanya jika owner workspace    |
| Ekspor/hapus data operasional    | Ya    | Tidak           | Tidak    | Hanya jika owner workspace    |
| Setujui invoice, suspend bisnis  | Tidak | Tidak           | Tidak    | Ya                            |

Admin platform ditentukan oleh email dalam konfigurasi server **dan** status email terverifikasi. Mengirim properti `superAdmin`, `role`, `amount` atau `plan` dari klien tidak memberikan hak/aktivasi.

## API

Semua mutasi perlu `X-Requested-With: wablasting`. Jika header Origin ada, origin harus sama dengan `APP_URL`. Cookie HttpOnly SameSite=Strict mengautentikasi request. `X-Workspace-Id` memilih workspace, kemudian membership diverifikasi; default workspace milik akun sendiri.

- Publik: `GET /api/public`, `/health/live`, `/health/ready`.
- Auth: `POST /api/auth/{register,login,forgot,reset,verify}`.
- Akun: `GET /api/me`, `POST /api/logout`, `/api/account/{verify,password}`.
- Workspace: `GET/PATCH /api/workspace`, `DELETE /api/workspace/data`, `GET /api/export`.
- WhatsApp: `GET /api/whatsapp`, `POST /api/whatsapp/{connect,disconnect}`.
- Kontak: `GET/POST /api/contacts`, `POST /api/contacts/import`, `DELETE /api/contacts/:id`.
- Opt-out: `GET/POST /api/suppressions`, `DELETE /api/suppressions/:phone` dengan sumber persetujuan baru.
- Template: `GET/POST /api/templates`, `DELETE /api/templates/:id`.
- Campaign: `GET/POST /api/campaigns`, `GET /api/campaigns/:id`, `POST /api/campaigns/:id/{pause,resume,cancel}`.
- Tim: `GET /api/team`, `POST /api/team/invite`, `PATCH/DELETE /api/team/:id`, `DELETE /api/team/invites/:email`, `POST /api/invites/accept`.
- Billing: `GET /api/billing`, `POST /api/billing/invoices`, `POST /api/billing/invoices/:id/{confirm,cancel}`.
- Admin: `GET /api/admin/overview`, `POST /api/admin/invoices/:id/{approve,reject}`, `POST /api/admin/workspaces/:id/status`.
- Audit: `GET /api/audit`.

Pagination memakai `?offset=`. Kontak, opt-out, audit dan detail penerima: 100 item; campaign: 50. Ekspor JSON hanya untuk owner. Tidak ada API key publik; endpoint di atas ditujukan untuk dashboard first-party.

`POST /api/campaigns` memerlukan `Idempotency-Key` unik 8–100 karakter. Payload sama + key sama mengembalikan campaign lama tanpa memesan kuota ulang; payload berbeda ditolak. Request harus tetap berasal dari anggota terverifikasi dengan paket aktif.

## Pengiriman dan kuota

Pembuatan campaign + penerima + reservasi kuota berada dalam transaksi SQLite yang sama. Kontak opt-out diabaikan saat pengiriman, tidak hanya saat campaign dibuat. Penerima unik ditentukan dari ID kontak dan nomor unik per workspace. Satu campaign aktif per workspace ditegakkan saat create.

Worker memproses satu penerima per workspace tiap siklus dan berjalan paralel antar-workspace; satu socket lambat tidak menahan tenant lain. Tidak ada distributed queue. Timeout, putus koneksi, atau restart saat send dapat menghasilkan `unknown`; tidak ada klaim exactly-once pada jaringan WhatsApp. Idempotency mencegah pembuatan campaign ganda, bukan bukti delivery ke perangkat penerima.

Recovery menjeda campaign running, mempertahankan queued berjadwal, dan menandai sending sebagai unknown. Subscription expiry/suspend menghentikan tick berikutnya. Pause/cancel dapat beradu waktu dengan pesan in-flight; UI menginformasikan batas ini.

## Data sensitif

Kredensial Baileys dan payload email outbox dienkripsi AES-256-GCM dengan nonce acak per nilai. Password scrypt menggunakan salt per akun, token sesi/reset/verify/invite di-hash SHA-256. Kontak, teks campaign, referensi pembayaran, dan audit tersimpan sebagai data biasa di database; pengelola harus melindungi host, volume, backup dan kunci.

## Setup dan pengaturan platform

Setup awal menggunakan kunci acak 256 bit, berlaku 24 jam, disimpan di file server mode 0600 dan hash-nya di database. API publik tidak mengembalikan kunci. Bootstrap memerlukan kunci tersebut, memeriksa ulang di dalam transaksi untuk menahan klaim bersamaan, membuat admin dengan email/password yang dipilih, lalu menghapus kunci. Email akun yang sudah ada tidak dapat diambil alih: password lama harus cocok.

Admin dari bootstrap disimpan di `platform_admins`. Akun lama dengan email terverifikasi dalam `ADMIN_EMAILS` tetap dikenali. `/api/admin/settings` hanya dapat diakses admin platform; perubahan memerlukan password admin saat ini. Nilai sensitif tersimpan dalam payload AES-256-GCM dan respons API hanya memuat penanda password SMTP tersimpan, bukan password/URL kredensial.

Runtime settings diterapkan langsung ke branding, harga, SMTP dan billing tanpa restart, serta dimuat ulang dari database saat boot. SMTP transport dibuat ulang ketika konfigurasi berubah. Invoice menyimpan snapshot nominal sehingga perubahan harga tidak mengubah invoice terdahulu. Email tes hanya dikirim ke email admin yang sedang login dan memerlukan konfirmasi password. Tidak ada pengujian SMTP otomatis yang menghalangi boot.
