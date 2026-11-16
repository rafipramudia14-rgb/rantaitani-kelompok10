-- Checkout ala marketplace: alamat kirim, ongkir otomatis, metode bayar (simulasi), jalur pengiriman untuk peta
USE db_penjualan;
ALTER TABLE penjualan
  ADD COLUMN metode_bayar ENUM('QRIS','GoPay','DANA','Transfer Bank') NULL,
  ADD COLUMN ongkir DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN moda_kirim VARCHAR(40) NULL,
  ADD COLUMN estimasi_hari DECIMAL(5,1) NULL,
  ADD COLUMN kota_asal VARCHAR(80) NULL,
  ADD COLUMN kota_tujuan VARCHAR(80) NULL,
  ADD COLUMN provinsi_tujuan VARCHAR(60) NULL,
  ADD COLUMN alamat_kirim VARCHAR(200) NULL,
  ADD COLUMN no_hp_penerima VARCHAR(20) NULL,
  ADD COLUMN jalur TEXT NULL;
