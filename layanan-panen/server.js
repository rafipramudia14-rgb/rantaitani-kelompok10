// RantaiTani - Layanan Panen (Express): CRUD data hasil panen, database db_panen.
// Memvalidasi lahan_id & kepemilikan dengan memanggil layanan-lahan lewat Docker network.
// Identitas pengguna dari gateway: header X-User-Id / X-User-Role (tanpa header = panggilan internal).
const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.json());

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
const FIELDS = ["lahan_id", "tanggal_panen", "komoditas", "jumlah_kg", "kualitas", "harga_per_kg", "catatan"];
const REQUIRED = ["lahan_id", "tanggal_panen", "komoditas", "jumlah_kg", "harga_per_kg"];

const ok = (res, data, code = 200, message = "success") =>
  res.status(code).json({ status: "success", service: "layanan-panen", message, data });
const err = (res, message, code) =>
  res.status(code).json({ status: "error", service: "layanan-panen", message });

const withTotal = (r) => ({ ...r, total_nilai: Number((r.jumlah_kg * r.harga_per_kg).toFixed(2)) });
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
  ok(res, { id: Number(req.params.id) }, 200, "data panen berhasil dihapus");
});

app.use((e, req, res, next) => err(res, e.message, 500));

app.listen(3000, "0.0.0.0", () => console.log("layanan-panen berjalan di port 3000"));
