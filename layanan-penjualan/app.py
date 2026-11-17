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
AUTH_URL = os.getenv("AUTH_SERVICE_URL", "http://layanan-auth:3000")
INFO_URL = os.getenv("INFO_SERVICE_URL", "http://layanan-info:5000")
METODE = ("QRIS", "GoPay", "DANA", "Transfer Bank")
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
        out["total_bayar"] = round(out["total_harga"] + float(out.get("ongkir") or 0), 2)
    if out.get("jalur"):
        try:
            out["jalur"] = json.loads(out["jalur"])
        except ValueError:
            out["jalur"] = None
    return out


def ambil_json(url, data=None):
    """GET/POST JSON ke layanan lain di jaringan Docker. Return data atau None."""
    try:
        req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                     headers={"Content-Type": "application/json"}, method="POST" if data is not None else "GET")
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)["data"]
    except Exception:  # noqa: BLE001
        return None


def kabari(user_id, judul, isi, tautan="pesanan"):
    """Notifikasi ke layanan-auth (endpoint internal, diblokir dari luar oleh gateway)."""
    if user_id:
        ambil_json(f"{AUTH_URL}/api/auth/internal/notifikasi", {"user_id": user_id, "judul": judul, "isi": isi, "tautan": tautan})


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


def toko_terverifikasi():
    """{penjual_id: toko} dari layanan-auth; None jika layanan-auth tidak bisa dihubungi."""
    try:
        with urllib.request.urlopen(f"{AUTH_URL}/api/auth/toko/publik", timeout=5) as r:
            return {t["user_id"]: t for t in json.load(r)["data"]}
    except Exception:  # noqa: BLE001
        return None


def terjual(cur, pid=None, kecuali_id=None):
    """Total kg terjual untuk satu panen, atau dict {panen_id: kg} jika pid None."""
    if pid is None:
        cur.execute("SELECT panen_id, SUM(jumlah_kg) AS t FROM penjualan WHERE status_pesanan<>'Dibatalkan' GROUP BY panen_id")
        return {r["panen_id"]: float(r["t"]) for r in cur.fetchall()}
    sql, args = "SELECT COALESCE(SUM(jumlah_kg),0) AS t FROM penjualan WHERE panen_id=%s AND status_pesanan<>'Dibatalkan'", [pid]
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
    """Daftar hasil panen yang masih punya stok, hanya dari toko yang sudah diverifikasi admin."""
    panen, e = panggil_panen("/api/panen")
    if e:
        return err("layanan-panen tidak dapat dihubungi", 503)
    toko = toko_terverifikasi()
    if toko is None:
        return err("layanan-auth tidak dapat dihubungi (data toko)", 503)
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT panen_id, AVG(rating) r, COUNT(*) n FROM ulasan GROUP BY panen_id")
        rating = {x["panen_id"]: (round(float(x["r"]), 1), x["n"]) for x in cur.fetchall()}
        cur.execute("SELECT penjual_id, AVG(rating) r, COUNT(*) n FROM ulasan GROUP BY penjual_id")
        rating_toko = {x["penjual_id"]: (round(float(x["r"]), 1), x["n"]) for x in cur.fetchall()}
    with conn() as c, c.cursor() as cur:
        t = terjual(cur)
    items = []
    for p in panen:
        sisa = float(p["jumlah_kg"]) - t.get(p["id"], 0.0)
        tk = toko.get(p["pemilik_id"])
        if sisa > 0 and tk:
            items.append({"toko": tk["nama_toko"], "toko_id": tk["id"], "provinsi": tk["provinsi"], "kota": tk["kota"], "kota_id": tk.get("kota_id"),
                          "nama_produk": p.get("nama_produk") or p["komoditas"], "deskripsi": p.get("deskripsi"), "foto": p.get("foto"),
                          "harga_normal": p["harga_per_kg"], "promo_aktif": p.get("promo_aktif", False), "diskon_persen": p.get("diskon_persen", 0),
                          "promo_sampai": p.get("promo_sampai"), "unggulan": p.get("unggulan", False), "terjual_kg": t.get(p["id"], 0.0),
                          "rating": rating.get(p["id"], (None, 0))[0], "jumlah_ulasan": rating.get(p["id"], (None, 0))[1],
                          "rating_toko": rating_toko.get(p["pemilik_id"], (None, 0))[0], "ulasan_toko": rating_toko.get(p["pemilik_id"], (None, 0))[1], "panen_id": p["id"], "komoditas": p["komoditas"], "kualitas": p["kualitas"],
                          "tanggal_panen": p["tanggal_panen"], "lahan_id": p["lahan_id"],
                          "penjual_id": p["pemilik_id"], "harga_per_kg": p.get("harga_aktif", p["harga_per_kg"]), "sisa_kg": sisa})
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
        metode = b.get("metode_bayar") or "QRIS"
        if metode not in METODE:
            return err("metode bayar harus QRIS, GoPay, DANA, atau Transfer Bank", 400)
        # alamat kirim: dari body, kalau kosong pakai alamat di profil pembeli
        akun = ambil_json(f"{AUTH_URL}/api/auth/internal/kontak/{u[0]}") or {}
        prov_t = (b.get("provinsi_tujuan") or akun.get("provinsi") or "").upper()
        kota_t = b.get("kota_tujuan_id") or akun.get("kota_id")
        alamat = (b.get("alamat_kirim") or akun.get("alamat") or "").strip()
        if not prov_t or not alamat:
            return err("lengkapi alamat kirim (provinsi, kota, alamat) di Akun Saya atau di form checkout", 422)
        toko = (toko_terverifikasi() or {})
        with conn() as c, c.cursor() as cur:
            panen, gagal = ambil_panen_cek_stok(cur, b["panen_id"], b["jumlah_kg"])
            if gagal:
                return gagal
            tk = toko.get(panen["pemilik_id"])
            if not tk:
                return err("toko penjual belum terverifikasi, produk tidak bisa dibeli", 422)
            q = urllib.parse.urlencode({k: v for k, v in {"asal": tk["provinsi"], "tujuan": prov_t, "ton": float(b["jumlah_kg"]) / 1000,
                                                         "kota_asal": tk.get("kota_id"), "kota_tujuan": kota_t}.items() if v})
            est = ambil_json(f"{INFO_URL}/api/info/publik/estimasi?{q}")
            if not est:
                return err("ongkir belum bisa dihitung (layanan-info tidak merespons atau alamat tidak valid)", 503)
            cur.execute(
                "INSERT INTO penjualan (panen_id, penjual_id, pembeli_id, pembeli, jenis_pembeli, jumlah_kg, harga_jual_per_kg, tanggal_jual, "
                "status_bayar, status_pesanan, metode_bayar, ongkir, moda_kirim, estimasi_hari, kota_asal, kota_tujuan, provinsi_tujuan, "
                "alamat_kirim, no_hp_penerima, jalur) VALUES (%s,%s,%s,%s,'Perorangan',%s,%s,%s,'Belum Lunas','Menunggu Bayar',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (b["panen_id"], panen["pemilik_id"], u[0], u[2], b["jumlah_kg"], panen.get("harga_aktif", panen["harga_per_kg"]), date.today(),
                 metode, est["total_biaya"], est["moda"], est["estimasi_hari"], est["kota_asal"], est["kota_tujuan"], prov_t,
                 alamat[:200], (b.get("no_hp_penerima") or akun.get("no_hp") or "")[:20], json.dumps(est["jalur"])),
            )
            cur.execute("SELECT * FROM penjualan WHERE id=%s", (cur.lastrowid,))
            row = cur.fetchone()
        kabari(panen["pemilik_id"], "Pesanan baru", f"{u[2]} memesan {panen['komoditas']} {float(b['jumlah_kg']):g} kg, dikirim ke {est['kota_tujuan']}. Menunggu pembayaran.")
        return ok(clean(row), 201, "pesanan dibuat, silakan bayar")

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
        if b.get("status_bayar") == "Lunas":   # pembayaran dikonfirmasi -> pesanan Dibayar
            cur.execute("UPDATE penjualan SET status_pesanan='Dibayar' WHERE id=%s AND status_pesanan='Menunggu Bayar'", (sid,))
            if lama["status_bayar"] != "Lunas":
                kabari(lama["pembeli_id"], "Pembayaran dikonfirmasi", f"Pembayaran pesanan #{sid} sudah diterima penjual. Pesanan segera diproses.")
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
            return err("pembeli tidak menghapus transaksi; gunakan Batalkan (POST /api/penjualan/{id}/batal)", 403)
        if not boleh_kelola(u, row):
            return err("anda hanya boleh menghapus penjualan milik sendiri", 403)
        cur.execute("DELETE FROM penjualan WHERE id=%s", (sid,))
    return ok({"id": sid}, message="penjualan berhasil dihapus")


# ---------------------------------------------------------------- Status pesanan
# Menunggu Bayar -> Dibayar -> Diproses -> Dikirim -> Selesai. Dibatalkan hanya sebelum Diproses.
BOLEH_BATAL = ("Menunggu Bayar", "Dibayar")
LANJUT = {"Dibayar": "Diproses", "Diproses": "Dikirim", "Dikirim": "Selesai"}


@app.post("/api/penjualan/<int:sid>/status")
def ubah_status(sid):
    u = pengguna()
    baru = (request.get_json(silent=True) or {}).get("status")
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
        if not row:
            return err(f"penjualan id {sid} tidak ditemukan", 404)
        lama = row["status_pesanan"]
        pembeli_pemilik = u and u[1] == "pembeli" and row["pembeli_id"] == u[0]
        if not (boleh_kelola(u, row) or pembeli_pemilik):
            return err("anda tidak berhak mengubah pesanan ini", 403)
        if LANJUT.get(lama) != baru:
            return err(f"status '{lama}' tidak bisa diubah menjadi '{baru}'. Urutannya: Dibayar → Diproses → Dikirim → Selesai", 422)
        if pembeli_pemilik and baru != "Selesai":
            return err("pembeli hanya bisa menandai pesanan diterima (Selesai)", 403)
        if baru == "Diproses" and row["status_bayar"] != "Lunas":
            return err("pesanan baru bisa diproses setelah pembayaran lunas", 422)
        if baru == "Dikirim" and row["pembeli_id"]:
            return err("pakai Atur Pengiriman (POST /api/penjualan/{id}/kirim) supaya jasa kirim & nomor resi tercatat", 422)
        cur.execute("UPDATE penjualan SET status_pesanan=%s WHERE id=%s", (baru, sid))
        if baru == "Selesai" and row.get("no_resi"):
            cur.execute("INSERT INTO riwayat_kirim (penjualan_id, lokasi, keterangan, oleh) VALUES (%s,%s,%s,%s)",
                        (sid, row.get("kota_tujuan") or "-", "Paket diterima pembeli", u[2] if u else "sistem"))
        teks = {"Diproses": "sedang dikemas penjual", "Dikirim": f"sedang dikirim ({row.get('moda_kirim') or 'kurir'}), lacak di Pesanan Saya",
                "Selesai": "sudah diterima. Terima kasih!"}[baru]
        kabari(row["pembeli_id"] if not pembeli_pemilik else row["penjual_id"], f"Pesanan #{sid} {baru.lower()}",
               f"Pesanan #{sid} {teks}" if not pembeli_pemilik else f"Pembeli sudah menerima pesanan #{sid}.")
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
    return ok(clean(row), message=f"pesanan {sid} sekarang {baru}")


@app.post("/api/penjualan/<int:sid>/batal")
def batal(sid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
        if not row:
            return err(f"penjualan id {sid} tidak ditemukan", 404)
        if not (boleh_kelola(u, row) or (u and u[1] == "pembeli" and row["pembeli_id"] == u[0])):
            return err("anda hanya boleh membatalkan pesanan sendiri", 403)
        if row["status_pesanan"] not in BOLEH_BATAL:
            return err(f"pesanan sudah {row['status_pesanan']}, tidak bisa dibatalkan lagi", 422)
        cur.execute("UPDATE penjualan SET status_pesanan='Dibatalkan' WHERE id=%s", (sid,))
        oleh_pembeli = u and u[1] == "pembeli"
        kabari(row["penjual_id"] if oleh_pembeli else row["pembeli_id"], f"Pesanan #{sid} dibatalkan",
               f"Pesanan #{sid} dibatalkan oleh {'pembeli' if oleh_pembeli else 'penjual'}.")
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
    pesan = "pesanan dibatalkan, stok dikembalikan"
    if row["status_bayar"] == "Lunas":
        pesan += ". Uang dikembalikan penjual ke pembeli (simulasi)"
    return ok(clean(row), message=pesan)


# ---------------------------------------------------------------- Pembayaran QRIS (SIMULASI)
# Tidak terhubung ke bank / e-wallet mana pun. QR berisi kode pembayaran simulasi,
# status berubah: Belum Lunas -> Menunggu Konfirmasi (pembeli) -> Lunas (penjual).
MERCHANT = "TANIMART (SIMULASI)"
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
    if row["status_pesanan"] == "Dibatalkan":
        return err("pesanan ini sudah dibatalkan", 422)
    total = round(clean(row)["total_bayar"])
    kode = f"TM-{sid:06d}"
    payload = f"SIMULASI-QRIS|{MERCHANT}|{kode}|IDR{total}"
    img = qrcode.make(payload, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    svg = img.to_string(encoding="unicode")
    return ok({"kode_bayar": kode, "merchant": MERCHANT, "total": total, "berlaku_menit": BERLAKU_MENIT,
               "status_bayar": row["status_bayar"], "payload": payload, "qr_svg": svg, "simulasi": True},
              message="kode QRIS simulasi dibuat")


# ---------------------------------------------------------------- Ulasan & rating
def cek_ulasan(b):
    try:
        rating = int(b.get("rating", 0))
    except (TypeError, ValueError):
        rating = 0
    if not 1 <= rating <= 5:
        return None, err("rating harus 1 sampai 5 bintang", 400)
    komentar = (b.get("komentar") or "").strip()
    if len(komentar) > 500:
        return None, err("komentar maksimal 500 karakter", 400)
    return (rating, komentar or None), None


@app.get("/api/penjualan/ulasan")
def daftar_ulasan():
    """Filter: ?panen_id= atau ?penjual_id=. Pembeli/penjual/admin yang login boleh membaca."""
    sql, args = "SELECT * FROM ulasan WHERE 1=1", []
    for f in ("panen_id", "penjual_id", "pembeli_id"):
        if request.args.get(f):
            sql += f" AND {f}=%s"
            args.append(request.args[f])
    with conn() as c, c.cursor() as cur:
        cur.execute(sql + " ORDER BY id DESC LIMIT 100", args)
        rows = [clean(x) for x in cur.fetchall()]
    return ok(rows, message=f"{len(rows)} ulasan")


@app.post("/api/penjualan/<int:sid>/ulasan")
def beri_ulasan(sid):
    u = pengguna()
    if not u or u[1] != "pembeli":
        return err("hanya pembeli yang bisa memberi ulasan", 403)
    nilai, gagal = cek_ulasan(request.get_json(silent=True) or {})
    if gagal:
        return gagal
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
        if not row or row["pembeli_id"] != u[0]:
            return err("pesanan tidak ditemukan", 404)
        if row["status_pesanan"] != "Selesai":
            return err("ulasan bisa diberikan setelah pesanan selesai (diterima)", 422)
        try:
            cur.execute("INSERT INTO ulasan (penjualan_id, panen_id, penjual_id, pembeli_id, nama_pembeli, rating, komentar) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s)", (sid, row["panen_id"], row["penjual_id"], u[0], u[2], *nilai))
        except pymysql.err.IntegrityError:
            return err("pesanan ini sudah diulas; ubah ulasan yang ada", 409)
        cur.execute("SELECT * FROM ulasan WHERE id=%s", (cur.lastrowid,))
        ul = cur.fetchone()
    kabari(row["penjual_id"], f"Ulasan baru {'★' * nilai[0]}", f"{u[2]}: {nilai[1] or '(tanpa komentar)'}", "penjualan")
    return ok(clean(ul), 201, "terima kasih, ulasan tersimpan")


@app.put("/api/penjualan/ulasan/<int:uid>")
def ubah_ulasan(uid):
    u = pengguna()
    nilai, gagal = cek_ulasan(request.get_json(silent=True) or {})
    if gagal:
        return gagal
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM ulasan WHERE id=%s", (uid,))
        ul = cur.fetchone()
        if not ul:
            return err(f"ulasan id {uid} tidak ditemukan", 404)
        if not u or ul["pembeli_id"] != u[0]:
            return err("anda hanya boleh mengubah ulasan sendiri", 403)
        cur.execute("UPDATE ulasan SET rating=%s, komentar=%s WHERE id=%s", (*nilai, uid))
        cur.execute("SELECT * FROM ulasan WHERE id=%s", (uid,))
        ul = cur.fetchone()
    return ok(clean(ul), message="ulasan diperbarui")


@app.delete("/api/penjualan/ulasan/<int:uid>")
def hapus_ulasan(uid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM ulasan WHERE id=%s", (uid,))
        ul = cur.fetchone()
        if not ul:
            return err(f"ulasan id {uid} tidak ditemukan", 404)
        if not u or not (u[1] == "admin" or ul["pembeli_id"] == u[0]):
            return err("hanya penulis ulasan atau admin yang boleh menghapus", 403)
        cur.execute("DELETE FROM ulasan WHERE id=%s", (uid,))
    return ok({"id": uid}, message="ulasan dihapus")


# ---------------------------------------------------------------- Pengiriman: atur kirim, resi, riwayat perjalanan
JASA = {"paket": ["TaniKirim Reguler", "TaniKirim Kilat"], "truk": ["Truk Engkel TaniMart", "Truk Fuso TaniMart"],
        "laut": ["Kargo Laut TaniMart (kontainer)"]}


def jasa_untuk(row):
    moda = (row.get("moda_kirim") or "").lower()
    if moda.startswith("paket"):
        return JASA["paket"]
    return JASA["laut"] if "laut" in moda else JASA["truk"]


def boleh_lihat(u, row):
    return boleh_kelola(u, row) or (u and u[1] == "pembeli" and row["pembeli_id"] == u[0])


@app.get("/api/penjualan/<int:sid>/kirim")
def opsi_kirim(sid):
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
    if not row:
        return err(f"penjualan id {sid} tidak ditemukan", 404)
    if not boleh_kelola(pengguna(), row):
        return err("hanya penjual pesanan ini atau admin", 403)
    return ok({"jasa_kirim": jasa_untuk(row), "cara_serah": ["Pickup", "Antar ke counter"], "moda_kirim": row.get("moda_kirim")})


@app.post("/api/penjualan/<int:sid>/kirim")
def atur_kirim(sid):
    """Penjual mengatur pengiriman: pilih jasa kirim & cara serah, sistem membuat nomor resi, status jadi Dikirim."""
    u = pengguna()
    b = request.get_json(silent=True) or {}
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
        if not row:
            return err(f"penjualan id {sid} tidak ditemukan", 404)
        if not boleh_kelola(u, row):
            return err("hanya penjual pesanan ini atau admin", 403)
        if row["status_pesanan"] != "Diproses":
            return err(f"pengiriman diatur setelah pesanan Diproses (sekarang {row['status_pesanan']})", 422)
        jasa = b.get("jasa_kirim") or jasa_untuk(row)[0]
        if jasa not in jasa_untuk(row):
            return err("jasa kirim tidak cocok dengan moda pengiriman pesanan ini", 400)
        serah = b.get("cara_serah") or "Pickup"
        if serah not in ("Pickup", "Antar ke counter"):
            return err("cara serah harus Pickup atau Antar ke counter", 400)
        resi = f"TMX{date.today():%y%m%d}{sid:05d}"
        cur.execute("UPDATE penjualan SET status_pesanan='Dikirim', jasa_kirim=%s, cara_serah=%s, no_resi=%s, dikirim_at=NOW() WHERE id=%s",
                    (jasa, serah, resi, sid))
        ket = "Paket dijemput kurir di lokasi penjual" if serah == "Pickup" else "Paket diantar penjual ke counter ekspedisi"
        cur.execute("INSERT INTO riwayat_kirim (penjualan_id, lokasi, keterangan, oleh) VALUES (%s,%s,%s,%s)",
                    (sid, row.get("kota_asal") or "-", f"{ket} ({jasa})", u[2] if u else "sistem"))
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
    kabari(row["pembeli_id"], f"Pesanan #{sid} dikirim", f"Resi {resi} lewat {jasa}. Lacak perjalanan paket di Pesanan Saya.")
    return ok(clean(row), message=f"pengiriman diatur, nomor resi {resi}")


@app.get("/api/penjualan/<int:sid>/riwayat")
def daftar_riwayat(sid):
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
        if not row:
            return err(f"penjualan id {sid} tidak ditemukan", 404)
        if not boleh_lihat(pengguna(), row):
            return err("anda tidak berhak melihat pesanan ini", 403)
        cur.execute("SELECT * FROM riwayat_kirim WHERE penjualan_id=%s ORDER BY waktu, id", (sid,))
        rows = [clean(x) for x in cur.fetchall()]
    return ok({"no_resi": row.get("no_resi"), "jasa_kirim": row.get("jasa_kirim"), "cara_serah": row.get("cara_serah"), "riwayat": rows})


def cek_riwayat(b, parsial=False):
    out = {}
    for f, n in (("lokasi", 100), ("keterangan", 200)):
        v = (b.get(f) or "").strip()
        if not v and not parsial:
            return None, err(f"{f} wajib diisi", 400)
        if v:
            if len(v) > n:
                return None, err(f"{f} maksimal {n} karakter", 400)
            out[f] = v
    if b.get("waktu"):
        out["waktu"] = str(b["waktu"]).replace("T", " ")[:19]
    return out, None


@app.post("/api/penjualan/<int:sid>/riwayat")
def tambah_riwayat(sid):
    u = pengguna()
    d, gagal = cek_riwayat(request.get_json(silent=True) or {})
    if gagal:
        return gagal
    with conn() as c, c.cursor() as cur:
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
        if not row:
            return err(f"penjualan id {sid} tidak ditemukan", 404)
        if not boleh_kelola(u, row):
            return err("hanya penjual pesanan ini atau admin", 403)
        if row["status_pesanan"] != "Dikirim":
            return err("riwayat perjalanan hanya bisa ditambah saat pesanan Dikirim", 422)
        cols = [*d.keys(), "penjualan_id", "oleh"]
        cur.execute(f"INSERT INTO riwayat_kirim ({','.join(cols)}) VALUES ({','.join(['%s'] * len(cols))})", [*d.values(), sid, u[2] if u else "sistem"])
        cur.execute("SELECT * FROM riwayat_kirim WHERE id=%s", (cur.lastrowid,))
        rw = cur.fetchone()
    kabari(row["pembeli_id"], f"Paket #{sid}: {d['keterangan'][:60]}", f"{d['lokasi']} · resi {row.get('no_resi') or '-'}")
    return ok(clean(rw), 201, "riwayat perjalanan ditambahkan")


def ambil_riwayat_milik(cur, rid, u):
    cur.execute("SELECT r.*, p.penjual_id, p.pembeli_id FROM riwayat_kirim r JOIN penjualan p ON p.id=r.penjualan_id WHERE r.id=%s", (rid,))
    rw = cur.fetchone()
    if not rw:
        return None, err(f"riwayat id {rid} tidak ditemukan", 404)
    if not boleh_kelola(u, rw):
        return None, err("hanya penjual pesanan ini atau admin", 403)
    return rw, None


@app.put("/api/penjualan/riwayat/<int:rid>")
def ubah_riwayat(rid):
    u = pengguna()
    d, gagal = cek_riwayat(request.get_json(silent=True) or {}, parsial=True)
    if gagal:
        return gagal
    if not d:
        return err("tidak ada data yang diubah", 400)
    with conn() as c, c.cursor() as cur:
        rw, gagal = ambil_riwayat_milik(cur, rid, u)
        if gagal:
            return gagal
        cur.execute(f"UPDATE riwayat_kirim SET {', '.join(k + '=%s' for k in d)} WHERE id=%s", [*d.values(), rid])
        cur.execute("SELECT * FROM riwayat_kirim WHERE id=%s", (rid,))
        rw = cur.fetchone()
    return ok(clean(rw), message="riwayat diperbarui")


@app.delete("/api/penjualan/riwayat/<int:rid>")
def hapus_riwayat(rid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        rw, gagal = ambil_riwayat_milik(cur, rid, u)
        if gagal:
            return gagal
        cur.execute("DELETE FROM riwayat_kirim WHERE id=%s", (rid,))
    return ok({"id": rid}, message="riwayat dihapus")


@app.get("/api/penjualan/<int:sid>/pembayaran")
def pembayaran(sid):
    """Instruksi bayar SIMULASI sesuai metode pesanan: QRIS, GoPay, DANA (QR + nomor tujuan), Transfer Bank (virtual account)."""
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        row, gagal = ambil_milik_pembeli(cur, sid, u)
        if gagal:
            return gagal
    if row["status_bayar"] == "Lunas":
        return err("transaksi ini sudah lunas", 422)
    if row["status_pesanan"] == "Dibatalkan":
        return err("pesanan ini sudah dibatalkan", 422)
    metode = request.args.get("metode") or row.get("metode_bayar") or "QRIS"
    if metode not in METODE:
        return err("metode tidak dikenal", 400)
    d = clean(row)
    total = round(d["total_bayar"])
    kode = f"TM-{sid:06d}"
    hasil = {"metode": metode, "kode_bayar": kode, "merchant": MERCHANT, "total": total, "berlaku_menit": BERLAKU_MENIT, "simulasi": True}
    if metode == "Transfer Bank":
        hasil["virtual_account"] = [{"bank": b, "nomor": f"{p}{sid:010d}"} for b, p in
                                    (("BCA", "39358"), ("BNI", "8808"), ("BRI", "12699"), ("Mandiri", "89608"))]
        hasil["langkah"] = ["Buka m-banking atau ATM bank pilihan Anda.", "Pilih Transfer ke Virtual Account.",
                            "Masukkan nomor VA di atas, pastikan nama tujuan TANIMART (SIMULASI).", "Setelah transfer, tekan tombol Saya sudah bayar."]
    else:
        payload = f"SIMULASI-{metode.upper()}|{MERCHANT}|{kode}|IDR{total}"
        img = qrcode.make(payload, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
        hasil.update({"payload": payload, "qr_svg": img.to_string(encoding="unicode")})
        hasil["langkah"] = ({"QRIS": ["Buka aplikasi e-wallet atau m-banking apa pun.", "Pilih Scan / Bayar QRIS.", "Arahkan kamera ke kode QR."],
                             "GoPay": ["Buka aplikasi Gojek, pilih Bayar.", "Scan kode QR, atau kirim ke nomor merchant 0811-0000-2026 (simulasi)."],
                             "DANA": ["Buka aplikasi DANA, pilih Scan.", "Scan kode QR, atau kirim ke nomor merchant 0811-0000-2026 (simulasi)."]}[metode]
                            + ["Setelah membayar, tekan tombol Saya sudah bayar."])
    if metode != row.get("metode_bayar"):
        with conn() as c, c.cursor() as cur:
            cur.execute("UPDATE penjualan SET metode_bayar=%s WHERE id=%s", (metode, sid))
    return ok(hasil, message=f"instruksi pembayaran {metode} (simulasi)")


@app.post("/api/penjualan/<int:sid>/sudah-bayar")
def sudah_bayar(sid):
    u = pengguna()
    with conn() as c, c.cursor() as cur:
        row, gagal = ambil_milik_pembeli(cur, sid, u)
        if gagal:
            return gagal
        if row["status_bayar"] != "Belum Lunas" or row["status_pesanan"] == "Dibatalkan":
            return err(f"status transaksi sudah '{row['status_bayar']}' / pesanan '{row['status_pesanan']}'", 422)
        cur.execute("UPDATE penjualan SET status_bayar='Menunggu Konfirmasi' WHERE id=%s", (sid,))
        kabari(row["penjual_id"], "Pembeli sudah membayar", f"Cek pembayaran pesanan #{sid} ({row.get('metode_bayar') or 'QRIS'}), lalu tekan Lunaskan.")
        cur.execute("SELECT * FROM penjualan WHERE id=%s", (sid,))
        row = cur.fetchone()
    return ok(clean(row), message="pembayaran dikirim, menunggu konfirmasi penjual")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
