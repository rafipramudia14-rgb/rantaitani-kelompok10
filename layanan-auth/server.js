// RantaiTani - Layanan Auth (Express): login, register, JWT, manajemen pengguna. Database db_auth.
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
const publik = (u) => ({ id: u.id, nama: u.nama, username: u.username, role: u.role, created_at: u.created_at });

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
  ["Administrator", "admin", "admin123", "admin"],
  ["Pak Darto", "darto", "petani123", "penjual"],
  ["Bu Siti", "siti", "petani123", "penjual"],
  ["Pak Ujang", "ujang", "petani123", "penjual"],
  ["Rina Pembeli", "rina", "pembeli123", "pembeli"],
];
async function seed() {
  for (let i = 0; i < 30; i++) {
    try {
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM users");
      if (n === 0) {
        for (const [nama, username, pw, role] of SEED)
          await pool.query("INSERT INTO users (nama, username, password_hash, role) VALUES (?,?,?,?)",
            [nama, username, bcrypt.hashSync(pw, 10), role]);
        console.log("akun awal dibuat");
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
  const { nama, username, password, role = "pembeli" } = req.body || {};
  if (!nama || !username || !password) return err(res, "nama, username, dan password wajib diisi", 400);
  if (!["penjual", "pembeli"].includes(role)) return err(res, "peran hanya boleh penjual atau pembeli", 400);
  if (String(password).length < 6) return err(res, "password minimal 6 karakter", 400);
  try {
    const [r] = await pool.query("INSERT INTO users (nama, username, password_hash, role) VALUES (?,?,?,?)",
      [nama, username, bcrypt.hashSync(password, 10), role]);
    const [[u]] = await pool.query("SELECT * FROM users WHERE id=?", [r.insertId]);
    ok(res, publik(u), 201, "akun berhasil dibuat, silakan login");
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return err(res, "username sudah dipakai", 409);
    throw e;
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  const [[u]] = await pool.query("SELECT * FROM users WHERE username=?", [username || ""]);
  if (!u || !bcrypt.compareSync(password || "", u.password_hash)) return err(res, "username atau password salah", 401);
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
  try {
    const [r] = await pool.query("INSERT INTO users (nama, username, password_hash, role) VALUES (?,?,?,?)",
      [nama, username, bcrypt.hashSync(password, 10), role]);
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
  for (const f of ["nama", "username", "role"]) if (b[f]) { sets.push(`${f}=?`); args.push(b[f]); }
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

app.use((e, req, res, next) => err(res, e.message, 500));

seed().then(() => app.listen(3000, "0.0.0.0", () => console.log("layanan-auth berjalan di port 3000")));
