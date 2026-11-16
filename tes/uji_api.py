"""Uji API TaniMart lewat gateway (http://localhost:8090). Jalankan: python tes/uji_api.py

Semua data uji diberi nama "UJI ..." dan dihapus lagi di akhir. Butuh akun demo bawaan
(admin/admin123, darto|siti|ujang/petani123, rina/pembeli123).
"""
import json
import sys
import urllib.error
import urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8090"
hasil = []


def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(B + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=15) as x:
            return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def cek(nama, kode, harap):
    lolos = kode == harap if isinstance(harap, int) else kode in harap
    hasil.append(lolos)
    print(f"{'LOLOS' if lolos else 'GAGAL'}  {nama}  (HTTP {kode}, harap {harap})")


def login(u, p):
    k, j = req("POST", "/api/auth/login", {"username": u, "password": p})
    cek(f"login {u}", k, 200)
    return j.get("data", {}).get("token")


A, D, S, R = login("admin", "admin123"), login("darto", "petani123"), login("siti", "petani123"), login("rina", "pembeli123")
cek("login password salah ditolak", req("POST", "/api/auth/login", {"username": "admin", "password": "x"})[0], 401)
cek("akses tanpa token ditolak gateway", req("GET", "/api/lahan")[0], 401)
for s in ("auth", "lahan", "panen", "penjualan", "bantuan", "info"):
    cek(f"health {s}", req("GET", f"/api/{s}/health", token=A)[0], 200)

# ---- Lahan
k, j = req("POST", "/api/lahan", {"nama_lahan": "UJI Lahan", "lokasi": "Bandung", "luas_ha": 1.2, "jenis_tanah": "Aluvial",
                                  "komoditas": "Padi", "status": "Tanam"}, D)
cek("penjual tambah lahan", k, 201)
lid = j["data"]["id"]
cek("lihat lahan", req("GET", f"/api/lahan/{lid}", token=D)[0], 200)
cek("ubah lahan sendiri", req("PUT", f"/api/lahan/{lid}", {"luas_ha": 1.5}, D)[0], 200)
cek("penjual lain ubah lahan (403)", req("PUT", f"/api/lahan/{lid}", {"luas_ha": 2}, S)[0], 403)
cek("lahan tanpa field wajib (400)", req("POST", "/api/lahan", {"nama_lahan": "x"}, D)[0], 400)

# ---- Panen
k, j = req("POST", "/api/panen", {"lahan_id": lid, "tanggal_panen": "2026-11-01", "komoditas": "Padi", "jumlah_kg": 500,
                                  "kualitas": "A", "harga_per_kg": 6000}, D)
cek("catat panen", k, 201)
pid = j["data"]["id"]
cek("panen di lahan tak ada (422)", req("POST", "/api/panen", {"lahan_id": 999999, "tanggal_panen": "2026-11-01", "komoditas": "x",
                                                                "jumlah_kg": 1, "kualitas": "A", "harga_per_kg": 1}, D)[0], (400, 404, 422))
cek("ubah panen", req("PUT", f"/api/panen/{pid}", {"harga_per_kg": 6500}, D)[0], 200)

# ---- Katalog, beli, QRIS, status pesanan
k, j = req("GET", "/api/penjualan/katalog", token=R)
cek("katalog pembeli", k, 200)
cek("produk toko terverifikasi tampil", 200 if any(x["panen_id"] == pid for x in j["data"]) else 0, 200)
k, j = req("POST", "/api/penjualan", {"panen_id": pid, "jumlah_kg": 0.25}, R)
cek("pembeli beli 250 gram", k, 201)
sid = j["data"]["id"]
cek("beli melebihi stok (422)", req("POST", "/api/penjualan", {"panen_id": pid, "jumlah_kg": 99999}, R)[0], 422)
cek("QRIS simulasi", req("GET", f"/api/penjualan/{sid}/qris", token=R)[0], 200)
cek("pembeli konfirmasi sudah bayar", req("POST", f"/api/penjualan/{sid}/sudah-bayar", token=R)[0], 200)
cek("penjual lunaskan", req("PUT", f"/api/penjualan/{sid}", {"status_bayar": "Lunas"}, D)[0], 200)
cek("penjual proses", req("POST", f"/api/penjualan/{sid}/status", {"status": "Diproses"}, D)[0], 200)
cek("batal setelah diproses ditolak (422)", req("POST", f"/api/penjualan/{sid}/batal", token=R)[0], 422)
cek("penjual kirim", req("POST", f"/api/penjualan/{sid}/status", {"status": "Dikirim"}, D)[0], 200)
cek("pembeli terima", req("POST", f"/api/penjualan/{sid}/status", {"status": "Selesai"}, R)[0], 200)
k, j = req("POST", "/api/penjualan", {"panen_id": pid, "jumlah_kg": 1}, R)
cek("pembeli batal sebelum diproses", req("POST", f"/api/penjualan/{j['data']['id']}/batal", token=R)[0], 200)
k, j = req("POST", "/api/penjualan", {"panen_id": pid, "pembeli": "UJI Tengkulak", "jenis_pembeli": "Tengkulak", "jumlah_kg": 10,
                                      "harga_jual_per_kg": 6200, "tanggal_jual": "2026-11-02", "status_bayar": "Lunas"}, D)
cek("penjual catat penjualan manual", k, 201)
cek("pembeli tidak boleh ubah transaksi (403)", req("PUT", f"/api/penjualan/{sid}", {"jumlah_kg": 1}, R)[0], 403)

# ---- Toko, harga, estimasi, chatbot, pengguna
cek("toko publik", req("GET", "/api/auth/toko/publik")[0], 200)
cek("toko saya (penjual)", req("GET", "/api/auth/toko/saya", token=D)[0], 200)
cek("pembeli buka toko (403)", req("POST", "/api/auth/toko", {}, R)[0], 403)
k, j = req("POST", "/api/info/harga", {"komoditas": "UJI Bawang", "periode": "2026-10", "harga": 40000}, A)
cek("admin tambah harga pangan", k, 201)
hid = j["data"]["id"]
cek("penjual tambah harga (403)", req("POST", "/api/info/harga", {"komoditas": "x", "periode": "2026-10", "harga": 1}, D)[0], 403)
cek("harga publik", req("GET", "/api/info/publik/harga/terbaru")[0], 200)
cek("produksi publik", req("GET", "/api/info/publik/produksi?komoditas=Padi")[0], 200)
cek("estimasi kirim", req("GET", "/api/info/publik/estimasi?asal=JAWA%20TENGAH&tujuan=KALIMANTAN%20TIMUR&ton=2")[0], 200)
cek("chatbot publik", req("POST", "/api/bantuan/publik", {"pesan": "cara daftar"})[0], 200)
cek("chatbot login", req("POST", "/api/bantuan/chat", {"pesan": "status pembayaran saya"}, R)[0], 200)
k, j = req("POST", "/api/auth/users", {"nama": "UJI Akun", "username": "uji_akun_tes", "password": "uji12345", "role": "pembeli"}, A)
cek("admin tambah pengguna", k, 201)
uid = j["data"]["id"]
cek("non-admin lihat pengguna (403)", req("GET", "/api/auth/users", token=D)[0], 403)

# ---- Bersihkan data uji
cek("hapus pengguna uji", req("DELETE", f"/api/auth/users/{uid}", token=A)[0], 200)
cek("hapus harga uji", req("DELETE", f"/api/info/harga/{hid}", token=A)[0], 200)
_, j = req("GET", f"/api/penjualan?panen_id={pid}", token=A)
for x in j["data"]:
    req("DELETE", f"/api/penjualan/{x['id']}", token=A)
cek("hapus panen uji", req("DELETE", f"/api/panen/{pid}", token=D)[0], 200)
cek("hapus lahan uji", req("DELETE", f"/api/lahan/{lid}", token=D)[0], 200)
cek("hapus lagi -> 404", req("DELETE", f"/api/lahan/{lid}", token=D)[0], 404)

print(f"\n{sum(hasil)}/{len(hasil)} skenario lolos")
sys.exit(0 if all(hasil) else 1)
