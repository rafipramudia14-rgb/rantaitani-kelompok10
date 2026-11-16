"""Estimasi rute kirim hasil tani antarprovinsi: darat, penyeberangan (RoRo), atau laut lewat pelabuhan.

Rumusnya sengaja sederhana dan terbuka. Semua tarif & kecepatan di ASUMSI adalah perkiraan untuk tugas,
bukan tarif resmi; ubah angkanya di sini kalau punya data yang lebih baik.
"""
import json
import math
import os

ASUMSI = {
    "km_per_satuan_peta": 5.1,        # lebar peta 1000 satuan ≈ 46° bujur ≈ 5.100 km
    "faktor_jalan": 1.3,              # jalan darat lebih panjang dari garis lurus
    "faktor_alur_laut": 1.2,          # alur pelayaran lebih panjang dari garis lurus
    "jarak_ke_pelabuhan_km": 60,      # rata-rata gudang/lahan ke pelabuhan (dan pelabuhan ke tujuan)
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
}

# Pulau / daratan per provinsi. Sumatera–Jawa–Bali tersambung kapal feri RoRo (truk ikut menyeberang).
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
RORO = [("Sumatera", "Jawa"), ("Jawa", "Bali")]   # penyeberangan Bakauheni–Merak, Ketapang–Gilimanuk

PELABUHAN = {
    "ACEH": "Malahayati", "SUMATERA UTARA": "Belawan", "SUMATERA BARAT": "Teluk Bayur", "RIAU": "Dumai",
    "JAMBI": "Talang Duku", "SUMATERA SELATAN": "Boom Baru", "BENGKULU": "Pulau Baai", "LAMPUNG": "Panjang",
    "KEP. BANGKA BELITUNG": "Pangkal Balam", "KEP. RIAU": "Batu Ampar", "DKI JAKARTA": "Tanjung Priok",
    "JAWA BARAT": "Patimban", "JAWA TENGAH": "Tanjung Emas", "DI YOGYAKARTA": "Tanjung Emas (Semarang)",
    "JAWA TIMUR": "Tanjung Perak", "BANTEN": "Ciwandan", "BALI": "Benoa", "NUSA TENGGARA BARAT": "Lembar",
    "NUSA TENGGARA TIMUR": "Tenau", "KALIMANTAN BARAT": "Dwikora", "KALIMANTAN TENGAH": "Sampit",
    "KALIMANTAN SELATAN": "Trisakti", "KALIMANTAN TIMUR": "Semayang", "KALIMANTAN UTARA": "Malundung",
    "SULAWESI UTARA": "Bitung", "GORONTALO": "Gorontalo", "SULAWESI TENGAH": "Pantoloan",
    "SULAWESI BARAT": "Belang-Belang", "SULAWESI SELATAN": "Soekarno-Hatta (Makassar)", "SULAWESI TENGGARA": "Bungkutoko",
    "MALUKU": "Yos Sudarso (Ambon)", "MALUKU UTARA": "Ahmad Yani (Ternate)", "PAPUA": "Jayapura",
    "PAPUA BARAT": "Manokwari", "PAPUA BARAT DAYA": "Sorong", "PAPUA PEGUNUNGAN": "Jayapura (lalu darat)",
    "PAPUA SELATAN": "Merauke", "PAPUA TENGAH": "Samabusa (Nabire)",
}
PULAU_DARI = {p: pulau for pulau, ps in PULAU.items() for p in ps}


def _titik_tengah():
    path = os.path.join(os.path.dirname(__file__), "peta-provinsi.json")
    with open(path, encoding="utf-8") as f:
        geo = json.load(f)
    out = {}
    import re
    for p in geo["provinsi"]:
        n = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", p["d"])]
        xs, ys = n[0::2], n[1::2]
        out[p["nama"]] = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
    return out


TENGAH = _titik_tengah()
PROVINSI = sorted(TENGAH)


def garis_lurus_km(a, b):
    (x1, y1), (x2, y2) = TENGAH[a], TENGAH[b]
    return math.hypot(x1 - x2, y1 - y2) * ASUMSI["km_per_satuan_peta"]


def _jam_ke_hari(jam_jalan):
    return jam_jalan / ASUMSI["jam_jalan_per_hari"]


def estimasi(asal, tujuan, ton):
    A = ASUMSI
    lurus = garis_lurus_km(asal, tujuan)
    pa, pt = PULAU_DARI[asal], PULAU_DARI[tujuan]
    truk = math.ceil(ton / A["kapasitas_truk_ton"])
    tahap, biaya, hari = [], 0.0, 0.0

    def darat(nama, km):
        nonlocal biaya, hari
        b = km * A["tarif_truk_per_km"] * truk
        h = _jam_ke_hari(km / A["kecepatan_truk_kmj"])
        biaya += b; hari += h
        tahap.append({"moda": "Truk", "keterangan": nama, "jarak_km": round(km), "biaya": round(b), "hari": round(h, 2),
                      "rincian": f"{round(km)} km × Rp{A['tarif_truk_per_km']:,}/km × {truk} truk".replace(",", ".")})

    if pa == pt or (pa, pt) in RORO or (pt, pa) in RORO:
        jalan = max(lurus * A["faktor_jalan"], 20)
        moda = "Darat"
        if pa == pt:
            darat(f"{asal.title()} → {tujuan.title()} lewat jalan darat", jalan)
        else:
            moda = "Darat + feri"
            darat(f"{asal.title()} → pelabuhan penyeberangan", jalan / 2)
            b = A["tarif_feri_per_truk"] * truk
            h = A["jam_feri"] / 24 + 0.25
            biaya += b; hari += h
            tahap.append({"moda": "Feri RoRo", "keterangan": f"Menyeberang {pa} → {pt} (truk ikut kapal)", "jarak_km": None,
                          "biaya": round(b), "hari": round(h, 2), "rincian": f"Rp{A['tarif_feri_per_truk']:,} × {truk} truk".replace(",", ".")})
            darat(f"Pelabuhan penyeberangan → {tujuan.title()}", jalan / 2)
    else:
        moda = "Laut"
        kont = math.ceil(ton / A["kapasitas_kontainer_ton"])
        darat(f"Lahan di {asal.title()} → Pelabuhan {PELABUHAN[asal]}", A["jarak_ke_pelabuhan_km"])
        laut = lurus * A["faktor_alur_laut"]
        b = laut * A["tarif_laut_per_km"] * kont + 2 * A["biaya_pelabuhan_per_kontainer"] * kont
        h = (laut / A["kecepatan_kapal_kmj"] + 2 * A["jam_tunggu_pelabuhan"]) / 24
        biaya += b; hari += h
        tahap.append({"moda": "Kapal", "keterangan": f"Pelabuhan {PELABUHAN[asal]} → Pelabuhan {PELABUHAN[tujuan]}",
                      "jarak_km": round(laut), "biaya": round(b), "hari": round(h, 2),
                      "rincian": (f"{round(laut)} km × Rp{A['tarif_laut_per_km']:,}/km × {kont} kontainer + bongkar muat 2 pelabuhan "
                                  f"× Rp{A['biaya_pelabuhan_per_kontainer']:,} × {kont}").replace(",", ".")})
        darat(f"Pelabuhan {PELABUHAN[tujuan]} → tujuan di {tujuan.title()}", A["jarak_ke_pelabuhan_km"])

    return {
        "asal": asal, "tujuan": tujuan, "ton": ton, "moda": moda, "pulau_asal": pa, "pulau_tujuan": pt,
        "jarak_garis_lurus_km": round(lurus), "jumlah_truk": truk,
        "jumlah_kontainer": math.ceil(ton / A["kapasitas_kontainer_ton"]) if moda == "Laut" else 0,
        "tahap": tahap, "total_biaya": round(biaya), "biaya_per_kg": round(biaya / (ton * 1000)),
        "estimasi_hari": round(hari, 1), "estimasi_hari_bulat": max(1, math.ceil(hari)), "asumsi": A,
    }
