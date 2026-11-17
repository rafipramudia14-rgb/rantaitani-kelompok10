// TaniMart: voucher toko (penjual: CRUD di menu Voucher; pembeli: pakai saat checkout)
let voucherList = [];
const labelV = (v) => v.tipe === "Persen" ? `Diskon ${v.nilai}%${v.maks_potongan ? " s.d. " + rp(v.maks_potongan) : ""}`
  : v.tipe === "Nominal" ? `Potongan ${rp(v.nilai)}` : `Gratis ongkir${v.nilai ? " s.d. " + rp(v.nilai) : ""}`;

async function muatVoucher() {
  if (!["penjual", "admin"].includes(role())) return;
  try { voucherList = (await api("GET", "/api/penjualan/voucher")).data; } catch { voucherList = []; }
  if (role() === "penjual") renderVoucherSaya();
  if (typeof renderModerasi === "function" && role() === "admin") renderModerasi();
}
function renderVoucherSaya() {
  $("#tbl-voucher").innerHTML = voucherList.map((v) => `<tr>
      <td><span class="v-kode">${esc(v.kode)}</span></td><td><b>${esc(v.nama)}</b><br><small>${labelV(v)}${v.min_belanja ? " · min. belanja " + rp(v.min_belanja) : ""}</small></td>
      <td>${esc(v.mulai)}<br><small>s.d. ${esc(v.selesai)}</small></td>
      <td class="num">${v.terpakai} / ${v.kuota}<div class="v-bar"><i style="width:${Math.min(100, (v.terpakai / v.kuota) * 100)}%"></i></div></td>
      <td>${v.berlaku ? '<span class="badge Lunas">Berlaku</span>' : !v.aktif ? '<span class="badge Belum">Nonaktif</span>' : v.sisa <= 0 ? '<span class="badge Bera">Habis</span>' : '<span class="badge Persiapan">Di luar periode</span>'}</td>
      <td>${aksi("voucher", v.id)}</td></tr>`).join("")
    || `<tr><td colspan="6" class="empty">Belum ada voucher. Buat voucher supaya pembeli tertarik belanja di toko Anda.</td></tr>`;
}
function bukaVoucher(v) {
  const f = $("#form-voucher");
  f.reset();
  $("#judul-voucher").textContent = v ? "Ubah Voucher" : "Buat Voucher";
  f.id.value = v?.id || "";
  const hari = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  if (v) ["kode", "nama", "tipe", "nilai", "maks_potongan", "min_belanja", "kuota", "mulai", "selesai"].forEach((k) => (f[k].value = v[k] ?? ""));
  else { f.mulai.value = hari(0); f.selesai.value = hari(30); f.kuota.value = 50; f.tipe.value = "Persen"; f.nilai.value = 10; f.maks_potongan.value = 20000; }
  f.aktif.checked = v ? !!v.aktif : true;
  aturFormVoucher();
  $("#dlg-voucher").showModal();
}
function aturFormVoucher() {
  const f = $("#form-voucher"), t = f.tipe.value;
  $("#v-label-nilai").firstChild.textContent = t === "Persen" ? "Diskon (%)" : t === "Nominal" ? "Potongan (Rp)" : "Maks. ongkir ditanggung (Rp, 0 = penuh)";
  f.maks_potongan.closest("label").hidden = t !== "Persen";
}
$("#form-voucher").tipe.addEventListener("change", aturFormVoucher);
$("#form-voucher").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target)), id = b.id; delete b.id;
  b.aktif = e.target.aktif.checked ? 1 : 0;
  if (b.tipe !== "Persen") b.maks_potongan = "";
  try { const r = await api(id ? "PUT" : "POST", "/api/penjualan/voucher" + (id ? "/" + id : ""), b); $("#dlg-voucher").close(); toast(r.message); muatVoucher(); }
  catch (err) { toast(err.message, true); }
});
$("#tambah-voucher").addEventListener("click", () => bukaVoucher());

// ---------------------------------------------------------------- Pembeli: voucher di checkout & halaman toko
async function voucherToko(penjualId) {
  try { return (await api("GET", `/api/penjualan/voucher/toko/${penjualId}`)).data; } catch { return []; }
}
async function siapkanVoucherCheckout(p) {
  B.voucher = null;
  $("#ck-v-kode").value = "";
  $("#ck-v-info").textContent = "";
  const vs = await voucherToko(p.penjual_id);
  $("#ck-v-daftar").innerHTML = vs.map((v) => `<button type="button" class="v-chip" data-pakai-v="${esc(v.kode)}"><b>${esc(v.kode)}</b><span>${labelV(v)}</span>${v.min_belanja ? `<small>min. ${rp(v.min_belanja)}</small>` : ""}</button>`).join("")
    || "<small class='hint'>Toko ini belum punya voucher.</small>";
}
// dipanggil dari hitungCheckout: cek ulang voucher setiap jumlah/alamat berubah, kembalikan potongan
async function potonganVoucher(subtotal, ongkir) {
  if (!B.voucher) { $("#ck-pot-baris").hidden = true; return 0; }
  try {
    const d = (await api("POST", "/api/penjualan/voucher/cek", { kode: B.voucher, panen_id: B.produk.panen_id, jumlah_kg: keKg($("#form-checkout")), ongkir })).data;
    $("#ck-v-info").innerHTML = `✓ <b>${esc(d.kode)}</b> dipakai, hemat ${rp(d.potongan)}`;
    $("#ck-v-info").className = "v-info ok";
    $("#ck-pot-baris").hidden = false; $("#ck-pot").textContent = "-" + rp(d.potongan);
    return d.potongan;
  } catch (err) {
    $("#ck-v-info").textContent = err.message; $("#ck-v-info").className = "v-info gagal";
    $("#ck-pot-baris").hidden = true;
    return 0;
  }
}
function pakaiVoucher(kode) {
  B.voucher = kode ? kode.trim().toUpperCase() : null;
  $("#ck-v-kode").value = B.voucher || "";
  document.querySelectorAll("[data-pakai-v]").forEach((b) => b.classList.toggle("aktif", b.dataset.pakaiV === B.voucher));
  hitungCheckout();
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-pakai-v]");
  if (t) pakaiVoucher(t.classList.contains("aktif") ? null : t.dataset.pakaiV);
});
$("#ck-v-pakai").addEventListener("click", () => pakaiVoucher($("#ck-v-kode").value));
