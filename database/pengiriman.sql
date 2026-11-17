-- Pengiriman produsen -> konsumen: jasa kirim, cara serah (pickup / antar ke counter), nomor resi, riwayat perjalanan paket
USE db_penjualan;
ALTER TABLE penjualan
  ADD COLUMN jasa_kirim VARCHAR(40) NULL,
  ADD COLUMN cara_serah ENUM('Pickup','Antar ke counter') NULL,
  ADD COLUMN no_resi VARCHAR(30) NULL UNIQUE,
  ADD COLUMN dikirim_at DATETIME NULL;
CREATE TABLE IF NOT EXISTS riwayat_kirim (
  id INT AUTO_INCREMENT PRIMARY KEY,
  penjualan_id INT NOT NULL,
  waktu DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lokasi VARCHAR(100) NOT NULL,
  keterangan VARCHAR(200) NOT NULL,
  oleh VARCHAR(100) NULL,
  INDEX (penjualan_id)
);
