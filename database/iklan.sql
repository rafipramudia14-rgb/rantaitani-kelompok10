-- Iklan produk ala Iklan Shopee (simulasi, tanpa biaya sungguhan): kata kunci, periode, anggaran harian, statistik
USE db_panen;
CREATE TABLE IF NOT EXISTS iklan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  panen_id INT NOT NULL,
  penjual_id INT NOT NULL,
  judul VARCHAR(80) NOT NULL,
  kata_kunci VARCHAR(200) NOT NULL,
  mulai DATE NOT NULL,
  selesai DATE NOT NULL,
  anggaran_harian INT NOT NULL DEFAULT 10000,
  status ENUM('Aktif','Dijeda') NOT NULL DEFAULT 'Aktif',
  tayang INT NOT NULL DEFAULT 0,
  klik INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (penjual_id), INDEX (panen_id)
);
