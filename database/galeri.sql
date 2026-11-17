-- Galeri foto produk (maks. 5 foto tambahan selain foto utama), disimpan sebagai JSON array path
USE db_panen;
ALTER TABLE panen ADD COLUMN galeri TEXT NULL;
