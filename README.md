# wablasting

Platform pengiriman pesan WhatsApp berbasis **Baileys**, dengan akun workspace dan sesi WhatsApp terpisah per pengguna. Fondasi v0.1.0 untuk pengujian lokal / pilot satu server, belum layanan SaaS produksi.

## Fitur

- Daftar dengan kode undangan, login email/password, cookie HttpOnly dengan masa berlaku 24 jam.
- Tautkan WhatsApp melalui QR; koneksi ulang dengan backoff terbatas; logout menghapus sesi WhatsApp.
- Kredensial dan Signal keys Baileys disimpan di SQLite dengan enkripsi AES-256-GCM. Password menggunakan scrypt, token sesi disimpan sebagai hash.
- Kontak yang menyetujui pesan, normalisasi nomor Indonesia/internasional, hapus kontak untuk menekan pengiriman pending.
- Campaign teks 1–100 kontak, personalisasi `{{nama}}`, satu campaign aktif per pengguna, jeda/lanjut/batal, detail tiap penerima.
- Worker satu proses, maksimal satu pengiriman per pengguna pada tiap siklus 5 detik. Interval ini pengaturan antrean, **bukan jaminan bebas pembatasan akun**.
- Saat restart, campaign aktif dijeda. Pesan in-flight ditandai `unknown` dan tidak dikirim ulang otomatis. Periksa WhatsApp untuk status tersebut.
- Dashboard responsif, Docker Compose, CI GitHub Actions.

## Menjalankan lokal

Butuh Node.js 24 dan Git. Windows PowerShell / macOS / Linux:

```sh
git clone https://github.com/Ranneciva28/wablasting.git
cd wablasting
npm ci
```

Salin `.env.example` menjadi `.env` (Windows: `Copy-Item .env.example .env`; macOS/Linux: `cp .env.example .env`). Buat kunci:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Isi `SESSION_ENCRYPTION_KEY` dengan hasil tersebut. Isi `REGISTRATION_CODE` dengan kode undangan panjang dan acak pilihanmu, lalu:

```sh
npm start
```

Buka http://127.0.0.1:3000. Buat akun dengan kode undangan → hubungkan WhatsApp → pindai QR melalui **Perangkat tertaut** di HP → tambahkan kontak → centang kontak → buat campaign.

Klik **Hubungkan WhatsApp** setelah restart untuk memuat sesi tersimpan. Tidak perlu QR ulang jika sesi masih valid. Logout workspace hanya mengakhiri akses dashboard; gunakan **Putuskan & hapus sesi** untuk mengakhiri koneksi WhatsApp dan menghapus kredensial.

## VPS / Docker

Set `.env` terlebih dahulu seperti di atas, lalu:

```sh
docker compose up -d --build
docker compose logs -f app
```

Port hanya terikat ke `127.0.0.1:3000`. Pasang reverse proxy HTTPS, kemudian set `COOKIE_SECURE=true` dan jalankan `docker compose up -d`. Jangan membuka layanan HTTP langsung ke internet. Registrasi memerlukan kode undangan, bukan registrasi publik terbuka.

Volume `app-data` menyimpan database. Backup database SQLite memakai SQLite backup API atau hentikan container sebelum menyalin volume. Simpan kunci enkripsi secara terpisah; kehilangan kunci membuat sesi WhatsApp tidak bisa dipulihkan. Jangan commit `.env`, database, QR, atau kredensial.

Jalankan **satu replica**. Database dan worker saat ini tidak mendukung beberapa instance. Untuk SaaS publik, pekerjaan lanjutan mencakup verifikasi email/reset password, pengelolaan undangan, kuota dan billing, observabilitas, automated opt-out, durable distributed queue, serta pengujian beban.

## Pengujian

```sh
npm run check
npm test
npm audit --omit=dev
```

Tes mencakup pemisahan data antar akun, penolakan request mutasi tanpa header aplikasi, login/logout, validasi nomor, personalisasi, dan penolakan campaign saat WhatsApp belum terhubung. Pengujian integrasi WhatsApp nyata memerlukan HP dan akun milik pengguna; tidak ada pesan nyata dikirim dalam tes otomatis.

`sent` berarti pemanggilan Baileys berhasil dan mengembalikan message ID, bukan konfirmasi delivery/read. `unknown` berarti hasil tidak bisa dipastikan; tidak ada retry otomatis untuk menghindari pesan ganda. Pause/cancel menghentikan pesan berikutnya; satu pesan yang sedang dikirim mungkin sudah terkirim.

## Engine & batasan

Versi dipin ke `@whiskeysockets/baileys@7.0.0-rc14` beserta lockfile. Ini release candidate: uji login dan pengiriman di lingkungan pilot sebelum penggunaan operasional. Tidak ada browser automation, WhatsApp Cloud API, scraping nomor, atau rotasi akun.

Baileys merupakan klien **unofficial** yang tidak terafiliasi dengan WhatsApp. Perubahan protokol dapat memutus koneksi dan penggunaan unofficial dapat terkena pembatasan akun. Gunakan hanya untuk penerima yang menyetujui pesan; tidak ada klaim anti-ban.

Referensi engine: https://github.com/WhiskeySockets/Baileys dan https://baileys.wiki/ .
