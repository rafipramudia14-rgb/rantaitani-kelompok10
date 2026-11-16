-- Akun lengkap (login email, profil & alamat kirim), lupa password (kode simulasi), notifikasi, toko lebih ringkas
USE db_auth;
ALTER TABLE users
  ADD COLUMN email VARCHAR(120) NULL UNIQUE AFTER username,
  ADD COLUMN no_hp VARCHAR(20) NULL,
  ADD COLUMN provinsi VARCHAR(60) NULL,
  ADD COLUMN kota_id INT NULL,
  ADD COLUMN kota VARCHAR(80) NULL,
  ADD COLUMN alamat VARCHAR(200) NULL;

CREATE TABLE IF NOT EXISTS reset_password (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  kode CHAR(6) NOT NULL,
  berlaku_sampai DATETIME NOT NULL,
  percobaan TINYINT NOT NULL DEFAULT 0,
  dipakai TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifikasi (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  judul VARCHAR(120) NOT NULL,
  isi VARCHAR(300) NOT NULL,
  tautan VARCHAR(60) NULL,
  dibaca TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id, dibaca)
);

-- Toko: bukti kepemilikan jadi opsional (tanpa KTP / berkas berbelit), kota memakai daftar 514 kab/kota
ALTER TABLE toko
  MODIFY bukti VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN kota_id INT NULL AFTER kota,
  ADD COLUMN deskripsi VARCHAR(300) NULL;
