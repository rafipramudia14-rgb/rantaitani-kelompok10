// TaniMart: keranjang belanja (disimpan di browser per akun) dan halaman toko.
// Checkout keranjang membuat satu pesanan per produk lewat API yang sama (ongkir dihitung server per pesanan).
const KR = {
  kunci: () => "tanimart-keranjang-" + (sesi?.user?.id || 0),
  ambil() { try { return JSON.parse(localStorage.getItem(this.kunci()) || "[]"); } catch { return []; } },
  simpan(isi) { try { localStorage.setItem(this.kunci(), JSON.stringify(isi)); } catch {} tandaiKeranjang(); },
};
function tandaiKeranjang() {
  const n = KR.ambil().length;
  $("#keranjang-btn").hidden = role() !== "pembeli";
  $("#keranjang-jml").textContent = n;
  $("#keranjang-jml").hidden = !n;
}

// Tombol "+ Keranjang" di jendela produk
$("#ck-tambah").addEventListener("click", () => {
  const f = $("#form-checkout"), p = B.produk, kg = keKg(f);
  if (!(kg > 0)) return toast("Isi jumlah dulu", true);
  if (kg > p.sisa_kg) return toast(`Stok hanya ${berat(p.sisa_kg)}`, true);
  const isi = KR.ambil();
  const ada = isi.find((x) => x.panen_id === p.panen_id);
  if (ada) ada.kg = Math.min(p.sisa_kg, Math.round((ada.kg + kg) * 1000) / 1000); else isi.push({ panen_id: p.panen_id, kg });
  KR.simpan(isi);
  $("#dlg-produk").close();
  toast(`${p.nama_produk} masuk keranjang`);
});

async function bukaKeranjang() {
  if (!B.profil) B.profil = (await api("GET", "/api/auth/profil")).data;
  const f = $("#form-keranjang");
  f.alamat_kirim.value = B.profil.alamat || "";
  f.no_hp_penerima.value = B.profil.no_hp || "";
  await pasangPilihKota(f.provinsi_tujuan, f.kota_tujuan_id, B.profil.provinsi, B.profil.kota_id);
  f.provinsi_tujuan.addEventListener("change", renderKeranjang);
  $("#dlg-keranjang").showModal();
  renderKeranjang();
}
let tundaKr;
function renderKeranjang() {
  const isi = KR.ambil().map((x) => ({ ...x, p: katalogList.find((k) => k.panen_id === x.panen_id) }));
  const hilang = isi.filter((x) => !x.p);
  if (hilang.length) KR.simpan(isi.filter((x) => x.p).map(({ panen_id, kg }) => ({ panen_id, kg })));
  const ok = isi.filter((x) => x.p);
  $("#kr-daftar").innerHTML = ok.map((x) => `<li data-kr="${x.panen_id}">
      <div class="kr-foto">${fotoProduk(x.p)}</div>
      <div class="kr-info"><b>${esc(x.p.nama_produk)}</b><small>${esc(x.p.toko)} · ${esc(x.p.kota)}</small><small>${rp(x.p.harga_per_kg)}/kg · stok ${berat(x.p.sisa_kg)}</small></div>
      <label class="kr-jml"><input type="number" min="0.001" step="any" value="${x.kg}" data-kr-kg="${x.panen_id}" aria-label="Jumlah kg"> kg</label>
      <div class="kr-harga"><b>${rp(x.kg * x.p.harga_per_kg)}</b><small data-kr-ongkir="${x.panen_id}">ongkir …</small></div>
      <button type="button" class="kr-hapus" data-kr-hapus="${x.panen_id}" aria-label="Hapus">×</button></li>`).join("")
    || `<li class="kosong">Keranjang masih kosong. <a href="#" data-tab-ke="beranda">Mulai belanja</a></li>`;
  $("#kr-checkout").disabled = !ok.length;
  clearTimeout(tundaKr);
  tundaKr = setTimeout(async () => {
    const f = $("#form-keranjang");
    let sub = 0, ongkir = 0, lengkap = true;
    for (const x of ok) {
      sub += x.kg * x.p.harga_per_kg;
      const el = document.querySelector(`[data-kr-ongkir="${x.panen_id}"]`);
      if (!f.provinsi_tujuan.value) { lengkap = false; if (el) el.textContent = "pilih alamat"; continue; }
      try {
        const d = await Estimasi.hitung(x.p.provinsi, f.provinsi_tujuan.value, x.kg / 1000 + "", x.p.kota_id, f.kota_tujuan_id.value);
        ongkir += d.total_biaya;
        if (el) el.textContent = `ongkir ${rp(d.total_biaya)} · ± ${d.estimasi_hari_bulat} hari`;
      } catch { lengkap = false; if (el) el.textContent = "ongkir -"; }
    }
    $("#kr-sub").textContent = rp(sub);
    $("#kr-ongkir").textContent = lengkap ? rp(ongkir) : "-";
    $("#kr-total").textContent = rp(sub + (lengkap ? ongkir : 0));
    $("#kr-jumlah").textContent = `${ok.length} produk dari ${new Set(ok.map((x) => x.p.toko)).size} toko`;
  }, 250);
}
$("#dlg-keranjang").addEventListener("input", (e) => {
  const id = e.target.dataset.krKg;
  if (id) {
    const isi = KR.ambil(), x = isi.find((y) => y.panen_id == id);
    if (x && Number(e.target.value) > 0) { x.kg = Number(e.target.value); KR.simpan(isi); renderKeranjang(); }
  }
  if (e.target.name === "kota_tujuan_id") renderKeranjang();
});
$("#dlg-keranjang").addEventListener("click", (e) => {
  const id = e.target.dataset.krHapus;
  if (id) { KR.simpan(KR.ambil().filter((x) => x.panen_id != id)); renderKeranjang(); }
});
$("#form-keranjang").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, isi = KR.ambil();
  if (!Number(f.kota_tujuan_id.value)) return toast("Pilih kab/kota tujuan", true);
  const dasar = { metode_bayar: f.metode_bayar.value, provinsi_tujuan: f.provinsi_tujuan.value, kota_tujuan_id: Number(f.kota_tujuan_id.value),
    alamat_kirim: f.alamat_kirim.value, no_hp_penerima: f.no_hp_penerima.value };
  $("#kr-checkout").disabled = true;
  const gagal = [];
  let berhasil = 0;
  for (const x of isi) {
    try { await api("POST", "/api/penjualan", { ...dasar, panen_id: x.panen_id, jumlah_kg: x.kg }); berhasil++; }
    catch (err) { gagal.push(x); toast(err.message, true); }
  }
  KR.simpan(gagal);
  $("#kr-checkout").disabled = false;
  if (berhasil) {
    $("#dlg-keranjang").close();
    toast(`${berhasil} pesanan dibuat. Bayar masing-masing di Pesanan Saya.`);
    B.filterPesanan = "Menunggu Bayar";
    await refresh();
    bukaTab("pesanan");
  }
});
$("#keranjang-btn").addEventListener("click", bukaKeranjang);

// ---------------------------------------------------------------- Halaman toko
async function bukaToko2(tokoId) {
  const t = tokoList.find((x) => x.id == tokoId);
  const produk = katalogList.filter((p) => p.toko_id == tokoId);
  if (!t && !produk.length) return toast("Toko tidak ditemukan", true);
  const nama = t?.nama_toko || produk[0].toko;
  const terjual = produk.reduce((a, p) => a + (p.terjual_kg || 0), 0);
  $("#tk-kepala").innerHTML = `<div class="tk-avatar">${ikonOf(t?.komoditas_utama || produk[0]?.komoditas || "")}</div>
    <div class="tk-judul"><h3>${esc(nama)}</h3><p><span class="mp-cek">✓ Terverifikasi</span> · 📍 ${esc(t?.kota || produk[0]?.kota || "")}, ${esc(judulP(t?.provinsi || produk[0]?.provinsi))}</p>
      ${t?.deskripsi ? `<p class="tk-desk">${esc(t.deskripsi)}</p>` : ""}</div>
    <dl class="tk-angka">${produk[0]?.rating_toko ? `<div><dt>Rating</dt><dd>★ ${produk[0].rating_toko} (${produk[0].ulasan_toko})</dd></div>` : ""}<div><dt>Produk</dt><dd>${produk.length}</dd></div><div><dt>Terjual</dt><dd>${berat(terjual)}</dd></div>
      ${t ? `<div><dt>Luas lahan</dt><dd>${kg(t.luas_lahan_ha)} ha</dd></div><div><dt>Hasil/panen</dt><dd>${berat(t.hasil_per_panen_kg)}</dd></div>` : ""}</dl>
    ${t?.kontak ? `<p class="tk-kontak">📞 ${esc(t.kontak)} · komoditas utama ${esc(t.komoditas_utama)}</p>` : ""}`;
  $("#tk-produk").innerHTML = produk.map(kartuProduk).join("") || `<p class="empty">Toko ini belum punya produk dengan stok.</p>`;
  $("#tk-voucher").innerHTML = "";
  $("#dlg-toko2").showModal();
  const vs = await voucherToko(t?.user_id || produk[0]?.penjual_id);
  $("#tk-voucher").innerHTML = vs.length ? `<h4 class="tk-sub">🎟️ Voucher toko</h4><div class="v-daftar">${vs.map((v) => `<div class="v-chip statis"><b>${esc(v.kode)}</b><span>${labelV(v)}</span><small>${v.min_belanja ? "min. " + rp(v.min_belanja) + " · " : ""}sisa ${v.sisa}</small></div>`).join("")}</div>` : "";
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-buka-toko]");
  if (!t) return;
  e.preventDefault(); e.stopPropagation();
  if ($("#dlg-produk").open) $("#dlg-produk").close();
  bukaToko2(t.dataset.bukaToko);
}, true);
// produk di halaman toko dibuka di atas jendela toko
$("#tk-produk").addEventListener("click", () => $("#dlg-toko2").close());
