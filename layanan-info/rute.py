"""Estimasi rute kirim hasil tani antarkota: darat, penyeberangan (RoRo), atau laut lewat pelabuhan.

Rumusnya sengaja sederhana dan terbuka. Semua tarif & kecepatan di ASUMSI adalah perkiraan untuk tugas,
bukan tarif resmi; ubah angkanya di sini kalau punya data yang lebih baik.
Koordinat 514 kab/kota: ArrayAccess/Indonesia-Postal-And-Area (MIT). Koordinat pelabuhan: perkiraan.
"""
import json
import math
import os

ASUMSI = {
    "faktor_jalan": 1.3,              # jalan darat lebih panjang dari garis lurus
    "faktor_alur_laut": 1.15,         # alur pelayaran lebih panjang dari garis lurus
    "kapasitas_truk_ton": 8,          # truk engkel/fuso
    "tarif_truk_per_km": 8000,        # Rp per km per truk (BBM, sopir, tol)
    "kecepatan_truk_kmj": 40,
    "jam_jalan_per_hari": 10,
    "tarif_feri_per_truk": 1500000,   # Rp sekali menyeberang (RoRo)
    "jam_feri": 4,
    "kapasitas_kontainer_ton": 20,    # kontainer 20 kaki
    "tarif_laut_per_km": 4000,        # Rp per km per kontainer
    "biaya_pelabuhan_per_kontainer": 2500000,  # bongkar muat di satu pelabuhan
    "kecepatan_kapal_kmj": 28,        # ± 15 knot
    "jam_tunggu_pelabuhan": 24,       # antre & bongkar muat per pelabuhan
    "ongkir_minimum": 10000,          # ongkos paling murah
    "batas_paket_kg": 100,            # <= 100 kg dikirim sebagai paket ekspedisi
    "tarif_paket_per_kg": {"dalam_provinsi": 8000, "satu_pulau": 12000, "feri": 16000, "laut": 25000},
}

PULAU = {
    "Sumatera": ["ACEH", "SUMATERA UTARA", "SUMATERA BARAT", "RIAU", "JAMBI", "SUMATERA SELATAN", "BENGKULU", "LAMPUNG"],
    "Jawa": ["DKI JAKARTA", "JAWA BARAT", "JAWA TENGAH", "DI YOGYAKARTA", "JAWA TIMUR", "BANTEN"],
    "Bali": ["BALI"],
    "Bangka Belitung": ["KEP. BANGKA BELITUNG"],
    "Kepulauan Riau": ["KEP. RIAU"],
    "Nusa Tenggara Barat": ["NUSA TENGGARA BARAT"],
    "Nusa Tenggara Timur": ["NUSA TENGGARA TIMUR"],
    "Kalimantan": ["KALIMANTAN BARAT", "KALIMANTAN TENGAH", "KALIMANTAN SELATAN", "KALIMANTAN TIMUR", "KALIMANTAN UTARA"],
    "Sulawesi": ["SULAWESI UTARA", "GORONTALO", "SULAWESI TENGAH", "SULAWESI BARAT", "SULAWESI SELATAN", "SULAWESI TENGGARA"],
    "Maluku": ["MALUKU"],
    "Maluku Utara": ["MALUKU UTARA"],
    "Papua": ["PAPUA", "PAPUA BARAT", "PAPUA BARAT DAYA", "PAPUA PEGUNUNGAN", "PAPUA SELATAN", "PAPUA TENGAH"],
}
RORO = [("Sumatera", "Jawa"), ("Jawa", "Bali")]   # Bakauheni–Merak, Ketapang–Gilimanuk

# Pelabuhan utama per provinsi: (nama, lintang, bujur) — perkiraan
PELABUHAN = {
    "ACEH": ("Malahayati", 5.60, 95.58), "SUMATERA UTARA": ("Belawan", 3.79, 98.69),
    "SUMATERA BARAT": ("Teluk Bayur", -1.00, 100.37), "RIAU": ("Dumai", 1.68, 101.45),
    "JAMBI": ("Talang Duku", -1.55, 103.70), "SUMATERA SELATAN": ("Boom Baru", -2.98, 104.78),
    "BENGKULU": ("Pulau Baai", -3.90, 102.30), "LAMPUNG": ("Panjang", -5.47, 105.32),
    "KEP. BANGKA BELITUNG": ("Pangkal Balam", -2.10, 106.13), "KEP. RIAU": ("Batu Ampar", 1.17, 104.00),
    "DKI JAKARTA": ("Tanjung Priok", -6.10, 106.88), "JAWA BARAT": ("Patimban", -6.25, 107.91),
    "JAWA TENGAH": ("Tanjung Emas", -6.95, 110.42), "DI YOGYAKARTA": ("Tanjung Emas (Semarang)", -6.95, 110.42),
    "JAWA TIMUR": ("Tanjung Perak", -7.20, 112.73), "BANTEN": ("Ciwandan", -6.02, 105.95),
    "BALI": ("Benoa", -8.74, 115.21), "NUSA TENGGARA BARAT": ("Lembar", -8.73, 116.07),
    "NUSA TENGGARA TIMUR": ("Tenau", -10.20, 123.53), "KALIMANTAN BARAT": ("Dwikora", -0.02, 109.34),
    "KALIMANTAN TENGAH": ("Sampit", -2.55, 112.95), "KALIMANTAN SELATAN": ("Trisakti", -3.33, 114.56),
    "KALIMANTAN TIMUR": ("Semayang", -1.27, 116.81), "KALIMANTAN UTARA": ("Malundung", 3.29, 117.58),
    "SULAWESI UTARA": ("Bitung", 1.44, 125.19), "GORONTALO": ("Gorontalo", 0.51, 123.06),
    "SULAWESI TENGAH": ("Pantoloan", -0.71, 119.86), "SULAWESI BARAT": ("Belang-Belang", -2.68, 118.89),
    "SULAWESI SELATAN": ("Soekarno-Hatta (Makassar)", -5.12, 119.41), "SULAWESI TENGGARA": ("Bungkutoko", -3.98, 122.60),
    "MALUKU": ("Yos Sudarso (Ambon)", -3.69, 128.18), "MALUKU UTARA": ("Ahmad Yani (Ternate)", 0.78, 127.38),
    "PAPUA": ("Jayapura", -2.54, 140.71), "PAPUA BARAT": ("Manokwari", -0.86, 134.08),
    "PAPUA BARAT DAYA": ("Sorong", -0.88, 131.25), "PAPUA PEGUNUNGAN": ("Jayapura (lalu darat)", -2.54, 140.71),
    "PAPUA SELATAN": ("Merauke", -8.47, 140.39), "PAPUA TENGAH": ("Samabusa (Nabire)", -3.33, 135.53),
}
PULAU_DARI = {p: pulau for pulau, ps in PULAU.items() for p in ps}

with open(os.path.join(os.path.dirname(__file__), "kota.json"), encoding="utf-8") as _f:
    _K = json.load(_f)
KOTA = {k["id"]: k for k in _K["kota"]}
PROY = _K["proyeksi"]
PROVINSI = sorted(PULAU_DARI)
# titik wakil provinsi = rata-rata koordinat kota di provinsi itu
PUSAT_PROV = {}
for _p in PROVINSI:
    _ks = [k for k in KOTA.values() if k["provinsi"] == _p]
    PUSAT_PROV[_p] = (sum(k["lat"] for k in _ks) / len(_ks), sum(k["lon"] for k in _ks) / len(_ks))


def xy(lat, lon):
    return round(PROY["kx"] * lon + PROY["bx"], 1), round(PROY["ky"] * lat + PROY["by"], 1)


def haversine(a, b):
    (la1, lo1), (la2, lo2) = a, b
    r = math.radians
    h = math.sin(r(la2 - la1) / 2) ** 2 + math.cos(r(la1)) * math.cos(r(la2)) * math.sin(r(lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def titik(prov, kota_id):
    k = KOTA.get(kota_id) if kota_id else None
    if k and k["provinsi"] == prov:
        return k["nama"], (k["lat"], k["lon"])
    return prov.title(), PUSAT_PROV[prov]


def estimasi(asal, tujuan, ton, kota_asal=None, kota_tujuan=None):
    A = ASUMSI
    na, pa_ll = titik(asal, kota_asal)
    nt, pt_ll = titik(tujuan, kota_tujuan)
    lurus = haversine(pa_ll, pt_ll)
    pa, pt = PULAU_DARI[asal], PULAU_DARI[tujuan]
    truk = math.ceil(ton / A["kapasitas_truk_ton"])
    tahap, jalur, biaya, hari = [], [{"nama": na, "jenis": "asal", **dict(zip("xy", xy(*pa_ll)))}], 0.0, 0.0

    def darat(ket, km):
        nonlocal biaya, hari
        km = max(km, 5)
        b = km * A["tarif_truk_per_km"] * truk
        h = (km / A["kecepatan_truk_kmj"]) / A["jam_jalan_per_hari"]
        biaya += b; hari += h
        tahap.append({"moda": "Truk", "keterangan": ket, "jarak_km": round(km), "biaya": round(b), "hari": round(h, 2),
                      "rincian": f"{round(km)} km × Rp{A['tarif_truk_per_km']:,}/km × {truk} truk".replace(",", ".")})

    if pa == pt or (pa, pt) in RORO or (pt, pa) in RORO:
        jalan = lurus * A["faktor_jalan"]
        if pa == pt:
            moda = "Darat"
            darat(f"{na} → {nt}", jalan)
        else:
            moda = "Darat + feri"
            darat(f"{na} → pelabuhan penyeberangan", jalan / 2)
            b = A["tarif_feri_per_truk"] * truk
            h = A["jam_feri"] / 24 + 0.25
            biaya += b; hari += h
            tahap.append({"moda": "Feri RoRo", "keterangan": f"Menyeberang {pa} → {pt} (truk ikut kapal)", "jarak_km": None,
                          "biaya": round(b), "hari": round(h, 2), "rincian": f"Rp{A['tarif_feri_per_truk']:,} × {truk} truk".replace(",", ".")})
            darat(f"Pelabuhan penyeberangan → {nt}", jalan / 2)
    else:
        moda = "Laut"
        kont = math.ceil(ton / A["kapasitas_kontainer_ton"])
        (pn_a, *pl_a), (pn_t, *pl_t) = PELABUHAN[asal], PELABUHAN[tujuan]
        darat(f"{na} → Pelabuhan {pn_a}", haversine(pa_ll, pl_a) * A["faktor_jalan"])
        laut = haversine(pl_a, pl_t) * A["faktor_alur_laut"]
        b = laut * A["tarif_laut_per_km"] * kont + 2 * A["biaya_pelabuhan_per_kontainer"] * kont
        h = (laut / A["kecepatan_kapal_kmj"] + 2 * A["jam_tunggu_pelabuhan"]) / 24
        biaya += b; hari += h
        tahap.append({"moda": "Kapal", "keterangan": f"Pelabuhan {pn_a} → Pelabuhan {pn_t}", "jarak_km": round(laut),
                      "biaya": round(b), "hari": round(h, 2),
                      "rincian": (f"{round(laut)} km × Rp{A['tarif_laut_per_km']:,}/km × {kont} kontainer + bongkar muat 2 pelabuhan "
                                  f"× Rp{A['biaya_pelabuhan_per_kontainer']:,} × {kont}").replace(",", ".")})
        darat(f"Pelabuhan {pn_t} → {nt}", haversine(pl_t, pt_ll) * A["faktor_jalan"])
        jalur += [{"nama": f"Pel. {pn_a}", "jenis": "pelabuhan", **dict(zip("xy", xy(*pl_a)))},
                  {"nama": f"Pel. {pn_t}", "jenis": "pelabuhan", **dict(zip("xy", xy(*pl_t)))}]
    jalur.append({"nama": nt, "jenis": "tujuan", **dict(zip("xy", xy(*pt_ll)))})

    # Pesanan kecil (<= 100 kg) dikirim sebagai paket ekspedisi, ongkos per kg (bukan sewa truk/kontainer)
    kg = ton * 1000
    paket = kg <= A["batas_paket_kg"]
    if paket:
        jenis = "dalam_provinsi" if asal == tujuan else {"Darat": "satu_pulau", "Darat + feri": "feri", "Laut": "laut"}[moda]
        tarif = A["tarif_paket_per_kg"][jenis]
        biaya = math.ceil(max(kg, 1)) * tarif
        hari += 1  # pengemasan & sortir di gudang ekspedisi
        tahap = [{**t, "biaya": None} for t in tahap]
        tahap.append({"moda": "Paket", "keterangan": f"Ongkos paket ekspedisi ({jenis.replace('_', ' ')})", "jarak_km": None,
                      "biaya": round(biaya), "hari": 1, "rincian": f"{math.ceil(max(kg, 1))} kg × Rp{tarif:,}/kg".replace(",", ".")})
        moda = f"Paket {moda.lower()}"
    biaya = max(biaya, A["ongkir_minimum"])

    return {
        "asal": asal, "tujuan": tujuan, "kota_asal": na, "kota_tujuan": nt, "ton": ton, "moda": moda,
        "pulau_asal": pa, "pulau_tujuan": pt, "jarak_garis_lurus_km": round(lurus), "jumlah_truk": truk,
        "jumlah_kontainer": math.ceil(ton / A["kapasitas_kontainer_ton"]) if moda == "Laut" else 0,
        "tahap": tahap, "jalur": jalur, "total_biaya": round(biaya), "biaya_per_kg": round(biaya / (ton * 1000)),
        "estimasi_hari": round(hari, 1), "estimasi_hari_bulat": max(1, math.ceil(hari)), "asumsi": ASUMSI,
    }
