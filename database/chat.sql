-- Chat penjual-pembeli: database sendiri untuk layanan-bantuan (pola database per service)
CREATE DATABASE IF NOT EXISTS db_bantuan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'user_bantuan'@'%' IDENTIFIED BY 'bantuanTani2026';
GRANT ALL PRIVILEGES ON db_bantuan.* TO 'user_bantuan'@'%';
FLUSH PRIVILEGES;
USE db_bantuan;
CREATE TABLE IF NOT EXISTS percakapan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pembeli_id INT NOT NULL,
  penjual_id INT NOT NULL,
  pembeli_nama VARCHAR(100) NOT NULL,
  toko_nama VARCHAR(100) NOT NULL,
  panen_id INT NULL,
  terakhir_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pasangan (pembeli_id, penjual_id)
);
CREATE TABLE IF NOT EXISTS pesan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  percakapan_id INT NOT NULL,
  pengirim_id INT NOT NULL,
  pengirim_nama VARCHAR(100) NOT NULL,
  isi VARCHAR(1000) NOT NULL,
  dibaca TINYINT(1) NOT NULL DEFAULT 0,
  diubah TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (percakapan_id)
);
