USE db_auth;
-- Profil toko penjual + verifikasi admin (Tahap 3)
CREATE TABLE IF NOT EXISTS toko (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  nama_toko VARCHAR(100) NOT NULL,
  provinsi VARCHAR(60) NOT NULL,
  kota VARCHAR(80) NOT NULL,
  alamat VARCHAR(200) NOT NULL,
  komoditas_utama VARCHAR(100) NOT NULL,
  luas_lahan_ha DECIMAL(10,2) NOT NULL,
  hasil_per_panen_kg DECIMAL(12,2) NOT NULL,
  kontak VARCHAR(30) NOT NULL,
  bukti VARCHAR(200) NOT NULL,
  status ENUM('Menunggu','Terverifikasi','Ditolak') NOT NULL DEFAULT 'Menunggu',
  catatan_admin VARCHAR(200) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
