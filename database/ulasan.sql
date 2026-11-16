-- Ulasan & rating dari pembeli setelah pesanan Selesai (satu ulasan per pesanan)
USE db_penjualan;
CREATE TABLE IF NOT EXISTS ulasan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  penjualan_id INT NOT NULL UNIQUE,
  panen_id INT NOT NULL,
  penjual_id INT NOT NULL,
  pembeli_id INT NOT NULL,
  nama_pembeli VARCHAR(100) NOT NULL,
  rating TINYINT NOT NULL,
  komentar VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (panen_id), INDEX (penjual_id)
);
