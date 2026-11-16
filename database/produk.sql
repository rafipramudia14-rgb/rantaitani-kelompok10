-- Produk ala marketplace: nama, deskripsi, foto, harga promo, produk unggulan (dipromosikan)
USE db_panen;
ALTER TABLE panen
  ADD COLUMN nama_produk VARCHAR(100) NULL AFTER komoditas,
  ADD COLUMN deskripsi VARCHAR(500) NULL,
  ADD COLUMN foto VARCHAR(200) NULL,
  ADD COLUMN harga_promo DECIMAL(12,2) NULL,
  ADD COLUMN promo_sampai DATE NULL,
  ADD COLUMN unggulan TINYINT(1) NOT NULL DEFAULT 0;
