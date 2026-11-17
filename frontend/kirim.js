// TaniMart: pengiriman produsen -> konsumen (Atur Pengiriman + nomor resi + riwayat perjalanan paket)
let kirimAktif = null;   // pesanan yang sedang diatur / diperbarui

async function bukaAturKirim(id) {
  const j = jualList.find((x) => x.id == id);
  try {
    const d = (await api("GET", `/api/penjualan/${id}/kirim`)).data;
    kirimAktif = j;
    const f = $("#form-kirim");
    f.reset(); f.id.value = id;
    f.jasa_kirim.innerHTML = d.jasa_kirim.map((x) => `<option>${esc(x)}</option>`).join("");
    $("#kr-ringkas-kirim").innerHTML = `<b>#${j.id} · ${esc(j.pembeli)}</b><br>${berat(j.jumlah_kg)} ${esc(labelPanen(j.panen_id).split(" · ")[0])} → ${esc(j.alamat_kirim || "")}, ${esc(j.kota_tujuan || "")}
      <br><small>🚚 ${esc(j.moda_kirim || "-")} · ± ${Math.ceil(j.estimasi_hari || 1)} hari${j.no_hp_penerima ? " · 📞 " + esc(j.no_hp_penerima) : ""}</small>`;
    $("#dlg-kirim").showModal();
  } catch (err) { toast(err.message, true); }
}
$("#form-kirim").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target)), id = b.id; delete b.id;
  try { const r = await api("POST", `/api/penjualan/${id}/kirim`, b); $("#dlg-kirim").close(); toast(r.message); refresh(); }
  catch (err) { toast(err.message, true); }
});

// Saran keterangan perjalanan dari titik jalur (asal -> pelabuhan -> tujuan)
function saranLacak(j) {
  const p = j.jalur || [];
  const s = [];
  const pel = p.filter((x) => x.jenis === "pelabuhan");
  if (pel.length === 2) {
    s.push([pel[0].nama.replace("Pel. ", "Pelabuhan "), "Paket tiba di gudang pelabuhan, menunggu kapal"]);
    s.push([pel[0].nama.replace("Pel. ", "Pelabuhan "), `Kapal berangkat menuju ${pel[1].nama.replace("Pel. ", "Pelabuhan ")}`]);
    s.push([pel[1].nama.replace("Pel. ", "Pelabuhan "), "Kapal tiba, kontainer dibongkar"]);
  } else s.push([j.kota_asal || "-", "Paket dalam perjalanan darat"]);
  s.push([j.kota_tujuan || "-", "Paket tiba di gudang kota tujuan"]);
  s.push([j.kota_tujuan || "-", "Paket sedang diantar kurir ke alamat pembeli"]);
  return s;
}
async function bukaUpdateLacak(id) {
  const j = jualList.find((x) => x.id == id);
  kirimAktif = j;
  const f = $("#form-lacak");
  f.reset(); f.id.value = id; f.rid.value = "";
  $("#lk-saran").innerHTML = saranLacak(j).map(([l, k], i) => `<button type="button" class="chip" data-saran="${i}">${esc(k)}</button>`).join("");
  $("#lk-saran").onclick = (e) => { const i = e.target.dataset.saran; if (i !== undefined) { const [l, k] = saranLacak(j)[i]; f.lokasi.value = l; f.keterangan.value = k; } };
  await renderRiwayatPenjual(id);
  $("#dlg-update-lacak").showModal();
}
async function renderRiwayatPenjual(id) {
  try {
    const d = (await api("GET", `/api/penjualan/${id}/riwayat`)).data;
    $("#lk-judul").textContent = `Update lacak #${id} · resi ${d.no_resi || "-"}`;
    $("#lk-daftar").innerHTML = d.riwayat.map((r) => `<li><div><b>${esc(r.keterangan)}</b><small>${esc(r.lokasi)} · ${esc(String(r.waktu).slice(0, 16))}</small></div>
      <span><button type="button" class="btn sm" data-ubah-rw="${r.id}" data-l="${esc(r.lokasi)}" data-k="${esc(r.keterangan)}">Ubah</button><button type="button" class="btn sm danger" data-hapus-rw="${r.id}">Hapus</button></span></li>`).join("")
      || "<li class='kosong'>Belum ada riwayat</li>";
  } catch (err) { toast(err.message, true); }
}
$("#form-lacak").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, b = { lokasi: f.lokasi.value, keterangan: f.keterangan.value };
  try {
    const r = f.rid.value ? await api("PUT", `/api/penjualan/riwayat/${f.rid.value}`, b) : await api("POST", `/api/penjualan/${f.id.value}/riwayat`, b);
    toast(r.message); f.lokasi.value = ""; f.keterangan.value = ""; f.rid.value = ""; renderRiwayatPenjual(f.id.value);
  } catch (err) { toast(err.message, true); }
});
$("#dlg-update-lacak").addEventListener("click", async (e) => {
  const t = e.target, f = $("#form-lacak");
  if (t.dataset.ubahRw) { f.rid.value = t.dataset.ubahRw; f.lokasi.value = t.dataset.l; f.keterangan.value = t.dataset.k; f.keterangan.focus(); }
  if (t.dataset.hapusRw && confirm("Hapus riwayat ini?")) {
    try { toast((await api("DELETE", `/api/penjualan/riwayat/${t.dataset.hapusRw}`)).message); renderRiwayatPenjual(f.id.value); } catch (err) { toast(err.message, true); }
  }
});

// Posisi paket di peta mengikuti riwayat terakhir: di pelabuhan, di tengah laut, atau di kota tujuan
function geserPaket(riwayat) {
  const el = document.getElementById("lc-paket");
  if (!el || !LACAK || !riwayat.length) return;
  const { pts, lebar } = LACAK, pel = pts.filter((p) => p.jenis === "pelabuhan"), tujuan = pts[pts.length - 1];
  const ket = riwayat[riwayat.length - 1].keterangan.toLowerCase();
  let pos = pts[0];
  if (/diterima|diantar|kota tujuan/.test(ket)) pos = tujuan;
  else if (pel.length === 2 && /kapal tiba|dibongkar/.test(ket)) pos = pel[1];
  else if (pel.length === 2 && /berangkat/.test(ket)) pos = { x: (pel[0].x + pel[1].x) / 2, y: (pel[0].y + pel[1].y) / 2 };
  else if (pel.length === 2 && /pelabuhan/.test(ket)) pos = pel[0];
  else if (/perjalanan/.test(ket)) pos = { x: (pts[0].x + tujuan.x) / 2, y: (pts[0].y + tujuan.y) / 2 };
  el.setAttribute("x", pos.x); el.setAttribute("y", pos.y + lebar / 60);
}

// Riwayat asli di jendela Lacak (pembeli & penjual)
async function isiRiwayatLacak(j) {
  try {
    const d = (await api("GET", `/api/penjualan/${j.id}/riwayat`)).data;
    if (!d.riwayat.length) return 0;
    $("#lacak-resi").innerHTML = `<span>No. resi <b>${esc(d.no_resi)}</b></span><span>${esc(d.jasa_kirim || "")}</span><span>${esc(d.cara_serah || "")}</span>`;
    geserPaket(d.riwayat);
    $("#lacak-riwayat").innerHTML = [...d.riwayat].reverse().map((r, i) => `<li class="${i ? "" : "baru"}"><b>${esc(r.keterangan)}</b><span>${esc(r.lokasi)}</span><small>${esc(String(r.waktu).slice(0, 16))}</small></li>`).join("");
    return d.riwayat.length;
  } catch { return 0; }
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-atur-kirim],[data-update-lacak]");
  if (!t) return;
  if (t.dataset.aturKirim) bukaAturKirim(t.dataset.aturKirim);
  if (t.dataset.updateLacak) bukaUpdateLacak(t.dataset.updateLacak);
});
