"""TaniMart - Layanan Info (Flask): harga pangan + produksi per provinsi, database db_info.

Bagian publik (tanpa login) hanya bisa MEMBACA:
  GET /api/info/publik/harga            daftar harga (filter: komoditas, wilayah, tingkat)
  GET /api/info/publik/harga/terbaru    harga periode terakhir per komoditas/varian
  GET /api/info/publik/produksi         produksi per provinsi (filter: komoditas, tahun)
CRUD harga pangan untuk admin (lewat gateway + auth_request):
  GET/POST /api/info/harga, GET/PUT/DELETE /api/info/harga/<id>
"""
import os
import re
import time
from decimal import Decimal
from urllib.parse import unquote

import pymysql
from flask import Flask, jsonify, request

import rute

app = Flask(__name__)
SVC = "layanan-info"
DB = dict(
    host=os.getenv("DB_HOST", "db"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    database=os.getenv("DB_NAME", "db_info"),
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=True,
)
FIELDS = ["komoditas", "varian", "tingkat", "wilayah", "periode", "harga", "satuan", "sumber"]
REQUIRED = ["komoditas", "periode", "harga"]
TINGKAT = ("Petani", "Produsen", "Grosir", "Konsumen")
SATUAN = ("kg", "liter", "butir", "ikat", "ekor")


def conn():
    for _ in range(10):
        try:
            return pymysql.connect(**DB)
        except pymysql.err.OperationalError:
            time.sleep(2)
    return pymysql.connect(**DB)


def pengguna():
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
    return jsonify({"status": "success", "service": SVC, "message": message, "data": data}), code


def err(message, code):
    return jsonify({"status": "error", "service": SVC, "message": message}), code


def wajib_admin():
    u = pengguna()
    if not u or u[1] != "admin":
        return err("hanya admin yang boleh mengubah data harga pangan", 403)
    return None


def validasi(d, parsial=False):
    """Kembalikan (data_bersih, pesan_error)."""
    if not parsial:
        kosong = [f for f in REQUIRED if str(d.get(f, "")).strip() == ""]
        if kosong:
            return None, "field wajib kosong: " + ", ".join(kosong)
    out = {}
    for f in FIELDS:
        if f not in d:
            continue
        v = d[f]
        if isinstance(v, str):
            v = v.strip()
        if f == "periode" and not re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])", str(v)):
            return None, "periode harus berformat YYYY-MM, contoh 2026-06"
        if f == "harga":
            try:
                v = float(v)
            except (TypeError, ValueError):
                return None, "harga harus angka"
            if v <= 0:
                return None, "harga harus lebih dari 0"
        if f == "tingkat" and v not in TINGKAT:
            return None, "tingkat harus Petani, Produsen, Grosir, atau Konsumen"
        if f == "satuan" and v not in SATUAN:
            return None, "satuan harus salah satu dari: " + ", ".join(SATUAN)
        if f in ("komoditas", "varian", "wilayah", "sumber") and len(str(v)) > 200:
            return None, f"{f} terlalu panjang"
        out[f] = v if v != "" else None
    for f, bawaan in (("varian", "-"), ("wilayah", "Nasional"), ("sumber", "-")):
        if f in out and out[f] is None:
            out[f] = bawaan
    return out, None


def daftar_harga():
    sql, arg = "SELECT * FROM harga_pangan WHERE 1=1", []
    for f in ("komoditas", "wilayah", "tingkat"):
        if request.args.get(f):
            sql += f" AND {f}=%s"
            arg.append(request.args[f])
    sql += " ORDER BY komoditas, varian, periode DESC"
    with conn() as c, c.cursor() as cur:
        cur.execute(sql, arg)
        return [clean(r) for r in cur.fetchall()]


@app.get("/api/info/health")
@app.get("/api/info/publik/health")
def health():
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute("SELECT 1")
        return ok({"database": "terhubung"}, message="layanan-info sehat")
    except Exception as e:  # noqa: BLE001
        return err(f"database tidak terhubung: {e}", 503)


# ---------------------------------------------------------------- Publik (baca saja)
@app.get("/api/info/publik/harga")
def publik_harga():
    return ok(daftar_harga())


@app.get("/api/info/publik/harga/terbaru")
def publik_terbaru():
    """Satu baris per komoditas+varian+tingkat+wilayah: periode terakhir, plus harga periode sebelumnya."""
    with conn() as c, c.cursor() as cur:
        cur.execute("""
          SELECT h.*, (SELECT p.harga FROM harga_pangan p
                       WHERE p.komoditas=h.komoditas AND p.varian=h.varian AND p.tingkat=h.tingkat
                         AND p.wilayah=h.wilayah AND p.periode<h.periode
                       ORDER BY p.periode DESC LIMIT 1) AS harga_sebelumnya
          FROM harga_pangan h
          WHERE h.periode = (SELECT MAX(x.periode) FROM harga_pangan x
                             WHERE x.komoditas=h.komoditas AND x.varian=h.varian
                               AND x.tingkat=h.tingkat AND x.wilayah=h.wilayah)
          ORDER BY h.komoditas, h.varian""")
        return ok([clean(r) for r in cur.fetchall()])


@app.get("/api/info/publik/produksi")
def publik_produksi():
    sql, arg = "SELECT provinsi, komoditas, tahun, produksi_ton, luas_panen_ha, sumber FROM produksi_provinsi WHERE 1=1", []
    for f in ("komoditas", "tahun"):
        if request.args.get(f):
            sql += f" AND {f}=%s"
            arg.append(request.args[f])
    with conn() as c, c.cursor() as cur:
        cur.execute(sql + " ORDER BY produksi_ton DESC", arg)
        rows = [clean(r) for r in cur.fetchall()]
        cur.execute("SELECT DISTINCT komoditas FROM produksi_provinsi ORDER BY komoditas='Padi' DESC, komoditas")
        kom = [r["komoditas"] for r in cur.fetchall()]
    return ok({"komoditas": kom, "data": rows})


@app.get("/api/info/publik/estimasi")
def publik_estimasi():
    """Estimasi rute, biaya, dan waktu kirim antarprovinsi. Contoh: ?asal=JAWA TENGAH&tujuan=KALIMANTAN TIMUR&ton=2"""
    asal = (request.args.get("asal") or "").upper().strip()
    tujuan = (request.args.get("tujuan") or "").upper().strip()
    if asal not in rute.PULAU_DARI or tujuan not in rute.PULAU_DARI:
        return err("provinsi asal/tujuan tidak dikenal. Pilih salah satu dari daftar 38 provinsi.", 400)
    try:
        ton = float(request.args.get("ton", "1").replace(",", "."))
    except ValueError:
        return err("jumlah ton harus angka", 400)
    if not 0.000001 <= ton <= 10000:
        return err("jumlah harus antara 1 gram dan 10.000 ton", 400)
    ka, kt = request.args.get("kota_asal", type=int), request.args.get("kota_tujuan", type=int)
    return ok(rute.estimasi(asal, tujuan, ton, ka, kt))


@app.get("/api/info/publik/provinsi")
def publik_provinsi():
    return ok([{"nama": p, "pulau": rute.PULAU_DARI[p], "pelabuhan": rute.PELABUHAN[p][0]} for p in rute.PROVINSI])


@app.get("/api/info/publik/kota")
def publik_kota():
    """514 kab/kota dengan koordinat & posisi di peta. Filter opsional ?provinsi=JAWA TENGAH"""
    p = (request.args.get("provinsi") or "").upper()
    return ok([k for k in rute.KOTA.values() if not p or k["provinsi"] == p])


# ---------------------------------------------------------------- CRUD admin
@app.get("/api/info/harga")
def list_harga():
    return ok(daftar_harga())


@app.get("/api/info/harga/<int:hid>")
def get_harga(hid):
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM harga_pangan WHERE id=%s", (hid,))
        row = cur.fetchone()
    return ok(clean(row)) if row else err(f"harga id {hid} tidak ditemukan", 404)


@app.post("/api/info/harga")
def create_harga():
    tolak = wajib_admin()
    if tolak:
        return tolak
    d, e = validasi(request.get_json(silent=True) or {})
    if e:
        return err(e, 400)
    d.setdefault("tingkat", "Konsumen")
    d.setdefault("satuan", "kg")
    d["diperbarui_oleh"] = pengguna()[2]
    kolom = list(d)
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute(f"INSERT INTO harga_pangan ({','.join(kolom)}) VALUES ({','.join(['%s'] * len(kolom))})",
                        [d[k] for k in kolom])
            cur.execute("SELECT * FROM harga_pangan WHERE id=%s", (cur.lastrowid,))
            row = cur.fetchone()
    except pymysql.err.IntegrityError:
        return err("harga untuk komoditas, varian, tingkat, wilayah, dan periode itu sudah ada. Ubah data yang lama saja.", 409)
    return ok(clean(row), 201, "harga pangan berhasil ditambahkan")


@app.put("/api/info/harga/<int:hid>")
def update_harga(hid):
    tolak = wajib_admin()
    if tolak:
        return tolak
    d, e = validasi(request.get_json(silent=True) or {}, parsial=True)
    if e:
        return err(e, 400)
    if not d:
        return err("tidak ada data yang diubah", 400)
    d["diperbarui_oleh"] = pengguna()[2]
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute("SELECT id FROM harga_pangan WHERE id=%s", (hid,))
            if not cur.fetchone():
                return err(f"harga id {hid} tidak ditemukan", 404)
            cur.execute(f"UPDATE harga_pangan SET {', '.join(k + '=%s' for k in d)} WHERE id=%s", [*d.values(), hid])
            cur.execute("SELECT * FROM harga_pangan WHERE id=%s", (hid,))
            row = cur.fetchone()
    except pymysql.err.IntegrityError:
        return err("sudah ada harga lain dengan komoditas, varian, tingkat, wilayah, dan periode yang sama", 409)
    return ok(clean(row), message="harga pangan berhasil diperbarui")


@app.delete("/api/info/harga/<int:hid>")
def delete_harga(hid):
    tolak = wajib_admin()
    if tolak:
        return tolak
    with conn() as c, c.cursor() as cur:
        cur.execute("DELETE FROM harga_pangan WHERE id=%s", (hid,))
        if not cur.rowcount:
            return err(f"harga id {hid} tidak ditemukan", 404)
    return ok({"id": hid}, message="harga pangan berhasil dihapus")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
