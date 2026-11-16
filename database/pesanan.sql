-- Tahap 5: status pesanan. Batal hanya boleh sebelum pesanan Diproses.
USE db_penjualan;
ALTER TABLE penjualan ADD COLUMN status_pesanan
  ENUM('Menunggu Bayar','Dibayar','Diproses','Dikirim','Selesai','Dibatalkan') NOT NULL DEFAULT 'Selesai' AFTER status_bayar;
-- data lama: pembelian lewat katalog mengikuti status bayarnya, catatan penjualan manual dianggap Selesai
UPDATE penjualan SET status_pesanan = IF(status_bayar='Lunas','Dibayar','Menunggu Bayar') WHERE pembeli_id IS NOT NULL;
