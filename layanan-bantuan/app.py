"""RantaiTani - Layanan Bantuan (Flask): chatbot asisten berbasis aturan (tanpa AI berbayar, jalan offline).

- POST /api/bantuan/chat     -> untuk pengguna yang login (identitas dari gateway: X-User-*)
- POST /api/bantuan/publik   -> untuk halaman login (tanpa token)
Bot dapat membaca status pembayaran milik pengguna dengan memanggil layanan-penjualan
lewat Docker network, meneruskan header identitas yang sama.
"""
import json
import os
import re
import urllib.request
from urllib.parse import unquote

from flask import Flask, jsonify, request

app = Flask(__name__)
PENJUALAN_URL = os.getenv("PENJUALAN_SERVICE_URL", "http://layanan-penjualan:5000")
SVC = "layanan-bantuan"


def ok(data, message="success"):
    return jsonify({"status": "success", "service": SVC, "message": message, "data": data})


def err(message, code):
    return jsonify({"status": "error", "service": SVC, "message": message}), code


def rp(n):
    return "Rp " + f"{round(n):,}".replace(",", ".")


def pengguna():
    role = request.headers.get("X-User-Role")
    if not role:
        return None
    return {"id": request.headers.get("X-User-Id"), "role": role, "nama": unquote(request.headers.get("X-User-Name", ""))}


def normal(t):
    t = t.lower()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return " " + re.sub(r"\s+", " ", t).strip() + " "


# ------------------------------------------------------------------ basis pengetahuan
# (nama, kata kunci, bobot) -> fungsi jawaban(user) mengembalikan (teks, saran)
NIAT = [
    ("salam", ["halo", "hai", "hallo", "pagi", "siang", "sore", "malam", "assalamualaikum", "permisi", "hi"], 1),
    ("terima_kasih", ["makasih", "terima kasih", "thanks", "thx", "oke makasih"], 2),
    ("status_bayar", ["status", "tagihan", "belum lunas", "sudah bayar belum", "cek pembayaran", "pembayaran saya", "transaksi saya",
                      "pesanan saya", "pembelian saya", "berapa yang harus", "sudah lunas", "menunggu konfirmasi"], 3),
    ("cara_bayar", ["bayar", "pembayaran", "qris", "gopay", "dana", "ovo", "shopeepay", "m banking", "mbanking", "transfer", "lunasi", "melunasi"], 2),
    ("konfirmasi_lama", ["belum dikonfirmasi", "lama", "kok belum lunas", "belum berubah", "masih menunggu", "tidak dikonfirmasi"], 3),
    ("qr_masalah", ["tidak bisa scan", "gagal scan", "qr error", "kedaluwarsa", "expired", "kadaluarsa", "qr tidak", "invalid", "tidak terbaca"], 3),
    ("batal", ["batal", "cancel", "membatalkan", "refund", "uang kembali"], 2),
    ("cara_beli", ["beli", "membeli", "pesan", "order", "katalog", "belanja", "cara pesan"], 2),
    ("satuan", ["gram", "ons", "satuan", "kuintal", "ton", "eceran", "sedikit", "per gram", "berapa gram", "setengah kilo"], 3),
    ("stok", ["stok", "habis", "tidak cukup", "sisa", "persediaan", "kosong"], 2),
    ("harga", ["harga", "mahal", "murah", "nego", "diskon", "ongkir", "ongkos kirim", "pengiriman", "kirim"], 2),
    ("daftar", ["daftar", "register", "buat akun", "registrasi", "sign up"], 2),
    ("lupa_password", ["lupa password", "lupa kata sandi", "reset password", "ganti password", "ubah password", "tidak bisa login", "gagal login", "salah password"], 3),
    ("peran", ["peran", "role", "admin", "penjual", "pembeli", "perbedaan", "beda akun", "hak akses"], 1),
    ("lahan", ["lahan", "sawah", "kebun", "ladang", "tambah lahan"], 2),
    ("panen", ["panen", "catat panen", "hasil panen", "kualitas"], 2),
    ("penjualan_penjual", ["catat penjualan", "jual", "menjual", "tengkulak", "koperasi", "pabrik", "lunaskan", "konfirmasi bayar", "konfirmasi pembayaran"], 2),
    ("ringkasan", ["ringkasan", "pendapatan", "piutang", "laporan", "total", "rekap"], 2),
    ("tentang", ["apa itu", "rantaitani", "tanimart", "tani mart", "tentang", "fungsi web", "web ini", "aplikasi ini", "kegunaan"], 2),
    ("teknis", ["docker", "microservice", "container", "kontainer", "flask", "express", "nginx", "mysql", "arsitektur", "jwt", "api"], 2),
    ("status_layanan", ["status layanan", "layanan mati", "server", "error", "tidak bisa dibuka", "loading", "lampu merah", "down"], 2),
    ("kelola_pengguna", ["kelola pengguna", "tambah pengguna", "hapus akun", "hapus pengguna", "akun pengguna", "menu pengguna"], 3),
    ("kontak", ["kontak", "hubungi", "admin bantu", "cs", "customer service", "manusia", "operator", "komplain", "keluhan"], 2),
]

SARAN_UMUM = {
    None: ["Apa itu TaniMart?", "Cara daftar akun", "Lupa password"],
    "pembeli": ["Cek status pembayaran saya", "Cara bayar QRIS", "Cara membeli", "Cara membatalkan"],
    "penjual": ["Cara melunaskan pembayaran", "Cara catat panen", "Cara catat penjualan", "Stok tidak cukup"],
    "admin": ["Perbedaan peran", "Cek status layanan", "Cara kelola pengguna", "Arsitektur Docker"],
}


def ambil_transaksi():
    """Panggil layanan-penjualan dengan identitas pengguna yang sama (diteruskan dari gateway)."""
    h = {k: request.headers[k] for k in ("X-User-Id", "X-User-Role", "X-User-Name") if k in request.headers}
    req = urllib.request.Request(f"{PENJUALAN_URL}/api/penjualan", headers=h)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.load(r)["data"]


def jawab(niat, u):
    role = u["role"] if u else None
    nama = (u or {}).get("nama", "").split(" ")[0] if u else ""

    if niat == "salam":
        return (f"Halo{(' ' + nama) if nama else ''}! Saya Asisten TaniMart. Saya bisa bantu soal pembayaran QRIS, pembelian, "
                "akun, dan cara memakai web ini. Mau tanya apa?"), SARAN_UMUM[role]
    if niat == "terima_kasih":
        return "Sama-sama! Kalau ada kendala lain, tanya saja di sini.", SARAN_UMUM[role]

    if niat == "status_bayar":
        if not u:
            return "Silakan login dulu, nanti saya bisa cek status pembayaran Anda.", ["Cara daftar akun"]
        if role == "admin":
            return ("Admin bisa melihat semua transaksi di tab Penjualan. Gunakan filter Status Bayar untuk melihat yang "
                    "Belum Lunas atau Menunggu Konfirmasi."), SARAN_UMUM[role]
        try:
            data = ambil_transaksi()
        except Exception:  # noqa: BLE001
            return "Maaf, layanan penjualan sedang tidak bisa dihubungi. Coba lagi sebentar lagi.", SARAN_UMUM[role]
        belum = [d for d in data if d["status_bayar"] == "Belum Lunas"]
        tunggu = [d for d in data if d["status_bayar"] == "Menunggu Konfirmasi"]
        if role == "pembeli":
            if not data:
                return "Anda belum punya pembelian. Lihat tab Katalog Hasil Tani untuk mulai membeli.", ["Cara membeli"]
            baris = [f"Anda punya {len(data)} transaksi:"]
            if belum:
                baris.append(f"• {len(belum)} Belum Lunas, total {rp(sum(d['total_harga'] for d in belum))} "
                             f"(ID {', '.join(str(d['id']) for d in belum)}). Buka tab Pembelian Saya lalu klik Bayar QRIS.")
            if tunggu:
                baris.append(f"• {len(tunggu)} Menunggu Konfirmasi penjual (ID {', '.join(str(d['id']) for d in tunggu)}).")
            lunas = len(data) - len(belum) - len(tunggu)
            if lunas:
                baris.append(f"• {lunas} sudah Lunas.")
            return "\n".join(baris), ["Cara bayar QRIS", "Kenapa belum dikonfirmasi?", "Cara membatalkan"]
        # penjual
        if not tunggu and not belum:
            return "Semua penjualan Anda sudah lunas. Mantap!", SARAN_UMUM[role]
        baris = []
        if tunggu:
            baris.append(f"Ada {len(tunggu)} pembayaran yang menunggu konfirmasi Anda "
                         f"(ID {', '.join(str(d['id']) for d in tunggu)}, total {rp(sum(d['total_harga'] for d in tunggu))}). "
                         "Buka tab Penjualan Saya lalu klik Lunaskan setelah uang diterima.")
        if belum:
            baris.append(f"{len(belum)} transaksi masih Belum Lunas, total piutang {rp(sum(d['total_harga'] for d in belum))}.")
        return "\n".join(baris), ["Cara melunaskan pembayaran"]

    if niat == "cara_bayar":
        if role == "penjual":
            return ("Pembeli membayar lewat QRIS. Setelah pembeli menekan 'Saya sudah bayar', transaksinya berstatus "
                    "Menunggu Konfirmasi di tab Penjualan Saya. Periksa uangnya sudah masuk, lalu klik Lunaskan."), ["Cek status pembayaran saya"]
        return ("Cara bayar dengan QRIS:\n1. Buka tab Pembelian Saya.\n2. Klik Bayar QRIS pada transaksi yang Belum Lunas.\n"
                "3. Scan kode QR dengan GoPay, DANA, OVO, ShopeePay, atau m-banking.\n4. Tekan 'Saya sudah bayar'.\n"
                "5. Status menjadi Menunggu Konfirmasi sampai penjual menekan Lunaskan.\n"
                "Catatan: di versi tugas ini QRIS masih simulasi, tidak ada uang yang benar-benar berpindah."), \
            ["Cek status pembayaran saya", "QR tidak bisa discan", "Kenapa belum dikonfirmasi?"]
    if niat == "konfirmasi_lama":
        return ("Setelah Anda menekan 'Saya sudah bayar', penjual perlu mengecek uangnya dulu lalu menekan Lunaskan. "
                "Jika lama, hubungi penjual (nama penjual ada di tab Pembelian Saya). Status bisa Anda cek kapan saja di sini."), \
            ["Cek status pembayaran saya"]
    if niat == "qr_masalah":
        return ("Kode QR berlaku 15 menit. Jika kedaluwarsa, tutup lalu klik Bayar QRIS lagi untuk membuat kode baru. "
                "Karena ini QRIS simulasi untuk tugas, aplikasi e-wallet sungguhan akan menolak kode tersebut. "
                "Untuk demo, cukup tekan 'Saya sudah bayar'."), ["Cara bayar QRIS"]
    if niat == "batal":
        return ("Pesanan bisa dibatalkan selama statusnya Menunggu Bayar atau Dibayar: buka Pembelian Saya lalu klik Batalkan. "
                "Setelah penjual memproses pesanan (Diproses, Dikirim), pesanan tidak bisa dibatalkan lagi."), ["Cek status pembayaran saya"]
    if niat == "cara_beli":
        if role and role != "pembeli":
            return "Fitur beli hanya untuk akun pembeli. Penjual mencatat penjualan lewat tab Penjualan Saya.", SARAN_UMUM[role]
        return ("Cara membeli:\n1. Buka tab Katalog Hasil Tani.\n2. Pilih produk lalu klik Beli.\n3. Isi jumlah lalu pilih satuannya (gram, ons, kg, kuintal, atau ton); total dihitung otomatis.\n"
                "4. Klik Beli Sekarang, lalu bayar lewat Pembelian Saya → Bayar QRIS."), ["Cara bayar QRIS", "Beli per gram atau ons"]
    if niat == "satuan":
        return ("Pembelian dan pencatatan bisa memakai satuan gram, ons (100 g), kg, kuintal (100 kg), atau ton. Pilih satuannya "
                "di sebelah kolom jumlah; sistem mengubahnya otomatis ke kg. Contoh: cabai Rp 32.000/kg dibeli 250 gram = Rp 8.000. "
                "Harga per ons dan per gram juga tertera di kartu katalog."), ["Cara membeli", "Cara bayar QRIS"]
    if niat == "stok":
        if role == "penjual":
            return ("Sisa stok = jumlah panen dikurangi total yang sudah terjual. Jika penjualan ditolak karena stok tidak cukup, "
                    "catat panen baru atau kurangi jumlahnya. Sisa stok terlihat di tab Panen Saya."), ["Cara catat panen"]
        return ("Jumlah yang bisa dibeli tidak boleh melebihi stok yang tertulis di kartu produk. Jika muncul pesan 'stok tidak cukup', "
                "kurangi jumlahnya atau pilih produk lain."), ["Cara membeli"]
    if niat == "harga":
        return ("Harga per kg ditentukan petani saat mencatat panen dan tertera di katalog. Untuk versi ini belum ada fitur tawar-menawar "
                "maupun pengiriman; pengambilan barang diatur langsung dengan petani."), SARAN_UMUM[role]
    if niat == "daftar":
        return ("Cara daftar: di halaman login klik Daftar, isi nama, username, dan password (minimal 6 karakter), lalu pilih "
                "Pembeli atau Penjual (Petani). Akun admin hanya bisa dibuat oleh admin."), ["Perbedaan peran", "Lupa password"]
    if niat == "lupa_password":
        return ("Password tidak bisa direset sendiri. Hubungi admin TaniMart; admin dapat mengganti password Anda di menu Pengguna. "
                "Pastikan juga username yang diketik benar (huruf kecil/besar berpengaruh)."), ["Cara daftar akun"]
    if niat == "peran":
        return ("Ada 3 peran:\n• Admin: melihat dan mengelola semua data serta akun pengguna.\n"
                "• Penjual (petani): mengelola lahan, panen, dan penjualan miliknya, serta melunaskan pembayaran.\n"
                "• Pembeli: membeli dari katalog, membayar lewat QRIS, dan melihat riwayat pembelian."), SARAN_UMUM[role]
    if niat == "lahan":
        if role == "pembeli":
            return "Data lahan dikelola oleh petani. Asal lahan setiap produk terlihat di kartu katalog.", ["Cara membeli"]
        return "Tambah lahan: buka tab Lahan Saya (atau Data Lahan untuk admin), klik + Tambah Lahan, isi nama, lokasi, luas, komoditas, dan status.", ["Cara catat panen"]
    if niat == "panen":
        if role == "pembeli":
            return "Hasil panen yang masih punya stok tampil di Katalog Hasil Tani.", ["Cara membeli"]
        return ("Catat panen: buka tab Panen Saya, klik + Catat Panen, pilih lahan, isi tanggal, jumlah (kg), kualitas, dan harga per kg. "
                "Panen otomatis menjadi stok yang bisa dijual."), ["Cara catat penjualan"]
    if niat == "penjualan_penjual":
        if role == "pembeli":
            return "Untuk membeli, gunakan tab Katalog Hasil Tani.", ["Cara membeli"]
        return ("Penjual bisa:\n• Mencatat penjualan ke tengkulak, pasar, koperasi, atau pabrik: tab Penjualan Saya → + Catat Penjualan.\n"
                "• Melunaskan pembayaran dari pembeli: klik Lunaskan pada transaksi berstatus Menunggu Konfirmasi."), ["Cek status pembayaran saya"]
    if niat == "ringkasan":
        if role == "pembeli":
            return "Ringkasan pembelian Anda (jumlah transaksi, total dibeli, sudah dan belum dibayar) ada di tab Pembelian Saya.", ["Cek status pembayaran saya"]
        return ("Tab Ringkasan menampilkan jumlah dan luas lahan, total serta nilai panen, jumlah terjual, pendapatan (sudah lunas), "
                "piutang (belum lunas), dan sisa stok."), SARAN_UMUM[role]
    if niat == "tentang":
        return ("TaniMart adalah web untuk mencatat rantai hasil tani: lahan → panen → penjualan. Petani mengelola lahan dan panennya, "
                "pembeli membeli langsung dari katalog, dan admin mengawasi semuanya."), SARAN_UMUM[role]
    if niat == "teknis":
        return ("TaniMart berjalan di 7 container Docker: gateway Nginx, layanan-auth (Express), layanan-lahan (Flask), "
                "layanan-panen (Express), layanan-penjualan (Flask), layanan-bantuan (Flask, chatbot ini), dan MySQL. "
                "Semuanya terhubung lewat network tani-net, dan login memakai token JWT yang dicek di gateway."), SARAN_UMUM[role]
    if niat == "status_layanan":
        if role == "admin":
            return ("Lampu di kanan atas menunjukkan status tiap layanan: hijau berarti layanan dan database terhubung, merah berarti "
                    "container mati. Cek dengan perintah: docker compose ps, lalu nyalakan lagi dengan docker compose up -d."), SARAN_UMUM[role]
        return ("Jika halaman error atau tidak memuat data, coba muat ulang (F5). Jika masih bermasalah, kemungkinan salah satu "
                "layanan sedang dinyalakan ulang; hubungi admin."), SARAN_UMUM[role]
    if niat == "kelola_pengguna":
        if role != "admin":
            return "Pengelolaan akun hanya bisa dilakukan admin. Untuk mengganti password, hubungi admin.", SARAN_UMUM[role]
        return ("Buka tab Pengguna: klik + Tambah Pengguna untuk membuat akun (termasuk admin), Ubah untuk mengganti nama, "
                "peran, atau password, dan Hapus untuk menghapus akun. Akun Anda sendiri tidak bisa dihapus."), SARAN_UMUM[role]
    if niat == "kontak":
        return ("Saya asisten otomatis. Untuk masalah yang belum terjawab, hubungi admin TaniMart atau penjual terkait. "
                "Nama penjual tercantum di katalog dan di riwayat pembelian."), SARAN_UMUM[role]
    return None, None


def proses(pesan, u):
    t = normal(pesan)
    skor = {}
    for nama, kunci, bobot in NIAT:
        for k in kunci:
            if f" {k} " in t or (len(k) > 4 and k in t):
                skor[nama] = skor.get(nama, 0) + bobot * (2 if " " in k else 1)
    if skor:
        niat = max(skor, key=skor.get)
        teks, saran = jawab(niat, u)
        if teks:
            return {"jawaban": teks, "saran": saran, "niat": niat}
    role = u["role"] if u else None
    return {"jawaban": "Maaf, saya belum paham pertanyaannya. Coba pilih salah satu topik di bawah, atau tulis dengan kata lain "
                       "(misalnya: 'cara bayar QRIS', 'status pembayaran saya', 'lupa password').",
            "saran": SARAN_UMUM[role], "niat": "tidak_dikenal"}


@app.get("/api/bantuan/health")
@app.get("/api/bantuan/publik/health")
def health():
    return ok({"basis_pengetahuan": len(NIAT)}, "layanan-bantuan sehat")


@app.post("/api/bantuan/chat")
@app.post("/api/bantuan/publik")
def chat():
    b = request.get_json(silent=True) or {}
    pesan = str(b.get("pesan", "")).strip()[:500]
    u = pengguna() if request.path.endswith("/chat") else None
    if not pesan:
        role = u["role"] if u else None
        return ok({"jawaban": "Halo! Saya Asisten TaniMart. Ada yang bisa saya bantu?", "saran": SARAN_UMUM[role], "niat": "sapaan"})
    return ok(proses(pesan, u))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
