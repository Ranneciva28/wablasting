# wablasting — SaaS workspace

Aplikasi SaaS WhatsApp berbasis **Baileys**, dengan landing page, dashboard pelanggan, paket, langganan transfer manual, tim, dan admin platform. v0.3.0 menargetkan **penjualan pilot satu server**. Deployment website, SMTP, rekening pembayaran, dan pengujian WhatsApp nyata harus dikonfigurasi oleh operator sebelum menerima pelanggan.

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

## Setup awal lewat browser

Dari folder repository, jalankan `bash scripts/setup.sh`. Installer hanya menyiapkan dependensi dan konfigurasi teknis; tidak menanyakan identitas bisnis, email, SMTP, atau rekening. `.env` ditulis secara atomik dengan permission 0600, konfigurasi lama dibackup, kunci enkripsi dipertahankan, dan volume tidak dihapus.

Di akhir instalasi muncul **tautan setup pribadi**, berlaku 24 jam. Buka tautan itu melalui browser untuk membuat akun admin. SMTP belum diperlukan. Setelah masuk, pilih **Pengaturan platform** untuk mengisi brand, identitas bisnis, email bantuan, SMTP, rekening pembayaran, harga paket dan pilihan registrasi publik. Semua boleh diselesaikan bertahap; perubahan langsung berlaku tanpa restart. Password SMTP tersimpan terenkripsi dan tidak dikirim kembali ke browser.

Jika perlu menampilkan kembali tautan setup, jalankan:

```sh
sudo docker compose exec -T app node scripts/setup-link.js
```

Tautan memakai kunci acak yang hanya tersedia dari server. Pengunjung umum tidak dapat mengklaim admin. Setelah admin ada, setup awal ditutup; akun admin dari instalasi lama tetap berlaku. Jika memilih email akun yang sudah ada saat setup, password akun tersebut harus cocok.

Registrasi pelanggan produksi ditahan sampai pengelola menyelesaikan setup admin dan melengkapi identitas, SMTP/email pengirim, serta instruksi pembayaran. Admin tetap dapat masuk dan mengatur aplikasi tanpa SMTP. Invoice baru tidak dapat dibuat sebelum identitas dan instruksi pembayaran lengkap.

Installer tidak mengubah DNS, SSL, reverse proxy atau website lain. Default domain: `https://whapi.avicennarabama.com`. Jika volume lama ada tetapi kunci enkripsi hilang, pulihkan kunci dari backup sebelum melanjutkan.

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

Isi `SESSION_ENCRYPTION_KEY` dengan hasilnya. `ADMIN_EMAILS` bersifat opsional untuk kompatibilitas instalasi lama. Harga default hanya contoh; ubah melalui Pengaturan platform sebelum menjual.

```sh
npm start
```

Buka http://127.0.0.1:3000 untuk landing page. Untuk admin pertama, jalankan `node --env-file-if-exists=.env scripts/setup-link.js`, lalu buka tautan setup pribadi yang muncul. Buat akun di browser dan lanjutkan ke Pengaturan platform.

Untuk pengujian akun pelanggan lokal tanpa SMTP, email verifikasi dapat dilihat melalui:

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
2. Konfigurasi teknis minimum: `SESSION_ENCRYPTION_KEY`, `NODE_ENV=production`, `APP_URL=https://wa.domainmu.com`, dan `COOKIE_SECURE=true`. Detail bisnis, SMTP dan rekening dapat diisi belakangan melalui panel. Installer mengisi nilai teknis ini otomatis.
3. Set `TRUST_PROXY` hanya ke IP/CIDR reverse proxy yang benar; proxy harus menimpa X-Forwarded-For. Jangan memakai `true` atau daftar proxy publik.
4. Atur DNS, HTTPS, dan reverse proxy hosting panel ke port host aplikasi; setup baru memakai `127.0.0.1:3101` (`APP_HOST_PORT=3101`). Port di dalam container tetap 3000. Instalasi lama tanpa `APP_HOST_PORT` tetap memakai host port 3000. Contoh Nginx ada di `deploy/nginx.conf`.

```sh
docker compose up -d --build
docker compose exec app node scripts/preflight.js
docker compose logs --tail=100 app
```

Image berjalan non-root, port hanya dibuka di loopback host, dan database tersimpan di volume `app-data`. SMTP produksi memerlukan TLS; URI-encode karakter khusus pada username/password URL SMTP. Healthcheck database tersedia di `/health/ready`; ini bukan bukti bahwa WhatsApp dan SMTP bisa diakses. `preflight` memeriksa integritas database dan status konfigurasi tanpa mewajibkan SMTP. Gunakan `node scripts/preflight.js --smtp` untuk menguji koneksi SMTP, atau tombol **Kirim email tes ke akun saya** di panel untuk menguji pengiriman. SMTP tidak aktif tidak menghalangi boot aplikasi.

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

### Jika host port 3000 sudah dipakai

Tidak perlu mematikan layanan lain. Ubah/tambahkan `APP_HOST_PORT=3101` di `.env`, lalu jalankan `docker compose up -d --build`. Reverse proxy harus diarahkan ke `http://127.0.0.1:3101`. Jika 3101 juga dipakai, pilih port host lain. Installer memeriksa health dari dalam container dan menampilkan alamat host yang benar.

### Setup/login menampilkan respons kosong atau 503

Halaman health yang normal hanya membuktikan GET dapat diteruskan. Cek POST tanpa memakai kredensial asli:

```sh
sudo docker compose exec -T app node scripts/diagnose-proxy.js
```

Diagnostik mengirim kunci uji yang sengaja tidak valid. Respons POST yang diharapkan adalah HTTP 403 JSON dari aplikasi, bukan sukses pembuatan akun. Bandingkan bagian internal dan public. Jika internal merespons tetapi domain 503/timeout/bukan JSON, periksa reverse proxy/CDN dan log OpenLiteSpeed. Tidak perlu menghapus database atau mengulangi registrasi. Halaman setup juga memeriksa ulang status admin setelah respons hilang agar akun yang sudah dibuat tetap diarahkan ke login.
