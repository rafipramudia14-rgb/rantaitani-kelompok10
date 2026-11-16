// TaniMart: ulasan & rating (pembeli memberi bintang 1-5 setelah pesanan Selesai)
const bintang = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
let ulasanSaya = null;   // {penjualan_id: ulasan}

async function muatUlasanSaya() {
  if (role() !== "pembeli") return;
  try {
    const d = (await api("GET", `/api/penjualan/ulasan?pembeli_id=${sesi.user.id}`)).data;
    ulasanSaya = Object.fromEntries(d.map((u) => [u.penjualan_id, u]));
  } catch { ulasanSaya = {}; }
  document.querySelectorAll("[data-ulas]").forEach((b) => {
    const u = ulasanSaya[b.dataset.ulas];
    b.textContent = u ? `${bintang(u.rating)} Ubah ulasan` : "★ Beri ulasan";
  });
}

async function tampilUlasanProduk(pid) {
  const el = $("#ck-ulasan");
  el.innerHTML = "<p class='hint'>Memuat ulasan…</p>";
  try {
    const d = (await api("GET", `/api/penjualan/ulasan?panen_id=${pid}`)).data;
    if (!d.length) { el.innerHTML = "<p class='ul-kosong'>Belum ada ulasan untuk produk ini.</p>"; return; }
    const rata = d.reduce((a, u) => a + u.rating, 0) / d.length;
    el.innerHTML = `<div class="ul-ringkas"><b>${rata.toFixed(1)}</b><span class="ul-bintang">${bintang(rata)}</span><small>${d.length} ulasan</small></div>`
      + d.slice(0, 5).map((u) => `<div class="ul-item"><div><b>${esc(u.nama_pembeli)}</b> <span class="ul-bintang">${bintang(u.rating)}</span></div>
        ${u.komentar ? `<p>${esc(u.komentar)}</p>` : ""}<small>${esc(String(u.created_at).slice(0, 10))}</small></div>`).join("");
  } catch (e) { el.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}

function bukaUlasan(sid) {
  const j = jualList.find((x) => x.id == sid);
  const ada = ulasanSaya?.[sid];
  const f = $("#form-ulasan");
  f.reset();
  f.sid.value = sid; f.uid.value = ada?.id || "";
  if (ada) { f.rating.value = ada.rating; f.komentar.value = ada.komentar || ""; }
  const k = katalogList.find((x) => x.panen_id == j?.panen_id);
  $("#ul-produk").textContent = k?.nama_produk || "Produk";
  $("#ul-hapus").hidden = !ada;
  $("#dlg-ulasan").showModal();
}
$("#form-ulasan").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.rating.value) return toast("Pilih jumlah bintang dulu", true);
  const body = { rating: Number(f.rating.value), komentar: f.komentar.value };
  try {
    const r = f.uid.value ? await api("PUT", `/api/penjualan/ulasan/${f.uid.value}`, body) : await api("POST", `/api/penjualan/${f.sid.value}/ulasan`, body);
    toast(r.message); $("#dlg-ulasan").close(); await muatUlasanSaya(); refresh();
  } catch (err) { toast(err.message, true); }
});
$("#ul-hapus").addEventListener("click", async () => {
  const id = $("#form-ulasan").uid.value;
  if (!id || !confirm("Hapus ulasan ini?")) return;
  try { toast((await api("DELETE", `/api/penjualan/ulasan/${id}`)).message); $("#dlg-ulasan").close(); await muatUlasanSaya(); refresh(); }
  catch (err) { toast(err.message, true); }
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-ulas]");
  if (t) bukaUlasan(t.dataset.ulas);
});
