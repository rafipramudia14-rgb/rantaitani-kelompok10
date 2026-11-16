// Tampilan hasil estimasi rute (dipakai halaman Info & bagian pasar). Data dari /api/info/publik/estimasi
(function () {
  const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const judul = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const hari = (h) => (h < 1 ? Math.max(1, Math.round(h * 24)) + " jam" : h.toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " hari");

  async function hitung(asal, tujuan, ton, kotaAsal, kotaTujuan) {
    const q = new URLSearchParams({ asal, tujuan, ton });
    if (kotaAsal) q.set("kota_asal", kotaAsal);
    if (kotaTujuan) q.set("kota_tujuan", kotaTujuan);
    const r = await fetch("/api/info/publik/estimasi?" + q, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || "Gagal menghitung estimasi");
    return j.data;
  }

  function html(d, komoditas) {
    const A = d.asumsi;
    const awet = /cabai|tomat|sayur|bawang|buah/i.test(komoditas || "") && d.estimasi_hari > 3
      ? `<p class="est-peringatan">Perjalanan lebih dari 3 hari. Untuk ${esc(komoditas)} sebaiknya pakai kontainer berpendingin (reefer), biayanya lebih mahal dari estimasi ini.</p>` : "";
    return `<div class="est-ringkas">
        <div><span>Moda</span><b>${esc(d.moda)}</b></div>
        <div><span>Total biaya</span><b>${rp(d.total_biaya)}</b><small>${rp(d.biaya_per_kg)}/kg</small></div>
        <div><span>Perkiraan waktu</span><b>${hari(d.estimasi_hari)}</b><small>± ${d.estimasi_hari_bulat} hari kerja</small></div>
        <div><span>Muatan</span><b>${d.ton.toLocaleString("id-ID")} ton</b><small>${d.jumlah_kontainer ? d.jumlah_kontainer + " kontainer · " : ""}${d.jumlah_truk} truk</small></div>
      </div>
      <ol class="est-tahap">${d.tahap.map((t) => `<li><b>${esc(t.moda)}</b> · ${esc(t.keterangan)}<br>
        <small>${esc(t.rincian)}${t.biaya == null ? "" : " = " + rp(t.biaya)} · ${hari(t.hari)}</small></li>`).join("")}</ol>
      ${awet}
      <details class="est-asumsi"><summary>Cara menghitung & asumsi</summary>
        <p>Jarak garis lurus ${judul(d.asal)} → ${judul(d.tujuan)} ± ${d.jarak_garis_lurus_km.toLocaleString("id-ID")} km (dari titik tengah provinsi di peta).
        ${d.moda === "Laut" ? `Pulau berbeda (${esc(d.pulau_asal)} → ${esc(d.pulau_tujuan)}), jadi barang dibawa truk ke pelabuhan, naik kapal, lalu truk lagi ke tujuan. Jarak laut = garis lurus × ${A.faktor_alur_laut}.`
          : d.moda === "Darat + feri" ? `Pulau tersambung kapal feri RoRo, truk ikut menyeberang. Jarak jalan = garis lurus × ${A.faktor_jalan}.`
          : `Satu pulau, jadi cukup lewat darat. Jarak jalan = garis lurus × ${A.faktor_jalan}.`}</p>
        <ul><li>Truk: ${A.kapasitas_truk_ton} ton, ${rp(A.tarif_truk_per_km)}/km, ${A.kecepatan_truk_kmj} km/jam, ${A.jam_jalan_per_hari} jam jalan per hari</li>
          <li>Kapal: kontainer ${A.kapasitas_kontainer_ton} ton, ${rp(A.tarif_laut_per_km)}/km, ${A.kecepatan_kapal_kmj} km/jam, bongkar muat ${rp(A.biaya_pelabuhan_per_kontainer)} dan ${A.jam_tunggu_pelabuhan} jam per pelabuhan</li>
          <li>Feri RoRo: ${rp(A.tarif_feri_per_truk)} per truk, ${A.jam_feri} jam</li></ul>
        <p>Angka ini perkiraan untuk perencanaan, bukan tarif resmi ekspedisi.</p></details>`;
  }

  window.Estimasi = { hitung, html, judul };
})();
