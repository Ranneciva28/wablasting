# wablasting — SaaS workspace

Aplikasi SaaS WhatsApp berbasis **Baileys**, dengan landing page, dashboard pelanggan, paket, langganan transfer manual, tim, dan admin platform. v0.2.0 menargetkan **penjualan pilot satu server**. Deployment website, SMTP, rekening pembayaran, dan pengujian WhatsApp nyata harus dikonfigurasi oleh operator sebelum menerima pelanggan.

## Yang sudah tersedia

- Landing page, harga dari konfigurasi, trial 7 hari, halaman ketentuan dan privasi, branding/domain sendiri.
- Registrasi, verifikasi email satu kali, reset/ganti password, pencabutan semua sesi saat reset/ganti password. Token hanya disimpan sebagai hash; email memakai antrean terenkripsi dengan retry SMTP.
- Workspace terisolasi, undangan tim melalui email, role owner/admin/operator, pencabutan anggota langsung berlaku untuk request selanjutnya.
- Satu sesi WhatsApp per workspace, QR Baileys, enkripsi AES-256-GCM untuk kredensial/Signal keys, restore sesi aktif setelah restart.
- Kontak, impor CSV atomik, catatan sumber persetujuan, daftar opt-out, penanganan balasan STOP/BERHENTI/UNSUBSCRIBE dari nomor yang bisa diidentifikasi.
- Template, personalisasi `{{nama}}`, jadwal maksimal 30 hari, antrean persisten, pause/resume/cancel, status per penerima, pagination, dan idempotency key dengan pemeriksaan payload.
- Batas kontak, anggota, ukuran campaign, periode aktif dan kuota ditegakkan di server. Reservasi kuota dilakukan atomik bersama pembuatan campaign.
- Invoice transfer manual, nominal disimpan sebagai snapshot, konfirmasi pelanggan berstatus review, persetujuan admin idempotent, masa aktif 30 hari, suspend workspace.
- Audit, ekspor JSON, penghapusan data operasional, health endpoints, backup SQLite online, Docker non-root, CI.

**Billing saat ini transfer manual.** Tidak ada payment gateway atau auto-debit yang berpura-pura aktif. Pelanggan tidak bisa mengaktifkan paketnya sendiri. Renewal hanya setelah periode berbayar berakhir; sisa kuota tidak dibawa. Aktivasi periode baru membatalkan campaign tertunda dari periode lama.

## Mulai lokal — Node.js 24

```sh
git clone https://github.com/Ranneciva28/wablasting.git
cd wablasting
npm ci
```

Salin `.env.example` ke `.env`: PowerShell `Copy-Item .env.example .env`; macOS/Linux `cp .env.example .env`.

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Isi `SESSION_ENCRYPTION_KEY` dengan hasilnya. Isi `ADMIN_EMAILS` dengan email akun pengelola. Harga default hanya contoh: atur `PRICE_STARTER`, `PRICE_GROWTH`, `PRICE_BUSINESS` sebelum menjual.

```sh
npm start
```

Buka http://127.0.0.1:3000 untuk landing page, `/app` untuk dashboard. Daftar dan setujui ketentuan. Jika SMTP belum dikonfigurasi di lokal, lihat email verifikasi di terminal terpisah:

```sh
npm run mail:local
```

Perintah tersebut hanya tersedia tanpa SMTP di lingkungan non-production. Tautan tidak dikirimkan ke browser API atau log server. Jika port/host berubah, sesuaikan `APP_URL`.

Setelah verifikasi: Hubungkan WhatsApp → scan QR di HP → impor/tambah kontak yang menyetujui pesan → pilih kontak → buat campaign. Untuk mencoba billing: atur instruksi transfer, buat invoice dari akun pelanggan, lalu masuk dengan akun admin terverifikasi untuk meninjau dan menyetujui.

## Paket awal (bisa ganti harga melalui environment)

| Paket    | Harga contoh / periode |  Durasi | Kuota penerima | Kontak | Anggota | Penerima / campaign |
| -------- | ---------------------: | ------: | -------------: | -----: | ------: | ------------------: |
| Trial    |                 Gratis |  7 hari |             50 |    100 |       1 |                  50 |
| Starter  |               Rp99.000 | 30 hari |          1.000 |  1.000 |       1 |                 100 |
| Growth   |              Rp249.000 | 30 hari |          5.000 |  5.000 |       3 |                 250 |
| Business |              Rp499.000 | 30 hari |         15.000 | 15.000 |       5 |                 500 |

Semua paket memiliki 1 nomor WhatsApp/workspace. Trial dimulai saat registrasi, bukan saat scan QR. Kuota dihitung per penerima unik ketika campaign dibuat, termasuk campaign yang nantinya dibatalkan, dilewati atau gagal. Penghapusan data tidak me-reset kuota.

## Deploy di website sendiri

Gunakan **subdomain khusus** seperti `wa.domainmu.com`, dengan reverse proxy HTTPS ke aplikasi. Instalasi di subpath seperti `/wa` belum didukung. Tidak perlu mengubah website utama.

1. Clone repo di server, buat `.env`, isi kunci dan konfigurasi produksi.
2. Set `NODE_ENV=production`, `APP_URL=https://wa.domainmu.com`, `COOKIE_SECURE=true`, `ADMIN_EMAILS`, `SMTP_URL`, `MAIL_FROM`, `BUSINESS_NAME`, `SUPPORT_EMAIL`, dan `PAYMENT_INSTRUCTIONS`. Server menolak boot production jika salah satu belum tersedia.
3. Set `TRUST_PROXY` hanya ke IP/CIDR reverse proxy yang benar; proxy harus menimpa X-Forwarded-For. Jangan memakai `true` atau daftar proxy publik.
4. Atur DNS, HTTPS, dan reverse proxy hosting panel ke `127.0.0.1:3000`; contoh Nginx ada di `deploy/nginx.conf`.

```sh
docker compose up -d --build
docker compose exec app node scripts/preflight.js
docker compose logs --tail=100 app
```

Image berjalan non-root, port hanya dibuka di loopback host, dan database tersimpan di volume `app-data`. SMTP produksi memerlukan TLS; URI-encode karakter khusus pada username/password URL SMTP. Healthcheck database tersedia di `/health/ready`; ini bukan bukti bahwa WhatsApp dan SMTP bisa diakses. `preflight` menguji koneksi SMTP dan integritas database.

**Jalankan satu instance/replica.** SQLite + worker lokal sengaja dibatasi untuk deployment satu server; process lock menolak worker kedua pada folder data yang sama. Jangan menggunakan PM2 cluster atau beberapa replica. Kapasitas tenant perlu diukur dengan load test pada VPS target sebelum menetapkan batas penjualan. Horizontal scaling memerlukan Postgres/queue terdistribusi dan ownership sesi per worker.

## Operasional dan backup

```sh
# Lokal, aplikasi boleh tetap berjalan
npm run backup -- /absolute/path/backup.sqlite
# Container
 docker compose exec app node scripts/backup.js /app/data/backup.sqlite
 docker compose cp app:/app/data/backup.sqlite ./backup.sqlite
```

Backup menyimpan data pribadi: simpan di storage privat terenkripsi, pisahkan kunci `SESSION_ENCRYPTION_KEY`, dan terapkan rotasi backup. Restore harus dilakukan saat aplikasi berhenti. Jangan menyalin file SQLite aktif secara mentah karena WAL.

Saat proses berhenti, worker diberi waktu menyelesaikan pengiriman in-flight. Jika hasil tetap tidak pasti, status menjadi `unknown` pada recovery dan tidak diulang otomatis. Campaign yang sedang berjalan dijeda setelah restart, campaign berjadwal yang masih queued tetap tersimpan. Pemilik harus memeriksa `unknown` secara manual sebelum membuat pengiriman baru.

Lihat [panduan operasi](docs/OPERATIONS.md) dan [matriks akses serta API](docs/ARCHITECTURE.md).

## Validasi

```sh
npm run check
npm test
npm audit --omit=dev
```

Tes mencakup isolasi tenant, role tim, verifikasi/reset sekali pakai, revokasi sesi, origin/CSRF, impor CSV atomik, opt-out, pembayaran manual dengan jumlah yang ditentukan server, persetujuan idempotent, periode/kuota, queue recovery, dan hasil pengiriman ambigu. Tes worker menggunakan transport mock; tidak ada pesan nyata dikirim oleh tes otomatis.

## Batas yang perlu dipahami

Baileys adalah **klien unofficial** dan tidak terafiliasi WhatsApp/Meta. Tidak ada jaminan anti-ban atau ketersediaan protokol. `sent` berarti Baileys mengembalikan message ID, bukan konfirmasi penerima membaca/menerima. `unknown` memerlukan pemeriksaan manual. Opt-out diproses saat event masuk diterima dan nomor bisa diidentifikasi; pengelola dapat menambahkan nomor secara manual jika tidak teridentifikasi.

Belum ada integrasi payment gateway, multi-nomor per workspace, lampiran media, inbox percakapan, ataupun horizontal scaling. Deployment domain dan pengujian QR/pengiriman nyata memerlukan akses server serta HP milik pengelola. Halaman ketentuan/privasi mendeskripsikan perilaku aplikasi; identitas bisnis, prosedur sengketa/refund, dan retensi backup harus disesuaikan dengan operasi penjual.

Referensi engine: https://github.com/WhiskeySockets/Baileys dan https://baileys.wiki/ . Email: https://nodemailer.com/smtp .
