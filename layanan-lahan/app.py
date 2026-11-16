"""RantaiTani - Layanan Lahan (Flask): CRUD data lahan pertanian, database db_lahan.

Identitas pengguna dikirim oleh gateway (Nginx auth_request) lewat header
X-User-Id / X-User-Role / X-User-Name. Request tanpa header = panggilan internal
antar-service di dalam Docker network (tidak bisa diakses dari luar).
"""
import os
import time
from decimal import Decimal
from urllib.parse import unquote

import pymysql
from flask import Flask, jsonify, request

app = Flask(__name__)

DB = dict(
    host=os.getenv("DB_HOST", "db"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    database=os.getenv("DB_NAME", "db_lahan"),
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=True,
)
FIELDS = ["nama_lahan", "pemilik", "lokasi", "luas_ha", "jenis_tanah", "komoditas", "status"]
REQUIRED = ["nama_lahan", "lokasi", "luas_ha", "komoditas"]


def conn():
    for _ in range(10):
        try:
            return pymysql.connect(**DB)
        except pymysql.err.OperationalError:
            time.sleep(2)
    return pymysql.connect(**DB)


def pengguna():
    """(id, role, nama) dari gateway, atau None untuk panggilan internal."""
    role = request.headers.get("X-User-Role")
    if not role:
        return None
    return int(request.headers.get("X-User-Id", 0)), role, unquote(request.headers.get("X-User-Name", ""))


def clean(row):
    if not row:
        return row
    out = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            v = float(v)
        elif hasattr(v, "isoformat"):
            v = v.isoformat(sep=" ") if hasattr(v, "hour") else v.isoformat()
        out[k] = v
    return out


def ok(data, code=200, message="success"):
    return jsonify({"status": "success", "service": "layanan-lahan", "message": message, "data": data}), code


def err(message, code):
    return jsonify({"status": "error", "service": "layanan-lahan", "message": message}), code


def boleh_ubah(u, row):
    return u is None or u[1] == "admin" or (u[1] == "penjual" and row["pemilik_id"] == u[0])


@app.get("/api/lahan/health")
def health():
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute("SELECT 1")
        return ok({"database": "terhubung"}, message="layanan-lahan sehat")
    except Exception as e:  # noqa: BLE001
        return err(f"database tidak terhubung: {e}", 503)


@app.get("/api/lahan")
def list_lahan():
    u = pengguna()
    where, args = [], []
    if u and u[1] == "penjual":          # penjual hanya melihat lahannya sendiri
        where.append("pemilik_id=%s")
        args.append(u[0])
    q = request.args.get("q", "").strip()
    if q:
        where.append("(nama_lahan LIKE %s OR komoditas LIKE %s OR pemilik LIKE %s)")
        args += [f"%{q}%"] * 3
    sql = "SELECT * FROM lahan" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id"
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, args)
        rows = [clean(r) for r in cur.fetchall()]
    return ok(rows, message=f"{len(rows)} data lahan ditemukan")


@app.get("/api/lahan/<int:lid>")
def get_lahan(lid):
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM lahan WHERE id=%s", (lid,))
        row = cur.fetchone()
    return ok(clean(row)) if row else err(f"lahan id {lid} tidak ditemukan", 404)


@app.post("/api/lahan")
def create_lahan():
    u = pengguna()
    if u and u[1] == "pembeli":
        return err("pembeli tidak boleh menambah lahan", 403)
    body = request.get_json(silent=True) or {}
    if u and u[1] == "penjual":           # pemilik otomatis = penjual yang login
        body["pemilik_id"], body["pemilik"] = u[0], u[2]
    missing = [f for f in REQUIRED + ["pemilik_id", "pemilik"] if body.get(f) in (None, "")]
    if missing:
        return err(f"field wajib kosong: {', '.join(missing)}", 400)
    cols = [f for f in FIELDS + ["pemilik_id"] if f in body]
    with conn() as c, c.cursor() as cur:
        cur.execute(
            f"INSERT INTO lahan ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
            [body[f] for f in cols],
        )
        cur.execute("SELECT * FROM lahan WHERE id=%s", (cur.lastrowid,))
        row = cur.fetchone()
    return ok(clean(row), 201, "lahan berhasil ditambahkan")


@app.put("/api/lahan/<int:lid>")
def update_lahan(lid):
    u = pengguna()
    body = request.get_json(silent=True) or {}
    allowed = FIELDS + (["pemilik_id"] if not u or u[1] == "admin" else [])
    if u and u[1] == "penjual":
        body.pop("pemilik", None)
    cols = [f for f in allowed if f in body]
    if not cols:
        return err("tidak ada field yang diubah", 400)
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM lahan WHERE id=%s", (lid,))
        row = cur.fetchone()
        if not row:
            return err(f"lahan id {lid} tidak ditemukan", 404)
        if not boleh_ubah(u, row):
            return err("anda hanya boleh mengubah lahan milik sendiri", 403)
        cur.execute(f"UPDATE lahan SET {', '.join(f + '=%s' for f in cols)} WHERE id=%s",
                    [body[f] for f in cols] + [lid])
        cur.execute("SELECT * FROM lahan WHERE id=%s", (lid,))
        row = cur.fetchone()
    return ok(clean(row), message="lahan berhasil diperbarui")


@app.delete("/api/lahan/<int:lid>")
def delete_lahan(lid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM lahan WHERE id=%s", (lid,))
        row = cur.fetchone()
        if not row:
            return err(f"lahan id {lid} tidak ditemukan", 404)
        if not boleh_ubah(u, row):
            return err("anda hanya boleh menghapus lahan milik sendiri", 403)
        cur.execute("DELETE FROM lahan WHERE id=%s", (lid,))
    return ok({"id": lid}, message="lahan berhasil dihapus")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
