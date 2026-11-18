# Operasi penjualan pilot

## Sebelum menerima pelanggan

- Tentukan brand, subdomain, identitas bisnis, support email, rekening penerima, dan harga yang akan ditampilkan.
- Isi konfigurasi production. Kirim email verifikasi/reset melalui SMTP asli; uji tautan dari domain publik. Gunakan tombol email tes di Pengaturan platform; `preflight --smtp` hanya menguji koneksi SMTP, bukan penerimaan di inbox.
- Buat akun admin pertama dari tautan setup pribadi hasil installer. SMTP tidak diperlukan untuk langkah ini. Buka Pengaturan platform untuk melengkapi email dan pembayaran; akun lama dari `ADMIN_EMAILS` tetap didukung.
- Uji dari HP: scan QR → kirim satu pesan ke nomor uji yang menyetujui → periksa isi/penerima → balas STOP → pastikan pesan berikutnya ditahan. Uji logout/reconnect dan restart server.
- Uji invoice dari akun pelanggan terpisah. Pastikan konfirmasi transfer belum mengaktifkan paket, lalu verifikasi saldo masuk dan setujui dari admin.
- Tetapkan jadwal backup, masa retensi, prosedur refund, dan kontak dukungan. Lakukan restore rehearsal dari salinan backup.
- Ukur kapasitas CPU/RAM/socket pada VPS target sebelum membuka signup luas. `PUBLIC_SIGNUP=false` dengan `REGISTRATION_CODE` dapat dipakai untuk pilot tertutup.

## Alur pelanggan

1. Daftar dan verifikasi email.
2. Trial mulai sejak akun dibuat. Pelanggan menautkan nomor WhatsApp melalui QR.
3. Kontak harus memiliki sumber persetujuan. CSV memakai kolom `name,phone`.
4. Campaign memesan kuota saat dibuat. Tidak ada refund kuota otomatis untuk pembatalan/hasil ambigu.
5. Pelanggan memilih paket, membayar invoice manual, lalu mengisi referensi transfer.
6. Admin memeriksa dana masuk di rekening. Klik Setujui dan masukkan referensi verifikasi. Jangan mengandalkan screenshot atau konfirmasi pelanggan saja.
7. Periode baru 30 hari dimulai saat invoice disetujui. Semua campaign lama yang tertunda dibatalkan. Perpanjangan dibuka saat periode berbayar berakhir.

## Incident response

| Gejala                     | Pemeriksaan / tindakan                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tidak mendapat email       | Admin: lihat jumlah pending/failed. Periksa SMTP di panel dan kirim email tes. Minta pengguna cek spam dan kirim ulang verifikasi. Token lama invalid setelah token baru dibuat. |
| QR tidak muncul            | Periksa konektivitas VPS ke WhatsApp, status paket, verifikasi email. Putuskan sesi lalu hubungkan kembali jika diperlukan.                                                      |
| Pengiriman `unknown`       | Periksa WhatsApp HP sebelum mengirim lagi. Aplikasi tidak otomatis retry. Timeout 45 detik tidak dapat membuktikan pesan belum terkirim.                                         |
| Campaign tertahan          | Periksa status koneksi, jadwal, active period, suspend, kontak/opt-out, dan role pengguna.                                                                                       |
| Pembayaran tidak aktif     | Periksa invoice, masa berlaku, referensi, saldo masuk, dan keputusan admin. Invoice expired tidak bisa disetujui. Hubungi pelanggan untuk rekonsiliasi.                          |
| Penyalahgunaan             | Suspend workspace dari Admin. Antrean dijeda dan sesi WhatsApp diputus. Satu pengiriman in-flight mungkin sudah berjalan.                                                        |
| Kunci hilang / tidak cocok | Pulihkan kunci yang dipakai saat backup dibuat. Tidak ada bypass dekripsi sesi.                                                                                                  |
| `server.lock` tertinggal   | Pastikan proses lama benar-benar mati. Server membersihkan lock PID yang tidak hidup. Jika PID sudah dipakai proses lain, investigasi sebelum menghapus lock manual.             |

## Backup dan restore

Gunakan SQLite backup API (`npm run backup -- /path/backup.sqlite`) untuk snapshot konsisten ketika server berjalan. Simpan snapshot dan kunci terpisah. Berhentikan aplikasi sebelum mengganti database dengan backup. Hapus WAL/SHM lama hanya setelah proses berhenti dan salinan database aktif sudah diamankan. Mulai ulang, jalankan preflight, lalu periksa campaign dan koneksi.

Backup dapat mengandung token undangan/reset yang masih berlaku dan kredensial tertaut. Restore mengembalikan keadaan pada saat snapshot: invoice atau pesan sesudah snapshot mungkin perlu direkonsiliasi. Jangan menjalankan server hasil restore bersamaan dengan server utama menggunakan sesi WhatsApp yang sama.

## Batas deployment

Satu instance pada satu host dengan volume lokal. Process lock memakai PID; jangan berbagi volume di antara host atau lingkungan container yang berbeda. Aplikasi belum memakai distributed leases dan belum memiliki hasil load test produksi. Rate limit bersifat lokal di proses, sehingga konfigurasi proxy yang benar diperlukan untuk membedakan IP klien. Jangan expose port aplikasi ke publik selain melalui reverse proxy yang dikonfigurasi.

Billing adalah manual, bukan payment gateway otomatis. Simpan bukti verifikasi di sistem pembukuan bisnis; aplikasi menyimpan referensi teks dan audit, bukan file bukti transfer.
