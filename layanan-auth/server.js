// TaniMart - Layanan Auth (Express): login, register, JWT, manajemen pengguna, toko penjual. Database db_auth.
// Nginx memanggil GET /api/auth/verify (auth_request) untuk setiap request /api/* lain.
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const SECRET = process.env.JWT_SECRET || "ganti-rahasia-ini";
const ROLES = ["admin", "penjual", "pembeli"];
const pool = mysql.createPool({
  host: process.env.DB_HOST || "db",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "db_auth",
  waitForConnections: true,
  connectionLimit: 5,
  dateStrings: true,
});

const ok = (res, data, code = 200, message = "success") =>
  res.status(code).json({ status: "success", service: "layanan-auth", message, data });
const err = (res, message, code) => res.status(code).json({ status: "error", service: "layanan-auth", message });
const publik = (u) => ({ id: u.id, nama: u.nama, username: u.username, email: u.email, role: u.role, no_hp: u.no_hp,
  provinsi: u.provinsi, kota_id: u.kota_id, kota: u.kota, alamat: u.alamat, created_at: u.created_at });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const crypto = require("crypto");
async function notif(userId, judul, isi, tautan = null) {
  try { await pool.query("INSERT INTO notifikasi (user_id, judul, isi, tautan) VALUES (?,?,?,?)", [userId, judul, String(isi).slice(0, 300), tautan]); }
  catch (e) { console.error("notifikasi gagal:", e.message); }
}

function bacaToken(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return jwt.verify(h.slice(7), SECRET); } catch { return null; }
}
const butuhAdmin = (req, res, next) => {
  const u = bacaToken(req);
  if (!u) return err(res, "silakan login terlebih dahulu", 401);
  if (u.role !== "admin") return err(res, "hanya admin yang boleh mengakses", 403);
  req.user = u;
  next();
};

// Akun awal (dibuat sekali saat tabel masih kosong)
const SEED = [
  ["Administrator", "admin", "admin123", "admin", "admin@tanimart.test"],
  ["Pak Darto", "darto", "petani123", "penjual", "darto@tanimart.test"],
  ["Bu Siti", "siti", "petani123", "penjual", "siti@tanimart.test"],
  ["Pak Ujang", "ujang", "petani123", "penjual", "ujang@tanimart.test"],
  ["Rina Pembeli", "rina", "pembeli123", "pembeli", "rina@tanimart.test"],
];
// Toko contoh (dibuat sekali saat tabel toko masih kosong)
const SEED_TOKO = [
  ["darto", "Tani Darto Sukamaju", "JAWA BARAT", "Kab. Bandung", 3204, "Desa Sukamaju, Kec. Ciparay", "Padi", 1.5, 6200, "0812-0000-0001", "SPPT PBB No. 32.04.xxx (contoh)", "Terverifikasi"],
  ["siti", "Kebun Cabai Bu Siti", "JAWA BARAT", "Kab. Bandung Barat", 3217, "Desa Cibodas, Lembang", "Cabai", 0.75, 900, "0812-0000-0002", "Sertifikat hak milik No. 10.xxx (contoh)", "Terverifikasi"],
  ["ujang", "Ladang Jagung Ujang", "JAWA TENGAH", "Kab. Grobogan", 3315, "Desa Ngraji, Kec. Purwodadi", "Jagung", 2, 7500, "0812-0000-0003", "Surat keterangan kepala desa (contoh)", "Menunggu"],
];

async function seed() {
  for (let i = 0; i < 30; i++) {
    try {
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM users");
      if (n === 0) {
        for (const [nama, username, pw, role, email] of SEED)
          await pool.query("INSERT INTO users (nama, username, email, password_hash, role) VALUES (?,?,?,?,?)",
            [nama, username, email, bcrypt.hashSync(pw, 10), role]);
        // alamat contoh pembeli: Kota Balikpapan (untuk demo kirim lewat laut dari Jawa)
        await pool.query("UPDATE users SET no_hp='0812-0000-0005', provinsi='KALIMANTAN TIMUR', kota_id=6471, kota='Kota Balikpapan', alamat='Jl. Jenderal Sudirman No. 10' WHERE username='rina'");
        console.log("akun awal dibuat");
      }
      const [[{ t }]] = await pool.query("SELECT COUNT(*) AS t FROM toko");
      if (t === 0) {
        for (const [username, ...v] of SEED_TOKO) {
          const [[u]] = await pool.query("SELECT id FROM users WHERE username=?", [username]);
          if (u) await pool.query(`INSERT INTO toko (user_id, nama_toko, provinsi, kota, kota_id, alamat, komoditas_utama, luas_lahan_ha,
            hasil_per_panen_kg, kontak, bukti, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [u.id, ...v]);
        }
        console.log("toko contoh dibuat");
      }
      return;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

app.get("/api/auth/health", async (req, res) => {
  try { await pool.query("SELECT 1"); ok(res, { database: "terhubung" }, 200, "layanan-auth sehat"); }
  catch (e) { err(res, `database tidak terhubung: ${e.message}`, 503); }
});

app.post("/api/auth/register", async (req, res) => {
  const { nama, password, role = "pembeli" } = req.body || {};
  const email = String(req.body?.email || "").trim().toLowerCase();
  const username = String(req.body?.username || email).trim();
  if (!nama || !email || !password) return err(res, "nama, email, dan password wajib diisi", 400);
  if (!EMAIL.test(email)) return err(res, "format email tidak valid", 400);
  if (!["penjual", "pembeli"].includes(role)) return err(res, "peran hanya boleh penjual atau pembeli", 400);
  if (String(password).length < 6) return err(res, "password minimal 6 karakter", 400);
  try {
    const [r] = await pool.query("INSERT INTO users (nama, username, email, password_hash, role) VALUES (?,?,?,?,?)",
      [nama, username, email, bcrypt.hashSync(password, 10), role]);
    const [[u]] = await pool.query("SELECT * FROM users WHERE id=?", [r.insertId]);
    await notif(u.id, "Selamat datang di TaniMart", role === "penjual" ? "Buka toko Anda agar produk bisa tampil di katalog." : "Lengkapi alamat kirim di Akun Saya supaya ongkir bisa dihitung.", "akun");
    ok(res, publik(u), 201, "akun berhasil dibuat, silakan login");
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return err(res, "email atau username sudah terdaftar", 409);
    throw e;
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  const id = String(username || req.body?.email || "").trim();
  const [[u]] = await pool.query("SELECT * FROM users WHERE username=? OR email=?", [id, id.toLowerCase()]);
  if (!u || !bcrypt.compareSync(password || "", u.password_hash)) return err(res, "email/username atau password salah", 401);
  const token = jwt.sign({ id: u.id, nama: u.nama, role: u.role }, SECRET, { expiresIn: "8h" });
  ok(res, { token, token_type: "Bearer", expires_in: "8h", user: publik(u) }, 200, "login berhasil");
});

// Dipanggil Nginx (auth_request): 200 = boleh lanjut, 401 = tolak
app.get("/api/auth/verify", (req, res) => {
  const u = bacaToken(req);
  if (!u) return res.status(401).end();
  res.set("X-User-Id", String(u.id)).set("X-User-Role", u.role).set("X-User-Name", encodeURIComponent(u.nama)).status(200).end();
});

app.get("/api/auth/me", (req, res) => {
  const u = bacaToken(req);
  if (!u) return err(res, "token tidak valid atau kedaluwarsa", 401);
  ok(res, { id: u.id, nama: u.nama, role: u.role });
});

// ---- Manajemen pengguna (admin)
app.get("/api/auth/users", butuhAdmin, async (req, res) => {
  let sql = "SELECT * FROM users";
  const args = [];
  if (req.query.role) { sql += " WHERE role=?"; args.push(req.query.role); }
  const [rows] = await pool.query(sql + " ORDER BY id", args);
  ok(res, rows.map(publik), 200, `${rows.length} pengguna ditemukan`);
});

app.post("/api/auth/users", butuhAdmin, async (req, res) => {
  const { nama, username, password, role } = req.body || {};
  if (!nama || !username || !password || !role) return err(res, "nama, username, password, role wajib diisi", 400);
  if (!ROLES.includes(role)) return err(res, "role tidak dikenal", 400);
  const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
  if (email && !EMAIL.test(email)) return err(res, "format email tidak valid", 400);
  try {
    const [r] = await pool.query("INSERT INTO users (nama, username, email, password_hash, role) VALUES (?,?,?,?,?)",
      [nama, username, email, bcrypt.hashSync(password, 10), role]);
    const [[u]] = await pool.query("SELECT * FROM users WHERE id=?", [r.insertId]);
    ok(res, publik(u), 201, "pengguna berhasil ditambahkan");
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return err(res, "username sudah dipakai", 409);
    throw e;
  }
});

app.put("/api/auth/users/:id", butuhAdmin, async (req, res) => {
  const b = req.body || {};
  const sets = [], args = [];
  for (const f of ["nama", "username", "role", "email"]) if (b[f]) { sets.push(`${f}=?`); args.push(b[f]); }
  if (b.email && !EMAIL.test(b.email)) return err(res, "format email tidak valid", 400);
  if (b.role && !ROLES.includes(b.role)) return err(res, "role tidak dikenal", 400);
  if (b.password) { sets.push("password_hash=?"); args.push(bcrypt.hashSync(b.password, 10)); }
  if (!sets.length) return err(res, "tidak ada field yang diubah", 400);
  const [r] = await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id=?`, [...args, req.params.id]);
  if (!r.affectedRows) return err(res, `pengguna id ${req.params.id} tidak ditemukan`, 404);
  const [[u]] = await pool.query("SELECT * FROM users WHERE id=?", [req.params.id]);
  ok(res, publik(u), 200, "pengguna berhasil diperbarui");
});

app.delete("/api/auth/users/:id", butuhAdmin, async (req, res) => {
  if (Number(req.params.id) === req.user.id) return err(res, "tidak bisa menghapus akun sendiri", 400);
  const [r] = await pool.query("DELETE FROM users WHERE id=?", [req.params.id]);
  if (!r.affectedRows) return err(res, `pengguna id ${req.params.id} tidak ditemukan`, 404);
  ok(res, { id: Number(req.params.id) }, 200, "pengguna berhasil dihapus");
});

// ---- Toko penjual + verifikasi admin
const F_TOKO = ["nama_toko", "provinsi", "kota", "alamat", "komoditas_utama", "luas_lahan_ha", "hasil_per_panen_kg", "kontak", "bukti", "kota_id", "deskripsi"];
const OPSIONAL_TOKO = ["bukti", "kota_id", "deskripsi"];
const STATUS_TOKO = ["Menunggu", "Terverifikasi", "Ditolak"];
const butuhLogin = (req, res, next) => {
  const u = bacaToken(req);
  if (!u) return err(res, "silakan login terlebih dahulu", 401);
  req.user = u;
  next();
};
const tokoPublik = (t) => ({ id: t.id, user_id: t.user_id, nama_toko: t.nama_toko, provinsi: t.provinsi, kota: t.kota, kota_id: t.kota_id, deskripsi: t.deskripsi,
  komoditas_utama: t.komoditas_utama, luas_lahan_ha: Number(t.luas_lahan_ha), hasil_per_panen_kg: Number(t.hasil_per_panen_kg) });
const tokoLengkap = (t) => ({ ...t, luas_lahan_ha: Number(t.luas_lahan_ha), hasil_per_panen_kg: Number(t.hasil_per_panen_kg) });
const SQL_TOKO = "SELECT t.*, u.nama AS nama_penjual, u.username FROM toko t JOIN users u ON u.id=t.user_id";

function cekToko(b, parsial) {
  const out = {};
  for (const f of F_TOKO) {
    if (b[f] === undefined || b[f] === null || String(b[f]).trim() === "") {
      if (!parsial && !OPSIONAL_TOKO.includes(f)) return [null, `field wajib kosong: ${f}`];
      continue;
    }
    let v = typeof b[f] === "string" ? b[f].trim() : b[f];
    if (f === "kota_id") { v = parseInt(v, 10); if (!(v > 0)) return [null, "kota_id tidak valid"]; out[f] = v; continue; }
    if (f === "luas_lahan_ha" || f === "hasil_per_panen_kg") {
      v = Number(v);
      if (!(v > 0)) return [null, `${f} harus angka lebih dari 0`];
    } else if (String(v).length > 200) return [null, `${f} terlalu panjang`];
    if (f === "kontak" && !/^[0-9+\-\s]{8,20}$/.test(v)) return [null, "kontak harus nomor telepon (8-20 digit)"];
    out[f] = v;
  }
  return [out, null];
}

// Publik (halaman Info & katalog): hanya toko terverifikasi, tanpa kontak/alamat/bukti
app.get("/api/auth/toko/publik", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM toko WHERE status='Terverifikasi' ORDER BY provinsi, kota");
  ok(res, rows.map(tokoPublik), 200, `${rows.length} toko terverifikasi`);
});

// Login: admin melihat semua; penjual/pembeli melihat toko terverifikasi lengkap dengan kontak & alamat
app.get("/api/auth/toko", butuhLogin, async (req, res) => {
  const admin = req.user.role === "admin";
  const [rows] = await pool.query(SQL_TOKO + (admin ? "" : " WHERE t.status='Terverifikasi'") + " ORDER BY t.id");
  ok(res, rows.map((t) => { const x = tokoLengkap(t); if (!admin) { delete x.bukti; delete x.catatan_admin; } return x; }));
});

app.get("/api/auth/toko/saya", butuhLogin, async (req, res) => {
  const [[t]] = await pool.query(SQL_TOKO + " WHERE t.user_id=?", [req.user.id]);
  ok(res, t ? tokoLengkap(t) : null, 200, t ? "toko ditemukan" : "anda belum membuka toko");
});

app.post("/api/auth/toko", butuhLogin, async (req, res) => {
  const b = req.body || {};
  let uid = req.user.id;
  if (req.user.role === "admin") uid = Number(b.user_id);
  else if (req.user.role !== "penjual") return err(res, "hanya penjual yang bisa membuka toko", 403);
  const [[pemilik]] = await pool.query("SELECT id, role FROM users WHERE id=?", [uid || 0]);
  if (!pemilik || pemilik.role !== "penjual") return err(res, "pemilik toko harus akun penjual", 400);
  const [d, e] = cekToko(b, false);
  if (e) return err(res, e, 400);
  try {
    const [r] = await pool.query(`INSERT INTO toko (user_id, ${Object.keys(d).join(",")}) VALUES (?, ${Object.keys(d).map(() => "?").join(",")})`,
      [uid, ...Object.values(d)]);
    const [[t]] = await pool.query(SQL_TOKO + " WHERE t.id=?", [r.insertId]);
    ok(res, tokoLengkap(t), 201, "toko berhasil dibuat, menunggu verifikasi admin");
  } catch (x) {
    if (x.code === "ER_DUP_ENTRY") return err(res, "penjual ini sudah punya toko, ubah toko yang ada", 409);
    throw x;
  }
});

app.put("/api/auth/toko/:id", butuhLogin, async (req, res) => {
  const [[lama]] = await pool.query("SELECT * FROM toko WHERE id=?", [req.params.id]);
  if (!lama) return err(res, `toko id ${req.params.id} tidak ditemukan`, 404);
  const admin = req.user.role === "admin";
  if (!admin && lama.user_id !== req.user.id) return err(res, "anda hanya boleh mengubah toko sendiri", 403);
  const b = req.body || {};
  const [d, e] = cekToko(b, true);
  if (e) return err(res, e, 400);
  if (admin) {
    if (b.status !== undefined) {
      if (!STATUS_TOKO.includes(b.status)) return err(res, "status harus Menunggu, Terverifikasi, atau Ditolak", 400);
      d.status = b.status;
    }
    if (b.catatan_admin !== undefined) d.catatan_admin = String(b.catatan_admin).slice(0, 200) || null;
  } else if (Object.keys(d).length) {
    d.status = "Menunggu";            // data berubah -> perlu diverifikasi ulang
    d.catatan_admin = null;
  }
  if (!Object.keys(d).length) return err(res, "tidak ada data yang diubah", 400);
  await pool.query(`UPDATE toko SET ${Object.keys(d).map((k) => k + "=?").join(", ")} WHERE id=?`, [...Object.values(d), req.params.id]);
  const [[t]] = await pool.query(SQL_TOKO + " WHERE t.id=?", [req.params.id]);
  if (admin && d.status && d.status !== lama.status)
    await notif(lama.user_id, `Toko ${d.status === "Terverifikasi" ? "terverifikasi" : d.status === "Ditolak" ? "ditolak" : "diperiksa ulang"}`,
      d.status === "Terverifikasi" ? `${t.nama_toko} sudah terverifikasi. Produk Anda kini tampil di katalog.`
        : d.status === "Ditolak" ? `Alasan: ${d.catatan_admin || "-"}. Perbaiki data toko lalu simpan lagi.` : "Admin akan memeriksa data toko Anda.", "toko");
  const pesan = admin && d.status ? `toko ditandai ${d.status}` : admin ? "toko berhasil diperbarui" : "toko diperbarui, menunggu verifikasi ulang admin";
  ok(res, tokoLengkap(t), 200, pesan);
});

app.delete("/api/auth/toko/:id", butuhLogin, async (req, res) => {
  const [[lama]] = await pool.query("SELECT * FROM toko WHERE id=?", [req.params.id]);
  if (!lama) return err(res, `toko id ${req.params.id} tidak ditemukan`, 404);
  if (req.user.role !== "admin" && lama.user_id !== req.user.id) return err(res, "anda hanya boleh menutup toko sendiri", 403);
  await pool.query("DELETE FROM toko WHERE id=?", [req.params.id]);
  ok(res, { id: Number(req.params.id) }, 200, "toko berhasil ditutup");
});

// ---- Profil & alamat kirim
app.get("/api/auth/profil", butuhLogin, async (req, res) => {
  const [[u]] = await pool.query("SELECT * FROM users WHERE id=?", [req.user.id]);
  if (!u) return err(res, "akun tidak ditemukan", 404);
  ok(res, publik(u));
});
app.put("/api/auth/profil", butuhLogin, async (req, res) => {
  const b = req.body || {}, sets = [], args = [];
  if (b.email !== undefined) {
    b.email = String(b.email).trim().toLowerCase();
    if (!EMAIL.test(b.email)) return err(res, "format email tidak valid", 400);
  }
  if (b.no_hp && !/^[0-9+\-\s]{8,20}$/.test(b.no_hp)) return err(res, "nomor HP harus 8-20 digit", 400);
  if (b.kota_id !== undefined && b.kota_id !== null && b.kota_id !== "" && !(parseInt(b.kota_id, 10) > 0)) return err(res, "kota tidak valid", 400);
  for (const f of ["nama", "email", "no_hp", "provinsi", "kota_id", "kota", "alamat"])
    if (b[f] !== undefined) { sets.push(`${f}=?`); args.push(b[f] === "" ? null : f === "kota_id" ? parseInt(b[f], 10) : String(b[f]).slice(0, 200)); }
  if (!sets.length) return err(res, "tidak ada data yang diubah", 400);
  try { await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id=?`, [...args, req.user.id]); }
  catch (e) { if (e.code === "ER_DUP_ENTRY") return err(res, "email sudah dipakai akun lain", 409); throw e; }
  const [[u]] = await pool.query("SELECT * FROM users WHERE id=?", [req.user.id]);
  ok(res, publik(u), 200, "profil berhasil disimpan");
});
app.post("/api/auth/password", butuhLogin, async (req, res) => {
  const { lama, baru } = req.body || {};
  const [[u]] = await pool.query("SELECT * FROM users WHERE id=?", [req.user.id]);
  if (!u || !bcrypt.compareSync(lama || "", u.password_hash)) return err(res, "password lama salah", 400);
  if (String(baru || "").length < 6) return err(res, "password baru minimal 6 karakter", 400);
  await pool.query("UPDATE users SET password_hash=? WHERE id=?", [bcrypt.hashSync(baru, 10), u.id]);
  ok(res, null, 200, "password berhasil diganti");
});

// ---- Lupa password (SIMULASI: kode ditampilkan di layar, seolah-olah dikirim ke email)
app.post("/api/auth/lupa", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) return err(res, "masukkan email yang valid", 400);
  const [[u]] = await pool.query("SELECT id FROM users WHERE email=?", [email]);
  if (!u) return err(res, "email ini belum terdaftar", 404);
  const kode = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await pool.query("UPDATE reset_password SET dipakai=1 WHERE user_id=? AND dipakai=0", [u.id]);
  await pool.query("INSERT INTO reset_password (user_id, kode, berlaku_sampai) VALUES (?,?, NOW() + INTERVAL 15 MINUTE)", [u.id, kode]);
  ok(res, { email, kode, berlaku_menit: 15, simulasi: true }, 200, "kode reset dibuat (simulasi kotak masuk email)");
});
app.post("/api/auth/reset", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const { kode, password } = req.body || {};
  if (String(password || "").length < 6) return err(res, "password baru minimal 6 karakter", 400);
  const [[u]] = await pool.query("SELECT id FROM users WHERE email=?", [email]);
  const [[r]] = u ? await pool.query("SELECT * FROM reset_password WHERE user_id=? AND dipakai=0 AND berlaku_sampai > NOW() ORDER BY id DESC LIMIT 1", [u.id]) : [[]];
  if (!r) return err(res, "kode tidak ada atau sudah kedaluwarsa, minta kode baru", 400);
  if (r.percobaan >= 5) return err(res, "terlalu banyak percobaan, minta kode baru", 429);
  if (r.kode !== String(kode || "")) {
    await pool.query("UPDATE reset_password SET percobaan=percobaan+1 WHERE id=?", [r.id]);
    return err(res, "kode salah", 400);
  }
  await pool.query("UPDATE reset_password SET dipakai=1 WHERE id=?", [r.id]);
  await pool.query("UPDATE users SET password_hash=? WHERE id=?", [bcrypt.hashSync(password, 10), u.id]);
  await notif(u.id, "Password diganti", "Password akun Anda baru saja direset. Jika bukan Anda, hubungi admin.", "akun");
  ok(res, null, 200, "password berhasil direset, silakan login");
});

// ---- Notifikasi
app.get("/api/auth/notifikasi", butuhLogin, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM notifikasi WHERE user_id=? ORDER BY id DESC LIMIT 30", [req.user.id]);
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM notifikasi WHERE user_id=? AND dibaca=0", [req.user.id]);
  ok(res, { belum_dibaca: n, daftar: rows });
});
app.post("/api/auth/notifikasi/baca", butuhLogin, async (req, res) => {
  await pool.query("UPDATE notifikasi SET dibaca=1 WHERE user_id=?", [req.user.id]);
  ok(res, null, 200, "notifikasi ditandai sudah dibaca");
});
// Dipanggil layanan lain di dalam jaringan Docker (gateway memblokir /api/auth/internal dari luar)
app.post("/api/auth/internal/notifikasi", async (req, res) => {
  const { user_id, judul, isi, tautan } = req.body || {};
  if (!user_id || !judul || !isi) return err(res, "user_id, judul, isi wajib", 400);
  await notif(user_id, String(judul).slice(0, 120), isi, tautan);
  ok(res, null, 201, "notifikasi dibuat");
});
app.get("/api/auth/internal/kontak/:id", async (req, res) => {
  const [[u]] = await pool.query("SELECT id, nama, provinsi, kota_id, kota, alamat, no_hp FROM users WHERE id=?", [req.params.id]);
  return u ? ok(res, u) : err(res, "akun tidak ditemukan", 404);
});

app.use((e, req, res, next) => err(res, e.message, 500));

seed().then(() => app.listen(3000, "0.0.0.0", () => console.log("layanan-auth berjalan di port 3000")));
