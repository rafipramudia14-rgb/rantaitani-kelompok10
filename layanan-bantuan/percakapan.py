"""TaniMart - Chat penjual-pembeli (bagian dari layanan-bantuan, database db_bantuan).

Endpoint (lewat gateway, wajib login):
  GET    /api/bantuan/percakapan               daftar percakapan milik pengguna (admin: semua, untuk moderasi)
  POST   /api/bantuan/percakapan               pembeli memulai chat ke penjual {penjual_id, panen_id?}
  DELETE /api/bantuan/percakapan/<id>          admin menghapus percakapan
  GET    /api/bantuan/percakapan/<id>/pesan    isi percakapan (pesan untuk pembaca ditandai dibaca)
  POST   /api/bantuan/percakapan/<id>/pesan    kirim pesan {isi}
  PUT    /api/bantuan/pesan/<id>               ubah pesan sendiri (maks. 15 menit)
  DELETE /api/bantuan/pesan/<id>               hapus pesan sendiri / admin
"""
import json
import os
import time
import urllib.request
from datetime import datetime, timedelta
from urllib.parse import unquote

import pymysql
from flask import Blueprint, jsonify, request

bp = Blueprint("percakapan", __name__)
SVC = "layanan-bantuan"
AUTH_URL = os.getenv("AUTH_SERVICE_URL", "http://layanan-auth:3000")
DB = dict(host=os.getenv("DB_HOST", "db"), user=os.getenv("DB_USER"), password=os.getenv("DB_PASSWORD"),
          database=os.getenv("DB_NAME", "db_bantuan"), cursorclass=pymysql.cursors.DictCursor, autocommit=True)


def conn():
    for _ in range(10):
        try:
            return pymysql.connect(**DB)
        except pymysql.err.OperationalError:
            time.sleep(2)
    return pymysql.connect(**DB)


def ok(data, code=200, message="success"):
    return jsonify({"status": "success", "service": SVC, "message": message, "data": data}), code


def err(message, code):
    return jsonify({"status": "error", "service": SVC, "message": message}), code


def saya():
    role = request.headers.get("X-User-Role")
    if not role:
        return None
    return int(request.headers.get("X-User-Id", 0)), role, unquote(request.headers.get("X-User-Name", ""))


def bersih(r):
    return {k: (v.isoformat(sep=" ") if hasattr(v, "isoformat") else v) for k, v in r.items()} if r else r


def auth_json(path, data=None):
    try:
        rq = urllib.request.Request(AUTH_URL + path, data=json.dumps(data).encode() if data is not None else None,
                                    headers={"Content-Type": "application/json"}, method="POST" if data is not None else "GET")
        with urllib.request.urlopen(rq, timeout=5) as r:
            return json.load(r)["data"]
    except Exception:  # noqa: BLE001
        return None


def anggota(cur, cid, u):
    cur.execute("SELECT * FROM percakapan WHERE id=%s", (cid,))
    p = cur.fetchone()
    if not p:
        return None, err(f"percakapan id {cid} tidak ditemukan", 404)
    if not (u[1] == "admin" or u[0] in (p["pembeli_id"], p["penjual_id"])):
        return None, err("anda bukan peserta percakapan ini", 403)
    return p, None


@bp.get("/api/bantuan/percakapan")
def daftar():
    u = saya()
    if not u:
        return err("silakan login", 401)
    with conn() as c, c.cursor() as cur:
        where = "" if u[1] == "admin" else "WHERE p.pembeli_id=%s OR p.penjual_id=%s"
        cur.execute(f"""SELECT p.*,
              (SELECT isi FROM pesan WHERE percakapan_id=p.id ORDER BY id DESC LIMIT 1) AS pesan_terakhir,
              (SELECT COUNT(*) FROM pesan WHERE percakapan_id=p.id AND dibaca=0 AND pengirim_id<>%s) AS belum_dibaca,
              (SELECT COUNT(*) FROM pesan WHERE percakapan_id=p.id) AS jumlah_pesan
            FROM percakapan p {where} ORDER BY p.terakhir_at DESC""", (u[0],) if u[1] == "admin" else (u[0], u[0], u[0]))
        rows = [bersih(r) for r in cur.fetchall()]
    return ok(rows, message=f"{len(rows)} percakapan")


@bp.post("/api/bantuan/percakapan")
def mulai():
    u = saya()
    if not u or u[1] != "pembeli":
        return err("chat dimulai oleh pembeli dari halaman produk atau toko", 403)
    b = request.get_json(silent=True) or {}
    try:
        pid = int(b.get("penjual_id"))
    except (TypeError, ValueError):
        return err("penjual_id wajib diisi", 400)
    toko = {t["user_id"]: t for t in (auth_json("/api/auth/toko/publik") or [])}.get(pid)
    if not toko:
        return err("toko penjual tidak ditemukan atau belum terverifikasi", 404)
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM percakapan WHERE pembeli_id=%s AND penjual_id=%s", (u[0], pid))
        p = cur.fetchone()
        if not p:
            cur.execute("INSERT INTO percakapan (pembeli_id, penjual_id, pembeli_nama, toko_nama, panen_id) VALUES (%s,%s,%s,%s,%s)",
                        (u[0], pid, u[2], toko["nama_toko"], b.get("panen_id")))
            cur.execute("SELECT * FROM percakapan WHERE id=%s", (cur.lastrowid,))
            p = cur.fetchone()
        elif b.get("panen_id"):
            cur.execute("UPDATE percakapan SET panen_id=%s WHERE id=%s", (b["panen_id"], p["id"]))
    return ok(bersih(p), 201, "percakapan siap")


@bp.delete("/api/bantuan/percakapan/<int:cid>")
def hapus_percakapan(cid):
    u = saya()
    if not u or u[1] != "admin":
        return err("hanya admin yang boleh menghapus percakapan", 403)
    with conn() as c, c.cursor() as cur:
        cur.execute("DELETE FROM pesan WHERE percakapan_id=%s", (cid,))
        cur.execute("DELETE FROM percakapan WHERE id=%s", (cid,))
        if not cur.rowcount:
            return err(f"percakapan id {cid} tidak ditemukan", 404)
    return ok({"id": cid}, message="percakapan dihapus")


@bp.get("/api/bantuan/percakapan/<int:cid>/pesan")
def isi(cid):
    u = saya()
    if not u:
        return err("silakan login", 401)
    with conn() as c, c.cursor() as cur:
        p, gagal = anggota(cur, cid, u)
        if gagal:
            return gagal
        if u[1] != "admin":
            cur.execute("UPDATE pesan SET dibaca=1 WHERE percakapan_id=%s AND pengirim_id<>%s AND dibaca=0", (cid, u[0]))
        cur.execute("SELECT * FROM pesan WHERE percakapan_id=%s ORDER BY id", (cid,))
        rows = [bersih(r) for r in cur.fetchall()]
    return ok({"percakapan": bersih(p), "pesan": rows})


@bp.post("/api/bantuan/percakapan/<int:cid>/pesan")
def kirim(cid):
    u = saya()
    if not u:
        return err("silakan login", 401)
    teks = ((request.get_json(silent=True) or {}).get("isi") or "").strip()
    if not teks:
        return err("pesan tidak boleh kosong", 400)
    if len(teks) > 1000:
        return err("pesan maksimal 1000 karakter", 400)
    with conn() as c, c.cursor() as cur:
        p, gagal = anggota(cur, cid, u)
        if gagal:
            return gagal
        if u[1] == "admin":
            return err("admin hanya memantau percakapan, tidak ikut mengirim pesan", 403)
        cur.execute("INSERT INTO pesan (percakapan_id, pengirim_id, pengirim_nama, isi) VALUES (%s,%s,%s,%s)", (cid, u[0], u[2], teks))
        mid = cur.lastrowid
        cur.execute("UPDATE percakapan SET terakhir_at=NOW() WHERE id=%s", (cid,))
        cur.execute("SELECT * FROM pesan WHERE id=%s", (mid,))
        m = cur.fetchone()
    lawan = p["penjual_id"] if u[0] == p["pembeli_id"] else p["pembeli_id"]
    auth_json("/api/auth/internal/notifikasi", {"user_id": lawan, "judul": f"Pesan baru dari {u[2]}", "isi": teks[:200], "tautan": "chat"})
    return ok(bersih(m), 201, "pesan terkirim")


def pesan_milik(cur, mid, u, untuk_hapus=False):
    cur.execute("SELECT * FROM pesan WHERE id=%s", (mid,))
    m = cur.fetchone()
    if not m:
        return None, err(f"pesan id {mid} tidak ditemukan", 404)
    if not (m["pengirim_id"] == u[0] or (untuk_hapus and u[1] == "admin")):
        return None, err("anda hanya boleh mengubah/menghapus pesan sendiri", 403)
    return m, None


@bp.put("/api/bantuan/pesan/<int:mid>")
def ubah(mid):
    u = saya()
    if not u:
        return err("silakan login", 401)
    teks = ((request.get_json(silent=True) or {}).get("isi") or "").strip()
    if not teks or len(teks) > 1000:
        return err("pesan 1-1000 karakter", 400)
    with conn() as c, c.cursor() as cur:
        m, gagal = pesan_milik(cur, mid, u)
        if gagal:
            return gagal
        if datetime.now() - m["created_at"] > timedelta(minutes=15):
            return err("pesan hanya bisa diubah dalam 15 menit setelah dikirim", 422)
        cur.execute("UPDATE pesan SET isi=%s, diubah=1 WHERE id=%s", (teks, mid))
        cur.execute("SELECT * FROM pesan WHERE id=%s", (mid,))
        m = cur.fetchone()
    return ok(bersih(m), message="pesan diubah")


@bp.delete("/api/bantuan/pesan/<int:mid>")
def hapus(mid):
    u = saya()
    if not u:
        return err("silakan login", 401)
    with conn() as c, c.cursor() as cur:
        m, gagal = pesan_milik(cur, mid, u, untuk_hapus=True)
        if gagal:
            return gagal
        cur.execute("DELETE FROM pesan WHERE id=%s", (mid,))
    return ok({"id": mid}, message="pesan dihapus")
