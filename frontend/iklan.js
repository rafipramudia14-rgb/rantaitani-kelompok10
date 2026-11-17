// TaniMart: Iklan produk (ala Iklan Shopee, simulasi tanpa biaya sungguhan).
// Penjual: menu "Iklan Saya" (CRUD + statistik). Pembeli: slot "Bersponsor" di Belanja. Admin: moderasi di menu Moderasi.
let iklanList = [];

async function muatIklan() {
  if (!["penjual", "admin"].includes(role())) return;
  try { iklanList = (await api("GET", "/api/panen/iklan")).data; } catch { iklanList = []; }
  if (role() === "penjual") renderIklanSaya();
  if (typeof renderModerasi === "function" && role() === "admin") renderModerasi();
}

function renderIklanSaya() {
  const aktif = iklanList.filter((i) => i.berjalan);
  const tayang = iklanList.reduce((a, i) => a + i.tayang, 0), klik = iklanList.reduce((a, i) => a + i.klik, 0);
  $("#ik-stat").innerHTML = [["Iklan berjalan", aktif.length + " / 3"], ["Total tayang", tayang.toLocaleString("id-ID")],
    ["Total klik", klik.toLocaleString("id-ID")], ["CTR", (tayang ? Math.round((klik / tayang) * 1000) / 10 : 0) + "%"],
    ["Anggaran/hari (simulasi)", rp(aktif.reduce((a, i) => a + i.anggaran_harian, 0))]]
    .map(([l, v]) => `<div class="card"><span>${l}</span><b>${v}</b></div>`).join("");
  $("#tbl-iklan").innerHTML = iklanList.map((i) => `<tr>
      <td class="produk-sel">${i.foto ? `<img class="thumb" src="${esc(i.foto)}" alt="">` : `<span class="thumb kosong">${ikonOf(i.komoditas)}</span>`}<span><b>${esc(i.judul)}</b><br><small>${esc(i.nama_produk || i.komoditas)}</small></span></td>
      <td class="kirim-sel"><small>${esc(i.kata_kunci)}</small></td>
      <td>${esc(i.mulai)}<br><small>s.d. ${esc(i.selesai)}</small></td>
      <td class="num">${rp(i.anggaran_harian)}</td>
      <td class="num">${i.tayang.toLocaleString("id-ID")}</td><td class="num">${i.klik.toLocaleString("id-ID")}</td><td class="num">${i.ctr_persen}%</td>
      <td>${i.berjalan ? '<span class="badge Lunas">Tayang</span>' : i.status === "Dijeda" ? '<span class="badge Belum">Dijeda</span>' : '<span class="badge Persiapan">Di luar periode</span>'}</td>
      <td><button class="btn sm" data-ik-jeda="${i.id}" data-ke="${i.status === "Aktif" ? "Dijeda" : "Aktif"}">${i.status === "Aktif" ? "Jeda" : "Aktifkan"}</button>${aksi("iklan", i.id)}</td></tr>`).join("")
    || `<tr><td colspan="9" class="empty">Belum ada iklan. Pasang iklan supaya produk tampil paling atas di halaman Belanja.</td></tr>`;
}

function bukaIklan(i) {
  if (!panenList.length) return toast("Catat produk dulu di Produk & Panen", true);
  const f = $("#form-iklan");
  f.reset();
  $("#judul-iklan").textContent = i ? "Ubah Iklan" : "Pasang Iklan";
  f.id.value = i?.id || "";
  f.panen_id.innerHTML = panenList.map((p) => `<option value="${p.id}">${esc(p.nama_produk || p.komoditas)} · ${rp(p.harga_aktif ?? p.harga_per_kg)}/kg</option>`).join("");
  const hari = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  if (i) ["panen_id", "judul", "kata_kunci", "mulai", "selesai", "anggaran_harian"].forEach((k) => (f[k].value = i[k]));
  else { f.mulai.value = hari(0); f.selesai.value = hari(14); f.anggaran_harian.value = 20000; isiSaranIklan(); }
  hitungIklan();
  $("#dlg-iklan").showModal();
}
function isiSaranIklan() {
  const f = $("#form-iklan"), p = panenList.find((x) => x.id == f.panen_id.value);
  if (!p || f.id.value) return;
  f.judul.value = `${p.nama_produk || p.komoditas} langsung dari petani`.slice(0, 80);
  f.kata_kunci.value = [p.komoditas, p.nama_produk, "segar", "petani"].filter(Boolean).join(", ").toLowerCase().slice(0, 200);
}
function hitungIklan() {
  const f = $("#form-iklan");
  const hari = Math.max(0, Math.round((new Date(f.selesai.value) - new Date(f.mulai.value)) / 864e5) + 1);
  $("#ik-estimasi").textContent = hari ? `${hari} hari × ${rp(Number(f.anggaran_harian.value) || 0)} = ${rp(hari * (Number(f.anggaran_harian.value) || 0))} (simulasi, tidak ada tagihan sungguhan)` : "";
}
$("#form-iklan").addEventListener("input", (e) => { if (e.target.name === "panen_id") isiSaranIklan(); hitungIklan(); });
$("#form-iklan").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target)), id = b.id; delete b.id;
  try { const r = await api(id ? "PUT" : "POST", "/api/panen/iklan" + (id ? "/" + id : ""), b); $("#dlg-iklan").close(); toast(r.message); muatIklan(); }
  catch (err) { toast(err.message, true); }
});
$("#tambah-iklan").addEventListener("click", () => bukaIklan());
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-ik-jeda]");
  if (!t) return;
  try { toast((await api("PUT", `/api/panen/iklan/${t.dataset.ikJeda}`, { status: t.dataset.ke })).message); muatIklan(); }
  catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- Slot "Bersponsor" untuk pembeli
let iklanTayang = [];
let tundaSponsor;
async function muatSponsor() {
  if (role() !== "pembeli") return;
  clearTimeout(tundaSponsor);
  tundaSponsor = setTimeout(async () => {
    try { iklanTayang = (await api("GET", "/api/panen/iklan/tayang?q=" + encodeURIComponent(B.cari || B.kategori || ""))).data; } catch { iklanTayang = []; }
    const kartu = iklanTayang.map((i) => ({ i, p: katalogList.find((k) => k.panen_id === i.panen_id) })).filter((x) => x.p);
    $("#mp-blok-sponsor").hidden = !kartu.length;
    $("#mp-sponsor").innerHTML = kartu.map(({ i, p }) => kartuProduk(p).replace('<article class="mp-kartu"', `<article class="mp-kartu sponsor" data-iklan="${i.id}"`)
      .replace('<div class="mp-isi">', `<div class="mp-isi"><span class="mp-iklan">Iklan · ${esc(i.judul)}</span>`)).join("");
  }, 300);
}
document.addEventListener("click", (e) => {
  const k = e.target.closest("[data-iklan]");
  if (k) fetch(`/api/panen/iklan/${k.dataset.iklan}/klik`, { method: "POST", headers: { Authorization: "Bearer " + sesi.token } }).catch(() => {});
}, true);
