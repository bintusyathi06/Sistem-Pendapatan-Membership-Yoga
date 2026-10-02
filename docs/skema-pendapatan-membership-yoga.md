# Skema Pendapatan Membership Yoga dan PPN

Dokumen ini menjelaskan skema yang saat ini didefinisikan di [`backend/supabase.sql`](../backend/supabase.sql) untuk Healthy Yoga Studio. Sistem mencatat member, paket membership, penjualan yang dibayar lunas di muka, dan jurnal pendapatan serta PPN keluaran.

## Ringkasan Model

Model mempunyai **4 entitas bisnis**: `members`, `packages`, `sales`, dan `journals`. Secara fisik PostgreSQL memakai **5 tabel**, karena detail jurnal disimpan pada tabel `journal_entries` yang menjadi bagian dari entitas jurnal.

```mermaid
erDiagram
    MEMBERS ||--o{ SALES : membeli
    PACKAGES ||--o{ SALES : menjadi_paket
    SALES ||--o| JOURNALS : menghasilkan
    JOURNALS ||--|{ JOURNAL_ENTRIES : memiliki

    MEMBERS {
        integer id PK
        varchar member_code UK
        varchar name
        varchar email
        varchar phone
        date join_date
        varchar status
        timestamptz created_at
    }

    PACKAGES {
        integer id PK
        varchar name UK
        integer duration_months
        integer duration_days
        numeric price
        numeric tax_rate
        boolean is_active
        timestamptz created_at
    }

    SALES {
        integer id PK
        varchar sales_no UK
        integer member_id FK
        integer package_id FK
        date start_date
        date end_date
        numeric price_paid
        numeric tax_rate
        numeric tax_amount
        numeric revenue_amount
        varchar payment_method
        text notes
        timestamptz created_at
    }

    JOURNALS {
        integer id PK
        varchar journal_no UK
        date journal_date
        text description
        varchar reference_type
        integer reference_id FK_UK
        timestamptz created_at
    }

    JOURNAL_ENTRIES {
        integer id PK
        integer journal_id FK
        varchar account_code
        varchar account_name
        numeric debit
        numeric credit
        text description
        timestamptz created_at
    }
```

> Relasi `SALES` ke `JOURNALS` dibuat opsional pada diagram karena constraint database tidak mewajibkan setiap sale memiliki header jurnal. Jalur transaksi resmi `create_sale_with_journal` selalu membuat satu jurnal untuk setiap sale. `JOURNAL_ENTRIES` memiliki minimal dua baris; jalur resmi membuat tiga.

## Penjelasan ERD

- **Member ke sales: 1:N.** Satu member dapat membeli banyak membership dari waktu ke waktu. Setiap sale harus menunjuk ke satu member melalui `sales.member_id`.
- **Package ke sales: 1:N.** Satu paket dapat terjual berkali-kali. Setiap sale menyimpan `package_id` sekaligus snapshot harga dan tarif pajak agar histori tidak berubah jika master paket diedit.
- **Sale ke journal: 1:0..1 di database, satu-ke-satu pada jalur resmi.** `journals.reference_id` menunjuk ke `sales.id` dan bersifat unik, sehingga satu sale tidak dapat mempunyai lebih dari satu header jurnal.
- **Journal ke journal entries: 1:N.** Header menyimpan nomor/tanggal/deskripsi; baris detail menyimpan akun, debit, dan kredit. Trigger menolak jurnal dengan kurang dari dua baris atau selisih debit-kredit lebih dari Rp0,01.

`journal_entries` adalah detail dari entitas bisnis `journals`, bukan modul transaksi terpisah. Chart of Accounts tidak dibuat sebagai tabel; tiga akun yang dipakai di-hardcode pada fungsi RPC.

## Tabel `members`

Menyimpan identitas dan status member.

| Kolom | Tipe PostgreSQL | Aturan dan fungsi |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `member_code` | `VARCHAR(20)` | Wajib, unik; trigger mengisi `MBR-0001` dari ID jika kosong |
| `name` | `VARCHAR(100)` | Wajib |
| `email` | `VARCHAR(100)` | Opsional; dibatasi pemeriksaan format email |
| `phone` | `VARCHAR(20)` | Opsional; dibatasi karakter/format nomor telepon |
| `join_date` | `DATE` | Wajib, default tanggal saat ini |
| `status` | `VARCHAR(20)` | `active` atau `inactive`; default database `active` |
| `created_at` | `TIMESTAMPTZ` | Waktu pembuatan, default `NOW()` |

Saat transaksi membership berhasil dibuat, fungsi RPC mengatur status member menjadi `active`. Pada aplikasi, member baru tanpa transaksi dapat dikirim dengan status `inactive`. Status yang sesuai masa berlaku diperbarui oleh logika aplikasi saat data member/dashboard dibaca; SQL tidak memiliki trigger terjadwal untuk menonaktifkan member ketika masa berlaku berakhir.

Penghapusan member dibatasi oleh relasi sale dengan `ON DELETE RESTRICT`; UI juga menolak penghapusan member yang memiliki riwayat transaksi.

## Tabel `packages`

Menyimpan paket membership yang tersedia untuk penjualan baru.

| Kolom | Tipe PostgreSQL | Aturan dan fungsi |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `name` | `VARCHAR(50)` | Wajib dan unik |
| `duration_months` | `INTEGER` | Wajib, lebih besar dari nol |
| `duration_days` | `INTEGER` | Wajib, lebih besar dari nol; dipakai untuk menghitung tanggal akhir |
| `price` | `NUMERIC(15,2)` | Wajib, lebih besar dari nol; harga sudah termasuk PPN |
| `tax_rate` | `NUMERIC(5,2)` | Wajib, default `11.00`, rentang 0 sampai 100 |
| `is_active` | `BOOLEAN` | Default `TRUE`; paket nonaktif diarsipkan dan tidak dijual pada RPC |
| `created_at` | `TIMESTAMPTZ` | Waktu pembuatan, default `NOW()` |

Seed bawaan:

| Paket | Durasi bulan | Durasi hari | Harga termasuk PPN | Tarif |
|---|---:|---:|---:|---:|
| 1 Bulan | 1 | 30 | Rp500.000,00 | 11% |
| 3 Bulan | 3 | 90 | Rp1.350.000,00 | 11% |
| 6 Bulan | 6 | 180 | Rp2.500.000,00 | 11% |
| 1 Tahun | 12 | 365 | Rp4.500.000,00 | 11% |

Seed menggunakan `ON CONFLICT (name) DO UPDATE`; menjalankan ulang file SQL akan memperbarui durasi, harga, tarif, dan status aktif ke nilai seed tersebut.

## Tabel `sales`

Header transaksi membership yang lunas di muka. Tidak ada kolom status `pending`; transaksi hanya dibuat melalui RPC setelah data member dan paket aktif ditemukan.

| Kolom | Tipe PostgreSQL | Aturan dan fungsi |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `sales_no` | `VARCHAR(30)` | Wajib dan unik; format `SLS-YYYYMM-####` |
| `member_id` | `INTEGER` | FK ke `members.id`, penghapusan member terkait dibatasi |
| `package_id` | `INTEGER` | FK ke `packages.id`, penghapusan paket terkait dibatasi |
| `start_date` | `DATE` | Wajib; juga menjadi tanggal jurnal |
| `end_date` | `DATE` | Dihitung sebagai `start_date + duration_days`; tidak boleh sebelum tanggal mulai |
| `price_paid` | `NUMERIC(15,2)` | Snapshot harga paket ketika transaksi terjadi, harus positif |
| `tax_rate` | `NUMERIC(5,2)` | Snapshot tarif paket ketika transaksi terjadi, rentang 0 sampai 100 |
| `tax_amount` | `NUMERIC(15,2)` | PPN keluaran yang termasuk dalam harga |
| `revenue_amount` | `NUMERIC(15,2)` | Pendapatan/DPP tanpa PPN |
| `payment_method` | `VARCHAR(20)` | `cash` atau `transfer` |
| `notes` | `TEXT` | Catatan; satu-satunya kolom sale yang diberi hak update di SQL |
| `created_at` | `TIMESTAMPTZ` | Waktu pembuatan, default `NOW()` |

Constraint `sales_inclusive_tax_math` memeriksa nilai DPP dan pajak terhadap `price_paid` dan `tax_rate`. Indeks tersedia pada `member_id`, `package_id`, `start_date`, dan `end_date`.

## Entitas `journals` dan tabel `journal_entries`

### Header `journals`

| Kolom | Tipe PostgreSQL | Aturan dan fungsi |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `journal_no` | `VARCHAR(30)` | Wajib dan unik; format `JV-YYYYMM-####` |
| `journal_date` | `DATE` | Disalin dari `sales.start_date` |
| `description` | `TEXT` | Bentuk `Penjualan paket {nama paket} - {nama member}` |
| `reference_type` | `VARCHAR(20)` | Constraint hanya menerima `sale` |
| `reference_id` | `INTEGER` | FK unik ke `sales.id`; mengikat jurnal ke sale sumber |
| `created_at` | `TIMESTAMPTZ` | Waktu pembuatan, default `NOW()` |

### Detail `journal_entries`

| Kolom | Tipe PostgreSQL | Aturan dan fungsi |
|---|---|---|
| `id` | `SERIAL` | Primary key |
| `journal_id` | `INTEGER` | FK ke `journals.id`, `ON DELETE RESTRICT` |
| `account_code` | `VARCHAR(10)` | Kode akun hardcode dari CoA |
| `account_name` | `VARCHAR(50)` | Nama akun yang harus cocok dengan kode |
| `debit` | `NUMERIC(15,2)` | Default nol, tidak boleh negatif |
| `credit` | `NUMERIC(15,2)` | Default nol, tidak boleh negatif |
| `description` | `TEXT` | Deskripsi baris jurnal |
| `created_at` | `TIMESTAMPTZ` | Waktu pembuatan, default `NOW()` |

Constraint akun hanya menerima pasangan berikut: `1-1000 / Kas & Bank`, `2-2000 / PPN Keluaran`, dan `4-4000 / Pendapatan Membership`. Satu baris tidak boleh memiliki debit dan kredit positif bersamaan. Baris bernilai nol diperbolehkan, misalnya baris PPN untuk paket dengan tarif 0%.

## Perhitungan Harga dan PPN Include

Harga paket yang disimpan adalah harga bruto yang sudah termasuk pajak. Untuk tarif `r` persen:

```text
DPP / revenue_amount = ROUND(price_paid / (1 + r / 100), 2)
tax_amount            = ROUND(price_paid - revenue_amount, 2)
```

Contoh paket Rp500.000 dengan PPN 11%:

| Komponen | Nilai |
|---|---:|
| Harga dibayar (`price_paid`) | Rp500.000,00 |
| DPP / pendapatan (`revenue_amount`) | Rp450.450,45 |
| PPN keluaran (`tax_amount`) | Rp49.549,55 |

Rumus menjaga identitas `price_paid = revenue_amount + tax_amount` hingga pembulatan dua desimal.

## Auto-Jurnal dan Siklus Transaksi

Frontend memanggil fungsi PostgreSQL `public.create_sale_with_journal` melalui Supabase RPC dengan parameter member, paket, tanggal mulai, metode pembayaran, dan catatan. Fungsi `SECURITY INVOKER` melakukan seluruh langkah di satu transaksi database:

1. Memastikan tanggal mulai terisi, metode pembayaran `cash`/`transfer`, member tersedia, dan paket aktif.
2. Mengambil harga, tarif pajak, durasi, serta nama paket dan member dari master saat transaksi dibuat.
3. Mengunci penomoran per bulan dengan advisory transaction lock, lalu membuat nomor sale `SLS-YYYYMM-####` dan nomor jurnal `JV-YYYYMM-####` berdasarkan bulan tanggal mulai.
4. Menghitung DPP dan PPN serta membuat sale dengan `end_date = start_date + duration_days`.
5. Membuat header jurnal dengan tanggal `start_date`, referensi ke sale, dan deskripsi transaksi.
6. Membuat tepat tiga baris jurnal:

| Posisi | Akun | Debit | Kredit |
|---|---|---:|---:|
| Kas masuk | `1-1000` Kas & Bank | `price_paid` | 0 |
| Pendapatan | `4-4000` Pendapatan Membership | 0 | `revenue_amount` |
| PPN | `2-2000` PPN Keluaran | 0 | `tax_amount` |

7. Memeriksa selisih debit-kredit tidak melebihi Rp0,01, mengaktifkan member, lalu mengembalikan data sale bersama jurnal dan entries.

Jika salah satu insert atau validasi gagal, transaksi database dibatalkan sebagai satu kesatuan. Trigger constraint `journal_entries_balance_check` memvalidasi minimal dua baris dan keseimbangan jurnal saat transaksi commit.

## Chart of Accounts

CoA tidak memiliki tabel tersendiri. Tiga akun berikut ditentukan langsung di fungsi RPC:

| Kode | Nama akun | Saldo normal pada jurnal penjualan |
|---|---|---|
| `1-1000` | Kas & Bank | Debit sebesar pembayaran |
| `2-2000` | PPN Keluaran | Kredit sebesar PPN |
| `4-4000` | Pendapatan Membership | Kredit sebesar DPP |

## Indeks, Akses, dan Retensi

- Indeks dibuat untuk pencarian/filter sale menurut member, paket, tanggal mulai, dan tanggal akhir, serta pencarian jurnal menurut tanggal dan detail menurut jurnal.
- RLS diaktifkan pada kelima tabel fisik.
- Role `anon` UAT mendapat akses CRUD pada member dan paket. Paket diarsipkan melalui `is_active = false`.
- Sale dapat dibaca/dibuat; grant update dibatasi ke kolom `notes`. Penghapusan sale dibatasi policy bila sale telah mempunyai jurnal.
- Jurnal dan journal entries hanya diberi izin baca/tambah; tidak diberi update/delete. FK `ON DELETE RESTRICT` mempertahankan jejak audit.
- Fungsi RPC dapat dieksekusi role `anon`; operasi sale dan jurnalnya tetap dibatasi RLS sebagai `SECURITY INVOKER`.

Kebijakan anon ini hanya untuk UAT tanpa login. Karena semua browser yang memiliki URL dan publishable key dapat memakai izin tersebut, konfigurasi ini tidak cocok untuk data produksi tanpa autentikasi dan kebijakan akses yang lebih ketat.

## Catatan Implementasi

Dokumen ini menjelaskan skema dan RPC pada SQL saat ini, bukan pengganti file migrasi. Masa berlaku, pembaruan status member, validasi form, dan tampilan laporan juga memiliki bagian yang ditangani aplikasi frontend. Untuk setup database, jalankan `backend/supabase.sql` pada SQL Editor proyek Supabase.
