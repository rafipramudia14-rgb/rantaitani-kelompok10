// TaniMart - Layanan Panen (Express): CRUD hasil panen = produk (foto, deskripsi, promo), database db_panen.
// Memvalidasi lahan_id & kepemilikan dengan memanggil layanan-lahan lewat Docker network.
// Identitas pengguna dari gateway: header X-User-Id / X-User-Role (tanpa header = panggilan internal).
const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json({ limit: "4mb" }));   // foto produk dikirim sebagai data URL
const FOLDER_FOTO = process.env.UPLOAD_DIR || "/data/uploads/produk";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "db",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "db_panen",
  waitForConnections: true,
  connectionLimit: 5,
  dateStrings: true,
  decimalNumbers: true,
});
const LAHAN_URL = process.env.LAHAN_SERVICE_URL || "http://layanan-lahan:5000";
const FIELDS = ["lahan_id", "tanggal_panen", "komoditas", "jumlah_kg", "kualitas", "harga_per_kg", "catatan",
  "nama_produk", "deskripsi", "harga_promo", "promo_sampai", "unggulan"];
const REQUIRED = ["lahan_id", "tanggal_panen", "komoditas", "jumlah_kg", "harga_per_kg"];

const ok = (res, data, code = 200, message = "success") =>
  res.status(code).json({ status: "success", service: "layanan-panen", message, data });
const err = (res, message, code) =>
  res.status(code).json({ status: "error", service: "layanan-panen", message });

const hariIni = () => new Date().toISOString().slice(0, 10);
const promoAktif = (r) => r.harga_promo != null && r.harga_promo < r.harga_per_kg && (!r.promo_sampai || r.promo_sampai >= hariIni());
const withTotal = (r) => {
  const promo = promoAktif(r);
  return { ...r, unggulan: !!r.unggulan, promo_aktif: promo, harga_aktif: promo ? r.harga_promo : r.harga_per_kg,
    diskon_persen: promo ? Math.round((1 - r.harga_promo / r.harga_per_kg) * 100) : 0,
    total_nilai: Number((r.jumlah_kg * r.harga_per_kg).toFixed(2)) };
};
// Nilai kosong dari form -> NULL; promo harus lebih murah dari harga normal
function rapikan(b, lama = {}) {
  for (const f of ["harga_promo", "promo_sampai", "nama_produk", "deskripsi"]) if (b[f] === "") b[f] = null;
  if ("unggulan" in b) b.unggulan = b.unggulan === true || b.unggulan === 1 || b.unggulan === "1" || b.unggulan === "on" ? 1 : 0;
  const normal = Number(b.harga_per_kg ?? lama.harga_per_kg);
  if (b.harga_promo != null && !(Number(b.harga_promo) > 0 && Number(b.harga_promo) < normal))
    return "harga promo harus lebih dari 0 dan lebih murah dari harga normal";
  if (b.deskripsi && String(b.deskripsi).length > 500) return "deskripsi maksimal 500 karakter";
  return null;
}
const pengguna = (req) =>
  req.get("X-User-Role") ? { id: Number(req.get("X-User-Id")), role: req.get("X-User-Role") } : null;
const bolehUbah = (u, row) => !u || u.role === "admin" || (u.role === "penjual" && row.pemilik_id === u.id);

async function cekLahan(id) {
  try {
    const r = await fetch(`${LAHAN_URL}/api/lahan/${id}`);
    if (r.status === 404) return { ada: false };
    if (!r.ok) return { ada: null };
    return { ada: true, lahan: (await r.json()).data };
  } catch {
    return { ada: null };
  }
}

app.get("/api/panen/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    const lahan = await fetch(`${LAHAN_URL}/api/lahan/health`).then((r) => r.ok).catch(() => false);
    ok(res, { database: "terhubung", layanan_lahan: lahan ? "terhubung" : "tidak terhubung" }, 200, "layanan-panen sehat");
  } catch (e) {
    err(res, `database tidak terhubung: ${e.message}`, 503);
  }
});

app.get("/api/panen", async (req, res) => {
  const u = pengguna(req);
  const where = [], args = [];
  if (u && u.role === "penjual") { where.push("pemilik_id = ?"); args.push(u.id); }   // penjual: panen sendiri
  if (req.query.lahan_id) { where.push("lahan_id = ?"); args.push(req.query.lahan_id); }
  const sql = "SELECT * FROM panen" + (where.length ? " WHERE " + where.join(" AND ") : "");
  const [rows] = await pool.query(sql + " ORDER BY tanggal_panen DESC, id DESC", args);
  ok(res, rows.map(withTotal), 200, `${rows.length} data panen ditemukan`);
});

// ---- Iklan produk (didefinisikan sebelum /api/panen/:id supaya "iklan" tidak dianggap id)
const F_IKLAN = ["panen_id", "judul", "kata_kunci", "mulai", "selesai", "anggaran_harian", "status"];
function cekIklan(b, parsial) {
  const out = {};
  for (const f of F_IKLAN) {
    if (b[f] === undefined || b[f] === "") {
      if (!parsial && !["anggaran_harian", "status"].includes(f)) return [null, `field wajib kosong: ${f}`];
      continue;
    }
    let v = typeof b[f] === "string" ? b[f].trim() : b[f];
    if ((f === "mulai" || f === "selesai") && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return [null, `${f} harus tanggal YYYY-MM-DD`];
    if (f === "anggaran_harian") { v = parseInt(v, 10); if (!(v >= 5000 && v <= 10000000)) return [null, "anggaran harian Rp5.000 sampai Rp10.000.000"]; }
    if (f === "status" && !["Aktif", "Dijeda"].includes(v)) return [null, "status harus Aktif atau Dijeda"];
    if (f === "judul" && String(v).length > 80) return [null, "judul iklan maksimal 80 karakter"];
    if (f === "kata_kunci" && String(v).length > 200) return [null, "kata kunci maksimal 200 karakter"];
    if (f === "panen_id") v = parseInt(v, 10);
    out[f] = v;
  }
  if (out.mulai && out.selesai && out.selesai < out.mulai) return [null, "tanggal selesai tidak boleh sebelum tanggal mulai"];
  return [out, null];
}
const ctr = (r) => ({ ...r, ctr_persen: r.tayang ? Math.round((r.klik / r.tayang) * 1000) / 10 : 0,
  berjalan: r.status === "Aktif" && r.mulai <= hariIni() && r.selesai >= hariIni() });

app.get("/api/panen/iklan", async (req, res) => {
  const u = pengguna(req);
  if (!u || u.role === "pembeli") return err(res, "hanya penjual dan admin", 403);
  const [rows] = await pool.query(
    `SELECT i.*, p.nama_produk, p.komoditas, p.foto FROM iklan i JOIN panen p ON p.id = i.panen_id ${u.role === "penjual" ? "WHERE i.penjual_id = ?" : ""} ORDER BY i.id DESC`,
    u.role === "penjual" ? [u.id] : []);
  ok(res, rows.map(ctr), 200, `${rows.length} iklan`);
});

// Iklan yang sedang tayang (untuk slot "Bersponsor" di halaman Belanja). ?q= mencocokkan kata kunci/nama produk
app.get("/api/panen/iklan/tayang", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const [rows] = await pool.query(
    `SELECT i.id, i.panen_id, i.judul, i.kata_kunci, p.nama_produk, p.komoditas FROM iklan i JOIN panen p ON p.id = i.panen_id
     WHERE i.status = 'Aktif' AND i.mulai <= CURDATE() AND i.selesai >= CURDATE() ORDER BY i.anggaran_harian DESC, i.id`);
  const cocok = rows.filter((r) => !q || [r.kata_kunci, r.nama_produk, r.komoditas, r.judul].join(" ").toLowerCase().includes(q)).slice(0, 4);
  if (cocok.length) await pool.query(`UPDATE iklan SET tayang = tayang + 1 WHERE id IN (${cocok.map(() => "?").join(",")})`, cocok.map((r) => r.id));
  ok(res, cocok, 200, `${cocok.length} iklan tayang`);
});

app.post("/api/panen/iklan/:id/klik", async (req, res) => {
  const [r] = await pool.query("UPDATE iklan SET klik = klik + 1 WHERE id = ?", [req.params.id]);
  return r.affectedRows ? ok(res, { id: Number(req.params.id) }, 200, "klik dicatat") : err(res, "iklan tidak ditemukan", 404);
});

app.post("/api/panen/iklan", async (req, res) => {
  const u = pengguna(req);
  if (!u || u.role !== "penjual") return err(res, "hanya penjual yang bisa memasang iklan", 403);
  const [d, e] = cekIklan(req.body || {}, false);
  if (e) return err(res, e, 400);
  const [p] = await pool.query("SELECT * FROM panen WHERE id = ?", [d.panen_id]);
  if (!p.length || p[0].pemilik_id !== u.id) return err(res, "produk tidak ditemukan atau bukan milik anda", 403);
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM iklan WHERE penjual_id = ? AND status = 'Aktif' AND selesai >= CURDATE()", [u.id]);
  if (n >= 3) return err(res, "maksimal 3 iklan aktif per toko; jeda atau hapus iklan lain dulu", 422);
  const cols = Object.keys(d);
  const [r] = await pool.query(`INSERT INTO iklan (${cols.join(",")}, penjual_id) VALUES (${cols.map(() => "?").join(",")}, ?)`, [...cols.map((c) => d[c]), u.id]);
  const [rows] = await pool.query("SELECT * FROM iklan WHERE id = ?", [r.insertId]);
  ok(res, ctr(rows[0]), 201, "iklan dipasang");
});

app.put("/api/panen/iklan/:id", async (req, res) => {
  const u = pengguna(req);
  const [lama] = await pool.query("SELECT * FROM iklan WHERE id = ?", [req.params.id]);
  if (!lama.length) return err(res, `iklan id ${req.params.id} tidak ditemukan`, 404);
  if (!u || !(u.role === "admin" || lama[0].penjual_id === u.id)) return err(res, "anda hanya boleh mengubah iklan sendiri", 403);
  const [d, e] = cekIklan(req.body || {}, true);
  if (e) return err(res, e, 400);
  if (d.panen_id) {
    const [p] = await pool.query("SELECT pemilik_id FROM panen WHERE id = ?", [d.panen_id]);
    if (!p.length || p[0].pemilik_id !== lama[0].penjual_id) return err(res, "produk bukan milik toko ini", 403);
  }
  if (!Object.keys(d).length) return err(res, "tidak ada data yang diubah", 400);
  if ((d.mulai || lama[0].mulai) > (d.selesai || lama[0].selesai)) return err(res, "tanggal selesai tidak boleh sebelum tanggal mulai", 400);
  await pool.query(`UPDATE iklan SET ${Object.keys(d).map((k) => k + " = ?").join(", ")} WHERE id = ?`, [...Object.values(d), req.params.id]);
  const [rows] = await pool.query("SELECT * FROM iklan WHERE id = ?", [req.params.id]);
  ok(res, ctr(rows[0]), 200, d.status === "Dijeda" ? "iklan dijeda" : "iklan diperbarui");
});

app.delete("/api/panen/iklan/:id", async (req, res) => {
  const u = pengguna(req);
  const [lama] = await pool.query("SELECT * FROM iklan WHERE id = ?", [req.params.id]);
  if (!lama.length) return err(res, `iklan id ${req.params.id} tidak ditemukan`, 404);
  if (!u || !(u.role === "admin" || lama[0].penjual_id === u.id)) return err(res, "anda hanya boleh menghapus iklan sendiri", 403);
  await pool.query("DELETE FROM iklan WHERE id = ?", [req.params.id]);
  ok(res, { id: Number(req.params.id) }, 200, "iklan dihapus");
});

app.get("/api/panen/:id", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM panen WHERE id = ?", [req.params.id]);
  if (!rows.length) return err(res, `panen id ${req.params.id} tidak ditemukan`, 404);
  const { lahan } = await cekLahan(rows[0].lahan_id);
  ok(res, { ...withTotal(rows[0]), lahan: lahan || null });
});

async function validasiLahan(res, u, lahanId) {
  const cek = await cekLahan(lahanId);
  if (cek.ada === false) { err(res, `lahan id ${lahanId} tidak terdaftar di layanan-lahan`, 422); return null; }
  if (cek.ada === null) { err(res, "layanan-lahan tidak dapat dihubungi", 503); return null; }
  if (u && u.role === "penjual" && cek.lahan.pemilik_id !== u.id) {
    err(res, "anda hanya boleh mencatat panen di lahan milik sendiri", 403); return null;
  }
  return cek.lahan;
}

app.post("/api/panen", async (req, res) => {
  const u = pengguna(req);
  if (u && u.role === "pembeli") return err(res, "pembeli tidak boleh mencatat panen", 403);
  const b = req.body || {};
  const missing = REQUIRED.filter((f) => b[f] === undefined || b[f] === "");
  if (missing.length) return err(res, `field wajib kosong: ${missing.join(", ")}`, 400);
  const salah = rapikan(b);
  if (salah) return err(res, salah, 400);
  const lahan = await validasiLahan(res, u, b.lahan_id);
  if (!lahan) return;
  const cols = FIELDS.filter((f) => f in b);
  const [r] = await pool.query(
    `INSERT INTO panen (${cols.join(", ")}, pemilik_id) VALUES (${cols.map(() => "?").join(", ")}, ?)`,
    [...cols.map((f) => b[f]), lahan.pemilik_id]
  );
  const [rows] = await pool.query("SELECT * FROM panen WHERE id = ?", [r.insertId]);
  ok(res, withTotal(rows[0]), 201, "data panen berhasil ditambahkan");
});

app.put("/api/panen/:id", async (req, res) => {
  const u = pengguna(req);
  const b = req.body || {};
  const cols = FIELDS.filter((f) => f in b);
  if (!cols.length) return err(res, "tidak ada field yang diubah", 400);
  const [lama] = await pool.query("SELECT * FROM panen WHERE id = ?", [req.params.id]);
  if (!lama.length) return err(res, `panen id ${req.params.id} tidak ditemukan`, 404);
  if (!bolehUbah(u, lama[0])) return err(res, "anda hanya boleh mengubah panen milik sendiri", 403);
  const salah = rapikan(b, lama[0]);
  if (salah) return err(res, salah, 400);
  const sets = cols.map((f) => `${f} = ?`), args = cols.map((f) => b[f]);
  if ("lahan_id" in b) {
    const lahan = await validasiLahan(res, u, b.lahan_id);
    if (!lahan) return;
    sets.push("pemilik_id = ?"); args.push(lahan.pemilik_id);
  }
  await pool.query(`UPDATE panen SET ${sets.join(", ")} WHERE id = ?`, [...args, req.params.id]);
  const [rows] = await pool.query("SELECT * FROM panen WHERE id = ?", [req.params.id]);
  ok(res, withTotal(rows[0]), 200, "data panen berhasil diperbarui");
});

app.delete("/api/panen/:id", async (req, res) => {
  const u = pengguna(req);
  const [lama] = await pool.query("SELECT * FROM panen WHERE id = ?", [req.params.id]);
  if (!lama.length) return err(res, `panen id ${req.params.id} tidak ditemukan`, 404);
  if (!bolehUbah(u, lama[0])) return err(res, "anda hanya boleh menghapus panen milik sendiri", 403);
  await pool.query("DELETE FROM panen WHERE id = ?", [req.params.id]);
  await hapusFile(lama[0].foto);
  ok(res, { id: Number(req.params.id) }, 200, "data panen berhasil dihapus");
});

// ---- Foto produk: data URL JPEG/PNG/WebP maks 2 MB, disimpan di volume, disajikan gateway di /uploads/produk/
const JENIS = { "image/jpeg": ["jpg", [0xff, 0xd8, 0xff]], "image/png": ["png", [0x89, 0x50, 0x4e, 0x47]], "image/webp": ["webp", [0x52, 0x49, 0x46, 0x46]] };
async function hapusFile(url) {
  if (url && url.startsWith("/uploads/produk/")) await fs.unlink(path.join(FOLDER_FOTO, path.basename(url))).catch(() => {});
}
app.post("/api/panen/:id/foto", async (req, res) => {
  const u = pengguna(req);
  const [lama] = await pool.query("SELECT * FROM panen WHERE id = ?", [req.params.id]);
  if (!lama.length) return err(res, `panen id ${req.params.id} tidak ditemukan`, 404);
  if (!bolehUbah(u, lama[0]) || (u && u.role === "pembeli")) return err(res, "anda hanya boleh mengubah foto produk sendiri", 403);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.gambar || ""));
  if (!m) return err(res, "kirim gambar JPG, PNG, atau WebP", 400);
  const buf = Buffer.from(m[2], "base64");
  const [ext, sig] = JENIS[m[1]];
  if (buf.length > 2 * 1024 * 1024) return err(res, "ukuran foto maksimal 2 MB", 413);
  if (!sig.every((b, i) => buf[i] === b)) return err(res, "isi file bukan gambar yang valid", 400);
  const nama = `${lama[0].id}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  await fs.mkdir(FOLDER_FOTO, { recursive: true });
  await fs.writeFile(path.join(FOLDER_FOTO, nama), buf);
  await hapusFile(lama[0].foto);
  await pool.query("UPDATE panen SET foto = ? WHERE id = ?", [`/uploads/produk/${nama}`, lama[0].id]);
  const [rows] = await pool.query("SELECT * FROM panen WHERE id = ?", [lama[0].id]);
  ok(res, withTotal(rows[0]), 200, "foto produk berhasil diunggah");
});
app.delete("/api/panen/:id/foto", async (req, res) => {
  const u = pengguna(req);
  const [lama] = await pool.query("SELECT * FROM panen WHERE id = ?", [req.params.id]);
  if (!lama.length) return err(res, `panen id ${req.params.id} tidak ditemukan`, 404);
  if (!bolehUbah(u, lama[0]) || (u && u.role === "pembeli")) return err(res, "anda hanya boleh mengubah foto produk sendiri", 403);
  await hapusFile(lama[0].foto);
  await pool.query("UPDATE panen SET foto = NULL WHERE id = ?", [lama[0].id]);
  ok(res, { id: lama[0].id }, 200, "foto produk dihapus");
});

app.use((e, req, res, next) => err(res, e.message, 500));

app.listen(3000, "0.0.0.0", () => console.log("layanan-panen berjalan di port 3000"));
