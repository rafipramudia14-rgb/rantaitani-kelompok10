-- Dijalankan otomatis oleh MySQL saat volume masih kosong (pertama kali)
-- Pola "database per service": tiap microservice punya schema + user sendiri

CREATE DATABASE IF NOT EXISTS db_auth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS db_lahan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS db_panen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS db_penjualan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'user_auth'@'%' IDENTIFIED BY 'authTani2026';
CREATE USER IF NOT EXISTS 'user_lahan'@'%' IDENTIFIED BY 'lahanTani2026';
CREATE USER IF NOT EXISTS 'user_panen'@'%' IDENTIFIED BY 'panenTani2026';
CREATE USER IF NOT EXISTS 'user_penjualan'@'%' IDENTIFIED BY 'jualTani2026';
GRANT ALL PRIVILEGES ON db_auth.* TO 'user_auth'@'%';
GRANT ALL PRIVILEGES ON db_lahan.* TO 'user_lahan'@'%';
GRANT ALL PRIVILEGES ON db_panen.* TO 'user_panen'@'%';
GRANT ALL PRIVILEGES ON db_penjualan.* TO 'user_penjualan'@'%';
FLUSH PRIVILEGES;

-- Akun (isi awal dibuat oleh layanan-auth karena password harus di-hash bcrypt):
-- 1 admin, 2 Pak Darto (penjual), 3 Bu Siti (penjual), 4 Pak Ujang (penjual), 5 Rina (pembeli)
USE db_auth;
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('admin','penjual','pembeli') NOT NULL DEFAULT 'pembeli',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

USE db_lahan;
CREATE TABLE IF NOT EXISTS lahan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pemilik_id INT NOT NULL,
  nama_lahan VARCHAR(100) NOT NULL,
  pemilik VARCHAR(100) NOT NULL,
  lokasi VARCHAR(150) NOT NULL,
  luas_ha DECIMAL(8,2) NOT NULL,
  jenis_tanah VARCHAR(50),
  komoditas VARCHAR(50) NOT NULL,
  status ENUM('Persiapan','Tanam','Siap Panen','Bera') DEFAULT 'Persiapan',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO lahan (pemilik_id, nama_lahan, pemilik, lokasi, luas_ha, jenis_tanah, komoditas, status) VALUES
(2, 'Sawah Blok A', 'Pak Darto', 'Desa Sukamaju, Bandung', 1.50, 'Aluvial', 'Padi', 'Tanam'),
(3, 'Kebun Cabai Utara', 'Bu Siti', 'Desa Cibodas, Lembang', 0.75, 'Andosol', 'Cabai', 'Siap Panen'),
(4, 'Ladang Jagung Timur', 'Pak Ujang', 'Desa Margahayu, Garut', 2.00, 'Latosol', 'Jagung', 'Persiapan');

USE db_panen;
CREATE TABLE IF NOT EXISTS panen (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lahan_id INT NOT NULL,
  pemilik_id INT NOT NULL,
  tanggal_panen DATE NOT NULL,
  komoditas VARCHAR(50) NOT NULL,
  jumlah_kg DECIMAL(12,3) NOT NULL,   -- disimpan dalam kg, ketelitian sampai gram
  kualitas ENUM('A','B','C') DEFAULT 'A',
  harga_per_kg DECIMAL(12,2) NOT NULL,
  catatan VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO panen (lahan_id, pemilik_id, tanggal_panen, komoditas, jumlah_kg, kualitas, harga_per_kg, catatan) VALUES
(1, 2, '2026-09-20', 'Padi', 6200.00, 'A', 6500.00, 'Panen musim gadu'),
(2, 3, '2026-10-05', 'Cabai', 850.00, 'B', 32000.00, 'Sebagian terkena hujan');

USE db_penjualan;
CREATE TABLE IF NOT EXISTS penjualan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  panen_id INT NOT NULL,
  penjual_id INT NOT NULL,
  pembeli_id INT NULL,
  pembeli VARCHAR(100) NOT NULL,
  jenis_pembeli ENUM('Tengkulak','Pasar','Koperasi','Pabrik','Perorangan') DEFAULT 'Tengkulak',
  jumlah_kg DECIMAL(12,3) NOT NULL,   -- disimpan dalam kg, ketelitian sampai gram
  harga_jual_per_kg DECIMAL(12,2) NOT NULL,
  tanggal_jual DATE NOT NULL,
  status_bayar ENUM('Lunas','Belum Lunas','Menunggu Konfirmasi') DEFAULT 'Belum Lunas',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT INTO penjualan (panen_id, penjual_id, pembeli_id, pembeli, jenis_pembeli, jumlah_kg, harga_jual_per_kg, tanggal_jual, status_bayar) VALUES
(1, 2, NULL, 'KUD Sukamaju', 'Koperasi', 4000.00, 6800.00, '2026-09-25', 'Lunas'),
(2, 3, NULL, 'Pasar Induk Caringin', 'Pasar', 500.00, 35000.00, '2026-10-07', 'Belum Lunas'),
(2, 3, 5, 'Rina Pembeli', 'Perorangan', 20.00, 32000.00, '2026-10-08', 'Lunas');
