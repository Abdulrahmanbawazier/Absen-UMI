# Sistem Absensi Tukang & Laporan Stok Material Harian

Aplikasi web modern, minimalis, dan responsif untuk manajemen operasional proyek konstruksi (kontraktor), absensi tukang, perhitungan upah & kasbon mingguan, serta pencatatan stok material harian dengan sinkronisasi realtime antara Laptop dan Smartphone (HP).

## 🚀 Alamat Akses Aplikasi
- **Akses di Laptop/PC**: [http://localhost:3000](http://localhost:3000)
- **Akses di Smartphone / HP**: `http://192.168.18.63:3000` *(atau scan QR Code langsung dari tombol HP di pojok kanan atas aplikasi)*

> **Catatan Koneksi HP**: Pastikan HP dan Laptop terhubung ke jaringan Wi-Fi yang sama.

---

## 🔑 Keamanan & PIN Admin
- **PIN Admin Default**: `1234`
- Digunakan untuk:
  1. Membuka nominal upah rahasia di Master Data Tukang.
  2. Mengakses tab Rekap Upah Mingguan & Pembagian Amplop Upah.
  3. Membuka Arsip Data Tukang Lama untuk pemulihan (restore) data.
  4. Mereset siklus mingguan (per hari Minggu).

---

## 🌟 Fitur Utama

### 1. Absensi Tukang Harian - Mingguan
- **Siklus 1 Minggu**: Terkumpul selama 1 minggu dan di-reset setiap hari Minggu.
- **Data Tukang Lengkap**: Nama, Spesialisasi (Mandor, Tukang Besi, Kayu, Tk Batu, Tenaga, Listrik, Plumbing, Hydrant), Mandor pembina, Upah harian, Upah jam lembur/ekstra.
- **Ekstra 2 Jam Otomatis**: Hari kerja Senin s/d Jumat otomatis terhitung lembur 2 jam (kecuali hari Sabtu/Minggu default 0 jam, dan tetap bisa diedit manual).
- **Status Kehadiran Interaktif**:
  - **Hadir**: Upah harian penuh + lembur.
  - **½ Hari**: Hadir setengah hari (upah 50%).
  - **Sakit**: Input manual nominal bantuan biaya obat.
  - **Absen**: Tidak hadir (0 upah).
- **Kasbon Tukang**: Tombol kasbon untuk input jumlah kasbon dan nominal termin cicilan per minggu. Otomatis dipotong dari total upah mingguan.
- **Auto-fill Pekerjaan Grup Mandor**: Mengisi pekerjaan pada Mandor (misal: *Ngecor Balok Lantai 2*) akan otomatis mengisi pekerjaan anggota grup mandor tersebut jika masih kosong.
- **Proses Absen & Koreksi**:
  - Sebelum proses simpan, wajib mengisi **Nama Pengabsen** melalui popup modal.
  - Jika ada perubahan / tukang pulang setengah hari, bisa diedit lalu proses kembali dengan memasukkan **Nama Pengoreksi**.
  - Kedua nama akan tampil berdampingan di dashboard utama (*Diabsen oleh: Budi | Dikoreksi oleh: Agus*).

### 2. Laporan Stok Material Harian
- **4 Kategori**: Struktur, Arsitektur, MEP, Inventaris Kantor.
- **Kolom Tabel**: Kategori, Nama Barang, Satuan, Stok Kemarin, Masuk Hari Ini, Keluar Hari Ini, Sisa Stok Hari Ini, Status.
- **Editable Inline**: Input pemasukan dan pengeluaran bisa langsung diketik dan langsung tersimpan.
- **Rollover Otomatis pk 07:00 WIB**:
  - Setiap hari pukul 07:00 WIB pagi, sistem otomatis mereset tampilan: Stok Kemarin = Sisa Kemarin, Masuk = 0, Keluar = 0, Sisa = Stok Kemarin.
- **Distructable / Drag & Drop**: Baris tabel bisa digeser naik-turun (drag handle) untuk merapikan urutan barang.
- **Peringatan Stok Menipis (Low Stock Warning)**: Muncul badge peringatan merah di dashboard utama jika stok tersisa $\le$ batas minimum yang ditentukan.

### 3. Master Data Tukang & Arsip Tukang Lama
- Tambah, Edit, dan Hapus tukang.
- **Tukang yang dihapus tidak hilang permanen**, melainkan masuk ke **Arsip Tukang Lama** (dilindungi PIN 1234).
- Di dalam arsip ada tombol **Kembalikan (Restore)** untuk mengaktifkan kembali ke daftar absensi harian.
- Pengelompokan grup Mandor untuk pembagian tim lapangan.

### 4. Rekap Upah Mingguan & Kasbon (Proteksi PIN)
- Hanya dapat dibuka dengan PIN Admin `1234`.
- Dikelompokkan rapi per grup Mandor untuk mempermudah pembagian amplop upah mingguan.
- Rincian: Hari hadir, setengah hari, jam ekstra, bantuan sakit, upah kotor, potongan cicilan kasbon minggu ini, sisa kasbon, dan upah bersih (Take Home Pay).
- Tombol **Reset Siklus Mingguan** untuk memotong saldo kasbon dan memulai periode baru.

### 5. Cetak & Unduh PDF Elegan / Minimalis
- **PDF Laporan Absensi Harian**: Rapi dan minimalis, memuat daftar tukang hadir dengan jobdesk hari itu, dan daftar tukang tidak hadir/sakit dengan highlight warna merah lembut di bagian bawah. **SAMA SEKALI TIDAK MEMUAT UPAH** demi kerahasiaan.
- **PDF Laporan Stok Material Harian**: Dilengkapi Nama Perusahaan, Nama Proyek, Tanggal Hari Ini (tanpa jam), dan tabel 4 kategori material yang rapi dan elegan.
- **PDF Slip Upah Mingguan**: Slip rekap pembayaran upah mingguan per tim mandor.

### 6. Tampilan & Pengalaman Pengguna (UI/UX)
- Warna utama: **Biru muda / Tosca** (`#0284c7`, `#06b6d4`, `#0d9488`).
- Aksen: Hijau lembut untuk pemasukan/hadir, merah lembut untuk pengeluaran/absen/peringatan stok.
- **Dark Mode & Light Mode**: Switch tema dengan satu klik.
- **Grafik Interaktif**:
  - Combo/Line Chart: Arus material masuk vs keluar (tren 7 hari).
  - Donut/Pie Chart: Proporsi tukang hadir per spesialisasi.
- **Realtime Auto-Sync**: Menggunakan Server-Sent Events (SSE). Perubahan data di HP langsung terlihat di layar Laptop tanpa perlu refresh halaman.

---

## 🛠️ Menjalankan Server Kapan Saja
Cukup jalankan script batch di folder proyek:
```powershell
start-app.bat
```
Atau melalui terminal:
```powershell
node server.js
```
*(Tersedia executable agy-node bawaan sistem).*
