-- Voucher toko ala Shopee: tipe (persen / nominal / gratis ongkir), nilai, kuota, minimal belanja, periode
USE db_penjualan;
CREATE TABLE IF NOT EXISTS voucher (
  id INT AUTO_INCREMENT PRIMARY KEY,
  penjual_id INT NOT NULL,
  kode VARCHAR(20) NOT NULL UNIQUE,
  nama VARCHAR(80) NOT NULL,
  tipe ENUM('Persen','Nominal','Gratis Ongkir') NOT NULL,
  nilai INT NOT NULL,
  maks_potongan INT NULL,
  min_belanja INT NOT NULL DEFAULT 0,
  kuota INT NOT NULL,
  terpakai INT NOT NULL DEFAULT 0,
  mulai DATE NOT NULL,
  selesai DATE NOT NULL,
  aktif TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (penjual_id)
);
ALTER TABLE penjualan
  ADD COLUMN voucher_kode VARCHAR(20) NULL,
  ADD COLUMN potongan DECIMAL(12,2) NOT NULL DEFAULT 0;
