# Healthy Yoga Studio UAT

Aplikasi membership dan jurnal akuntansi cash basis untuk UAT. Mode yang dipakai sekarang tidak membutuhkan Node.js: frontend vanilla memanggil Supabase PostgREST secara langsung.

## Persiapan Supabase

1. Buat atau buka proyek di Supabase.
2. Buka **SQL Editor**, pilih **New query**, lalu salin seluruh isi `backend/supabase.sql`.
3. Klik **Run** dan pastikan selesai tanpa error. Jalankan ulang file lengkap setelah perubahan, karena file tersebut juga memasang RPC transaksi atomik dan meminta PostgREST memuat ulang schema cache.
4. Buka **Project Settings → API** dan siapkan Project URL serta **publishable key**.
5. Di awal `frontend/script.js`, isi `SUPABASE_URL` dan `SUPABASE_KEY` dengan nilai proyek Anda. Gunakan publishable/anon key saja; jangan gunakan `service_role` key.

Kebijakan anon pada SQL memberi akses tanpa login untuk UAT. Jangan gunakan konfigurasi akses ini untuk data produksi.

## Menjalankan Frontend

1. Buka `frontend/index.html` di Visual Studio Code.
2. Klik kanan editor, lalu pilih **Open with Live Server** (atau klik **Go Live**).
3. Buka alamat Live Server, biasanya `http://127.0.0.1:5500/frontend/`.

Aplikasi mengakses Supabase langsung dari browser; tidak ada backend lokal yang perlu dinyalakan. Jika browser menampilkan error CORS, periksa konfigurasi API/CORS proyek Supabase dan izinkan origin Live Server lokal.

## Transaksi dan Jurnal

Penjualan memanggil fungsi database `create_sale_with_journal` melalui PostgREST RPC. Fungsi tersebut membuat sale, jurnal, dan tiga baris jurnal dalam satu transaksi database, menghitung PPN include, serta mengaktifkan member. Nomor sales dan jurnal dibuat dengan penguncian transaksi per bulan.

## Struktur Folder

```text
healthy-yoga-app/
├── backend/
│   ├── app.js          # Backend Node lama; tidak dipakai pada mode tanpa Node
│   └── supabase.sql    # Skema, seed, RLS, trigger, dan RPC
├── frontend/
│   ├── index.html
│   ├── script.js       # UI dan koneksi langsung ke Supabase
│   └── style.css
└── README.md
```

Mode ini memakai HTML, CSS, JavaScript vanilla, SQL Supabase, dan Live Server. Tidak perlu `package.json`, `node_modules`, `npm install`, atau Node.js.
