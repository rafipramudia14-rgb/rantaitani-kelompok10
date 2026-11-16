"""RantaiTani - Layanan Penjualan (Flask): CRUD transaksi penjualan hasil panen, database db_penjualan.

- Sebelum menyimpan, cek sisa stok panen dengan memanggil layanan-panen lewat Docker network.
- Identitas pengguna dari gateway (X-User-Id / X-User-Role / X-User-Name).
  admin: semua data | penjual: penjualan dari panen miliknya | pembeli: katalog + pembelian sendiri.
"""
import json
import os
import time
import urllib.error
import urllib.request
from datetime import date
from decimal import Decimal
from urllib.parse import unquote

import pymysql
import qrcode
import qrcode.image.svg
from flask import Flask, jsonify, request

app = Flask(__name__)

DB = dict(
    host=os.getenv("DB_HOST", "db"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    database=os.getenv("DB_NAME", "db_penjualan"),
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=True,
)
PANEN_URL = os.getenv("PANEN_SERVICE_URL", "http://layanan-panen:3000")
FIELDS = ["panen_id", "pembeli", "jenis_pembeli", "jumlah_kg", "harga_jual_per_kg", "tanggal_jual", "status_bayar"]
REQUIRED = ["panen_id", "pembeli", "jumlah_kg", "harga_jual_per_kg", "tanggal_jual"]
SVC = "layanan-penjualan"


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
    if "jumlah_kg" in out and "harga_jual_per_kg" in out:
        out["total_harga"] = round(out["jumlah_kg"] * out["harga_jual_per_kg"], 2)
    return out


def ok(data, code=200, message="success"):
    return jsonify({"status": "success", "service": SVC, "message": message, "data": data}), code


def err(message, code):
    return jsonify({"status": "error", "service": SVC, "message": message}), code


def panggil_panen(path):
    """Return (data | None, error_code | None)."""
    try:
        with urllib.request.urlopen(f"{PANEN_URL}{path}", timeout=5) as r:
            return json.load(r)["data"], None
    except urllib.error.HTTPError as e:
        return None, (404 if e.code == 404 else 503)
    except Exception:  # noqa: BLE001
        return None, 503


def terjual(cur, pid=None, kecuali_id=None):
    """Total kg terjual untuk satu panen, atau dict {panen_id: kg} jika pid None."""
    if pid is None:
        cur.execute("SELECT panen_id, SUM(jumlah_kg) AS t FROM penjualan GROUP BY panen_id")
        return {r["panen_id"]: float(r["t"]) for r in cur.fetchall()}
    sql, args = "SELECT COALESCE(SUM(jumlah_kg),0) AS t FROM penjualan WHERE panen_id=%s", [pid]
    if kecuali_id:
        sql += " AND id<>%s"
        args.append(kecuali_id)
    cur.execute(sql, args)
    return float(cur.fetchone()["t"])


def ambil_panen_cek_stok(cur, pid, jumlah, kecuali_id=None):
    """Return (panen, None) bila stok cukup, atau (None, response_error)."""
    panen, e = panggil_panen(f"/api/panen/{pid}")
    if e == 404:
        return None, err(f"panen id {pid} tidak terdaftar di layanan-panen", 422)
    if e:
        return None, err("layanan-panen tidak dapat dihubungi", 503)
    sisa = float(panen["jumlah_kg"]) - terjual(cur, pid, kecuali_id)
    if float(jumlah) <= 0:
        return None, err("jumlah harus lebih dari 0", 400)
    if float(jumlah) > sisa:
        return None, err(f"stok tidak cukup: sisa panen id {pid} hanya {sisa:g} kg", 422)
    return panen, None


def boleh_kelola(u, row):
    return u is None or u[1] == "admin" or (u[1] == "penjual" and row["penjual_id"] == u[0])


@app.get("/api/penjualan/health")
def health():
    try:
        with conn() as c, c.cursor() as cur:
            cur.execute("SELECT 1")
    except Exception as e:  # noqa: BLE001
        return err(f"database tidak terhubung: {e}", 503)
    _, e = panggil_panen("/api/panen/health")
    return ok({"database": "terhubung", "layanan_panen": "tidak terhubung" if e else "terhubung"},
              message="layanan-penjualan sehat")


@app.get("/api/penjualan/katalog")
def katalog():
    """Daftar hasil panen yang masih punya stok (untuk pembeli)."""
    panen, e = panggil_panen("/api/panen")
    if e:
        return err("layanan-panen tidak dapat dihubungi", 503)
    with conn() as c, c.cursor() as cur:
        t = terjual(cur)
    items = []
    for p in panen:
        sisa = float(p["jumlah_kg"]) - t.get(p["id"], 0.0)
        if sisa > 0:
            items.append({"panen_id": p["id"], "komoditas": p["komoditas"], "kualitas": p["kualitas"],
                          "tanggal_panen": p["tanggal_panen"], "lahan_id": p["lahan_id"],
                          "penjual_id": p["pemilik_id"], "harga_per_kg": p["harga_per_kg"], "sisa_kg": sisa})
    return ok(items, message=f"{len(items)} produk tersedia")


@app.get("/api/penjualan/stok/<int:pid>")
def stok(pid):
    panen, e = panggil_panen(f"/api/panen/{pid}")
    if e:
        return err(f"panen id {pid} tidak ditemukan" if e == 404 else "layanan-panen tidak dapat dihubungi", e)
    with conn() as c, c.cursor() as cur:
        t = terjual(cur, pid)
    return ok({"panen_id": pid, "komoditas": panen["komoditas"], "jumlah_panen_kg": float(panen["jumlah_kg"]),
               "terjual_kg": t, "sisa_kg": float(panen["jumlah_kg"]) - t})


@app.get("/api/penjualan")
def list_penjualan():
    u = pengguna()
    where, args = [], []
    if u and u[1] == "penjual":
        where.append("penjual_id=%s")
        args.append(u[0])
    elif u and u[1] == "pembeli":
        where.append("pembeli_id=%s")
        args.append(u[0])
    if request.args.get("panen_id"):
        where.append("panen_id=%s")
        args.append(request.args["panen_id"])
    sql = "SELECT * FROM penjualan" + (" WHERE " + " AND ".join(where) if where else "")
    with conn() as c, c.cursor() as cur:
        cur.execute(sql + " ORDER BY tanggal_jual DESC, id DESC", args)
        rows = [clean(r) for r in cur.fetchall()]
    return ok(rows, message=f"{len(rows)} data penjualan ditemukan")


@app.get("/api/penjualan/<int:sid>")
def get_penjualan(sid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
    if not row:
        return err(f"penjualan id {sid} tidak ditemukan", 404)
    if not (boleh_kelola(u, row) or (u[1] == "pembeli" and row["pembeli_id"] == u[0])):
        return err("anda tidak berhak melihat transaksi ini", 403)
    return ok(clean(row))


@app.post("/api/penjualan")
def create_penjualan():
    u = pengguna()
    b = request.get_json(silent=True) or {}
    if u and u[1] == "pembeli":
        # Pembeli membeli dari katalog: harga mengikuti harga panen, pembeli = dirinya sendiri
        if not b.get("panen_id") or not b.get("jumlah_kg"):
            return err("panen_id dan jumlah_kg wajib diisi", 400)
        with conn() as c, c.cursor() as cur:
            panen, gagal = ambil_panen_cek_stok(cur, b["panen_id"], b["jumlah_kg"])
            if gagal:
                return gagal
            cur.execute(
                "INSERT INTO penjualan (panen_id, penjual_id, pembeli_id, pembeli, jenis_pembeli, jumlah_kg, "
                "harga_jual_per_kg, tanggal_jual, status_bayar) VALUES (%s,%s,%s,%s,'Perorangan',%s,%s,%s,'Belum Lunas')",
                (b["panen_id"], panen["pemilik_id"], u[0], u[2], b["jumlah_kg"], panen["harga_per_kg"], date.today()),
            )
            cur.execute("SELECT * FROM penjualan WHERE id=%s", (cur.lastrowid,))
            row = cur.fetchone()
        return ok(clean(row), 201, "pembelian berhasil, menunggu pembayaran")

    missing = [f for f in REQUIRED if b.get(f) in (None, "")]
    if missing:
        return err(f"field wajib kosong: {', '.join(missing)}", 400)
    cols = [f for f in FIELDS if f in b]
    with conn() as c, c.cursor() as cur:
        panen, gagal = ambil_panen_cek_stok(cur, b["panen_id"], b["jumlah_kg"])
        if gagal:
            return gagal
        if u and u[1] == "penjual" and panen["pemilik_id"] != u[0]:
            return err("anda hanya boleh menjual hasil panen milik sendiri", 403)
        cur.execute(f"INSERT INTO penjualan ({', '.join(cols)}, penjual_id) VALUES ({', '.join(['%s'] * len(cols))}, %s)",
                    [b[f] for f in cols] + [panen["pemilik_id"]])
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (cur.lastrowid,))
        row = cur.fetchone()
    return ok(clean(row), 201, "penjualan berhasil dicatat")


@app.put("/api/penjualan/<int:sid>")
def update_penjualan(sid):
    u = pengguna()
    if u and u[1] == "pembeli":
        return err("pembeli tidak boleh mengubah transaksi; batalkan lalu beli ulang", 403)
    b = request.get_json(silent=True) or {}
    cols = [f for f in FIELDS if f in b]
    if not cols:
        return err("tidak ada field yang diubah", 400)
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        lama = cur.fetchone()
        if not lama:
            return err(f"penjualan id {sid} tidak ditemukan", 404)
        if not boleh_kelola(u, lama):
            return err("anda hanya boleh mengubah penjualan milik sendiri", 403)
        extra, extra_args = "", []
        if "panen_id" in b or "jumlah_kg" in b:
            panen, gagal = ambil_panen_cek_stok(cur, b.get("panen_id", lama["panen_id"]),
                                                b.get("jumlah_kg", lama["jumlah_kg"]), sid)
            if gagal:
                return gagal
            if u and u[1] == "penjual" and panen["pemilik_id"] != u[0]:
                return err("anda hanya boleh menjual hasil panen milik sendiri", 403)
            extra, extra_args = ", penjual_id=%s", [panen["pemilik_id"]]
        cur.execute(f"UPDATE penjualan SET {', '.join(f + '=%s' for f in cols)}{extra} WHERE id=%s",
                    [b[f] for f in cols] + extra_args + [sid])
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
    return ok(clean(row), message="penjualan berhasil diperbarui")


@app.delete("/api/penjualan/<int:sid>")
def delete_penjualan(sid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
        if not row:
            return err(f"penjualan id {sid} tidak ditemukan", 404)
        if u and u[1] == "pembeli":
            if row["pembeli_id"] != u[0]:
                return err("anda hanya boleh membatalkan pembelian sendiri", 403)
            if row["status_bayar"] != "Belum Lunas":
                return err("pembelian yang sudah dibayar tidak bisa dibatalkan", 422)
        elif not boleh_kelola(u, row):
            return err("anda hanya boleh menghapus penjualan milik sendiri", 403)
        cur.execute("DELETE FROM penjualan WHERE id=%s", (sid,))
    pesan = "pembelian berhasil dibatalkan" if u and u[1] == "pembeli" else "penjualan berhasil dihapus"
    return ok({"id": sid}, message=pesan)


# ---------------------------------------------------------------- Pembayaran QRIS (SIMULASI)
# Tidak terhubung ke bank / e-wallet mana pun. QR berisi kode pembayaran simulasi,
# status berubah: Belum Lunas -> Menunggu Konfirmasi (pembeli) -> Lunas (penjual).
MERCHANT = "RANTAITANI (SIMULASI)"
BERLAKU_MENIT = 15


def ambil_milik_pembeli(cur, sid, u):
    cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
    row = cur.fetchone()
    if not row:
        return None, err(f"penjualan id {sid} tidak ditemukan", 404)
    if u and u[1] == "pembeli" and row["pembeli_id"] != u[0]:
        return None, err("anda hanya boleh membayar pembelian sendiri", 403)
    if u and u[1] == "penjual":
        return None, err("pembayaran dilakukan oleh pembeli", 403)
    return row, None


@app.get("/api/penjualan/<int:sid>/qris")
def qris(sid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        row, gagal = ambil_milik_pembeli(cur, sid, u)
        if gagal:
            return gagal
    if row["status_bayar"] == "Lunas":
        return err("transaksi ini sudah lunas", 422)
    total = round(float(row["jumlah_kg"]) * float(row["harga_jual_per_kg"]))
    kode = f"RT-{sid:06d}"
    payload = f"SIMULASI-QRIS|{MERCHANT}|{kode}|IDR{total}"
    img = qrcode.make(payload, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    svg = img.to_string(encoding="unicode")
    return ok({"kode_bayar": kode, "merchant": MERCHANT, "total": total, "berlaku_menit": BERLAKU_MENIT,
               "status_bayar": row["status_bayar"], "payload": payload, "qr_svg": svg, "simulasi": True},
              message="kode QRIS simulasi dibuat")


@app.post("/api/penjualan/<int:sid>/sudah-bayar")
def sudah_bayar(sid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        row, gagal = ambil_milik_pembeli(cur, sid, u)
        if gagal:
            return gagal
        if row["status_bayar"] != "Belum Lunas":
            return err(f"status transaksi sudah '{row['status_bayar']}'", 422)
        cur.execute("UPDATE penjualan SET status_bayar='Menunggu Konfirmasi' WHERE id=%s", (sid,))
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
    return ok(clean(row), message="pembayaran dikirim, menunggu konfirmasi penjual")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
