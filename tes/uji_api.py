"""Uji API TaniMart lewat gateway (http://127.0.0.1:8090). Jalankan: python tes/uji_api.py

Semua data uji diberi nama "UJI ..." dan dihapus lagi di akhir. Butuh akun demo bawaan
(admin/admin123, darto|siti|ujang/petani123, rina/pembeli123).
"""
import json
import sys
import urllib.error
import urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"
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


def bersihkan_sisa_uji():
    """Hapus data "UJI ..." yang tertinggal kalau run sebelumnya berhenti di tengah jalan."""
    for lh in req("GET", "/api/lahan", token=D)[1].get("data", []):
        if lh["nama_lahan"].startswith("UJI"):
            for pn in req("GET", f"/api/panen?lahan_id={lh['id']}", token=D)[1].get("data", []):
                for jl in req("GET", f"/api/penjualan?panen_id={pn['id']}", token=A)[1].get("data", []):
                    req("DELETE", f"/api/penjualan/{jl['id']}", token=A)
                for ik in req("GET", "/api/panen/iklan", token=D)[1].get("data", []):
                    if ik["panen_id"] == pn["id"]:
                        req("DELETE", f"/api/panen/iklan/{ik['id']}", token=D)
                req("DELETE", f"/api/panen/{pn['id']}", token=D)
            req("DELETE", f"/api/lahan/{lh['id']}", token=D)
    for h in req("GET", "/api/info/harga", token=A)[1].get("data", []):
        if h["komoditas"].startswith("UJI"):
            req("DELETE", f"/api/info/harga/{h['id']}", token=A)
    for u in req("GET", "/api/auth/users", token=A)[1].get("data", []):
        if u["username"] == "uji_akun_tes":
            req("DELETE", f"/api/auth/users/{u['id']}", token=A)
    for v in req("GET", "/api/penjualan/voucher", token=A)[1].get("data", []):
        if v["kode"].startswith("UJIVCR"):
            req("DELETE", f"/api/penjualan/voucher/{v['id']}", token=A)
    for p in req("GET", "/api/bantuan/percakapan", token=A)[1].get("data", []):
        if p["pembeli_id"] == 5 and p["penjual_id"] == 2:
            req("DELETE", f"/api/bantuan/percakapan/{p['id']}", token=A)


bersihkan_sisa_uji()
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
cek("kirim tanpa Atur Pengiriman ditolak (422)", req("POST", f"/api/penjualan/{sid}/status", {"status": "Dikirim"}, D)[0], 422)
cek("atur pengiriman + resi", req("POST", f"/api/penjualan/{sid}/kirim", {"cara_serah": "Pickup"}, D)[0], 200)
cek("tambah riwayat perjalanan", req("POST", f"/api/penjualan/{sid}/riwayat", {"lokasi": "Bandung", "keterangan": "UJI dalam perjalanan"}, D)[0], 201)
cek("pembeli tidak bisa tambah riwayat (403)", req("POST", f"/api/penjualan/{sid}/riwayat", {"lokasi": "x", "keterangan": "x"}, R)[0], 403)
cek("pembeli lihat riwayat", req("GET", f"/api/penjualan/{sid}/riwayat", token=R)[0], 200)
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

# ---- Fitur marketplace: login email, profil, lupa password, foto, checkout + ongkir, pembayaran, notifikasi
cek("login pakai email", req("POST", "/api/auth/login", {"username": "rina@tanimart.test", "password": "pembeli123"})[0], 200)
cek("daftar tanpa email ditolak (400)", req("POST", "/api/auth/register", {"nama": "x", "password": "123456"})[0], 400)
cek("profil pembeli", req("GET", "/api/auth/profil", token=R)[0], 200)
cek("endpoint internal diblok gateway (404)", req("POST", "/api/auth/internal/notifikasi", {"user_id": 1, "judul": "x", "isi": "x"})[0], 404)
k, j = req("POST", "/api/auth/lupa", {"email": "uji_akun_tes@tanimart.test"})
cek("lupa password email tak terdaftar (404)", k, 404)
cek("unggah foto bukan gambar ditolak (400)", req("POST", f"/api/panen/{pid}/foto", {"gambar": "data:image/png;base64,SGVsbG8="}, D)[0], 400)
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
cek("unggah foto produk", req("POST", f"/api/panen/{pid}/foto", {"gambar": PNG}, D)[0], 200)
for i in range(5):
    kg_, jg_ = req("POST", f"/api/panen/{pid}/galeri", {"gambar": PNG}, D)
cek("galeri berisi 5 foto", 200 if kg_ == 201 and len(jg_["data"]["galeri"]) == 5 else kg_, 200)
cek("galeri foto ke-6 ditolak (422)", req("POST", f"/api/panen/{pid}/galeri", {"gambar": PNG}, D)[0], 422)
cek("hapus foto galeri", req("DELETE", f"/api/panen/{pid}/galeri/0", token=D)[0], 200)
cek("penjual lain tambah galeri (403)", req("POST", f"/api/panen/{pid}/galeri", {"gambar": PNG}, S)[0], 403)
cek("promo lebih mahal ditolak (400)", req("PUT", f"/api/panen/{pid}", {"harga_promo": 999999}, D)[0], 400)
cek("set promo", req("PUT", f"/api/panen/{pid}", {"harga_promo": 5500, "unggulan": 1}, D)[0], 200)
k, j = req("POST", "/api/penjualan", {"panen_id": pid, "jumlah_kg": 2, "metode_bayar": "GoPay"}, R)
cek("checkout dengan ongkir otomatis", k, 201)
cek("ongkir & harga promo terpakai", 200 if j.get("data", {}).get("ongkir", 0) > 0 and j["data"]["harga_jual_per_kg"] == 5500 else 0, 200)
oid = j.get("data", {}).get("id")
cek("pembayaran transfer bank (VA)", req("GET", f"/api/penjualan/{oid}/pembayaran?metode=Transfer%20Bank", token=R)[0], 200)
cek("metode bayar tidak dikenal (400)", req("POST", "/api/penjualan", {"panen_id": pid, "jumlah_kg": 1, "metode_bayar": "OVO"}, R)[0], 400)
k, j = req("GET", "/api/auth/notifikasi", token=D)
cek("penjual dapat notifikasi pesanan", 200 if k == 200 and any("Pesanan baru" in n["judul"] for n in j["data"]["daftar"]) else 0, 200)
k, j = req("POST", "/api/penjualan/voucher", {"kode": "UJIVCR1", "nama": "UJI voucher", "tipe": "Nominal", "nilai": 1000, "min_belanja": 0,
                                               "kuota": 2, "mulai": "2026-01-01", "selesai": "2099-12-31"}, D)
cek("penjual buat voucher", k, 201)
vid = j.get("data", {}).get("id")
cek("kode voucher ganda ditolak (409)", req("POST", "/api/penjualan/voucher", {"kode": "UJIVCR1", "nama": "x", "tipe": "Nominal", "nilai": 1, "kuota": 1,
                                                                                  "mulai": "2026-01-01", "selesai": "2099-12-31"}, D)[0], 409)
cek("pembeli tidak bisa buat voucher (403)", req("POST", "/api/penjualan/voucher", {"kode": "UJIVCR2"}, R)[0], 403)
cek("cek voucher di checkout", req("POST", "/api/penjualan/voucher/cek", {"kode": "UJIVCR1", "panen_id": pid, "jumlah_kg": 1, "ongkir": 10000}, R)[0], 200)
k, j = req("POST", "/api/penjualan", {"panen_id": pid, "jumlah_kg": 1, "voucher_kode": "UJIVCR1"}, R)
cek("checkout pakai voucher", 200 if k == 201 and j["data"]["potongan"] == 1000 else k, 200)
cek("batal mengembalikan kuota voucher", req("POST", f"/api/penjualan/{j.get('data', {}).get('id')}/batal", token=R)[0], 200)
cek("ubah voucher", req("PUT", f"/api/penjualan/voucher/{vid}", {"kuota": 5}, D)[0], 200)
cek("hapus voucher", req("DELETE", f"/api/penjualan/voucher/{vid}", token=D)[0], 200)
cek("daftar ulasan", req("GET", f"/api/penjualan/ulasan?panen_id={pid}", token=R)[0], 200)
cek("ulasan sebelum pesanan selesai ditolak (422)", req("POST", f"/api/penjualan/{oid}/ulasan", {"rating": 5}, R)[0], 422)
cek("penjual tidak bisa mengulas (403)", req("POST", f"/api/penjualan/{oid}/ulasan", {"rating": 5}, D)[0], 403)
cek("ulasan pada pesanan selesai", req("POST", f"/api/penjualan/{sid}/ulasan", {"rating": 4, "komentar": "UJI ulasan"}, R)[0], 201)
cek("ulasan ganda ditolak (409)", req("POST", f"/api/penjualan/{sid}/ulasan", {"rating": 3}, R)[0], 409)
cek("rating di luar 1-5 ditolak (400)", req("POST", f"/api/penjualan/{sid}/ulasan", {"rating": 9}, R)[0], 400)
_, j = req("GET", f"/api/penjualan/ulasan?panen_id={pid}", token=R)
for x in j.get("data", []):
    req("DELETE", f"/api/penjualan/ulasan/{x['id']}", token=A)
k, j = req("POST", "/api/bantuan/percakapan", {"penjual_id": 2, "panen_id": pid}, R)
cek("pembeli mulai chat ke penjual", k, 201)
cid = j.get("data", {}).get("id")
k, j = req("POST", f"/api/bantuan/percakapan/{cid}/pesan", {"isi": "UJI halo"}, R)
cek("kirim pesan chat", k, 201)
mid = j.get("data", {}).get("id")
cek("penjual baca chat", req("GET", f"/api/bantuan/percakapan/{cid}/pesan", token=D)[0], 200)
cek("penjual lain tidak bisa baca chat (403)", req("GET", f"/api/bantuan/percakapan/{cid}/pesan", token=S)[0], 403)
cek("ubah pesan sendiri", req("PUT", f"/api/bantuan/pesan/{mid}", {"isi": "UJI halo (ubah)"}, R)[0], 200)
cek("hapus pesan sendiri", req("DELETE", f"/api/bantuan/pesan/{mid}", token=R)[0], 200)
cek("admin hapus percakapan uji", req("DELETE", f"/api/bantuan/percakapan/{cid}", token=A)[0], 200)
cek("penjual tidak bisa memulai chat (403)", req("POST", "/api/bantuan/percakapan", {"penjual_id": 3}, D)[0], 403)
cek("estimasi per kota", req("GET", "/api/info/publik/estimasi?asal=JAWA%20BARAT&tujuan=KALIMANTAN%20TIMUR&ton=0.002&kota_asal=3204&kota_tujuan=6471")[0], 200)
cek("daftar kota", req("GET", "/api/info/publik/kota?provinsi=BALI")[0], 200)

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
