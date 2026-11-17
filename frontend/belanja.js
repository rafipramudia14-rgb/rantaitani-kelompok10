// TaniMart: tampilan marketplace pembeli (beranda, detail + checkout, pembayaran, pesanan & lacak),
// halaman Akun Saya, notifikasi, dan lupa password. Memakai helper dari app.js ($, api, rp, berat, esc, toast, sesi, refresh).
let LACAK = null;   // titik jalur pada jendela lacak yang sedang terbuka
const B = { kota: null, kategori: "", cari: "", filterPesanan: "", profil: null, produk: null };
const IKON = { padi: "🌾", beras: "🍚", gabah: "🌾", cabai: "🌶️", jagung: "🌽", bawang: "🧅", kopi: "☕", kakao: "🍫", tomat: "🍅", kedelai: "🫘", sawit: "🌴", kentang: "🥔", teh: "🍵", sayur: "🥬" };
const ikonOf = (k) => IKON[Object.keys(IKON).find((x) => String(k).toLowerCase().includes(x))] || "🌱";
const fotoProduk = (p, besar) => p.foto
  ? `<img src="${esc(p.foto)}" alt="${esc(p.nama_produk || p.komoditas)}" loading="lazy">`
  : `<div class="foto-kosong${besar ? " besar" : ""}"><span>${ikonOf(p.komoditas)}</span></div>`;
const judulP = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Dki /, "DKI ").replace(/^Di /, "DI ");

async function muatKota() {
  if (!B.kota) B.kota = (await fetch("../aset/data/kota.json").then((r) => r.json()));
  return B.kota;
}
// Isi <select> provinsi & kota yang saling terhubung
async function pasangPilihKota(selProv, selKota, prov, kotaId) {
  const d = await muatKota();
  const provs = [...new Set(d.kota.map((k) => k.provinsi))].sort();
  selProv.innerHTML = `<option value="">Pilih provinsi…</option>` + provs.map((p) => `<option value="${esc(p)}">${esc(judulP(p))}</option>`).join("");
  const isiKota = () => {
    const ks = d.kota.filter((k) => k.provinsi === selProv.value);
    selKota.innerHTML = `<option value="">Pilih kab/kota…</option>` + ks.map((k) => `<option value="${k.id}">${esc(k.nama)}</option>`).join("");
  };
  selProv.onchange = isiKota;
  selProv.value = prov || ""; isiKota(); selKota.value = kotaId || "";
}
const namaKota = (id) => B.kota?.kota.find((k) => k.id == id)?.nama || "";

// ---------------------------------------------------------------- Beranda belanja
function kartuProduk(p) {
  return `<article class="mp-kartu" data-produk="${p.panen_id}" tabindex="0">
    <div class="mp-foto">${fotoProduk(p)}${p.promo_aktif ? `<span class="mp-diskon">-${p.diskon_persen}%</span>` : ""}${p.unggulan ? '<span class="mp-unggul">Unggulan</span>' : ""}</div>
    <div class="mp-isi">
      <h3>${esc(p.nama_produk)}</h3>
      <p class="mp-harga">${rp(p.harga_per_kg)}<small>/kg</small></p>
      ${p.promo_aktif ? `<p class="mp-coret">${rp(p.harga_normal)}</p>` : ""}
      <p class="mp-lokasi">📍 ${esc(p.kota || "-")}${p.rating ? ` · <span class="ul-bintang">★</span> ${p.rating} (${p.jumlah_ulasan})` : ""}</p>
      <p class="mp-meta"><span class="mp-cek">✓</span> <a href="#" class="tk-link" data-buka-toko="${p.toko_id}">${esc(p.toko)}</a> · ${p.terjual_kg ? "terjual " + berat(p.terjual_kg) : "baru"}</p>
    </div></article>`;
}
function renderBeranda() {
  const q = B.cari.toLowerCase();
  const kat = [...new Set(katalogList.map((p) => p.komoditas))];
  $("#mp-kategori").innerHTML = [["", "Semua", "🛒"], ...kat.map((k) => [k, k, ikonOf(k)])].map(([v, l, i]) =>
    `<button class="mp-kat${B.kategori === v ? " aktif" : ""}" data-kat="${esc(v)}"><span>${i}</span>${esc(l)}</button>`).join("");
  const unggul = katalogList.filter((p) => p.unggulan || p.promo_aktif);
  const u = unggul[0];
  $("#mp-banner").innerHTML = u ? `<div class="mp-banner-teks"><p class="eyebrow">${u.promo_aktif ? "Promo panen" : "Produk unggulan"}</p>
      <h2>${esc(u.nama_produk)}</h2><p>${u.promo_aktif ? `Hemat ${u.diskon_persen}% · sekarang ${rp(u.harga_per_kg)}/kg` : `${rp(u.harga_per_kg)}/kg langsung dari ${esc(u.toko)}`}</p>
      <button class="btn besar terang" data-produk="${u.panen_id}">Lihat produk</button></div><div class="mp-banner-foto">${fotoProduk(u, true)}</div>`
    : `<div class="mp-banner-teks"><p class="eyebrow">TaniMart</p><h2>Hasil tani segar langsung dari petani</h2><p>Semua toko sudah diverifikasi admin.</p></div>`;
  $("#mp-unggulan").innerHTML = unggul.length ? unggul.map(kartuProduk).join("") : "";
  $("#mp-blok-unggulan").hidden = !unggul.length;
  const daftar = katalogList.filter((p) => (!B.kategori || p.komoditas === B.kategori) &&
    (!q || [p.nama_produk, p.komoditas, p.toko, p.kota, p.provinsi].join(" ").toLowerCase().includes(q)));
  $("#mp-judul-grid").textContent = B.kategori ? `Kategori ${B.kategori}` : q ? `Hasil pencarian "${B.cari}"` : "Semua produk";
  $("#mp-grid").innerHTML = daftar.map(kartuProduk).join("") || `<p class="empty">Produk tidak ditemukan.</p>`;
  muatSponsor();
}
$("#mp-cari").addEventListener("input", (e) => { B.cari = e.target.value.trim(); renderBeranda(); });

// ---------------------------------------------------------------- Detail produk + checkout
async function bukaProduk(pid) {
  const p = katalogList.find((x) => x.panen_id == pid);
  if (!p) return;
  B.produk = p;
  if (!B.profil) B.profil = (await api("GET", "/api/auth/profil")).data;
  const f = $("#form-checkout");
  f.reset(); f.satuan.value = "kg"; f.jumlah.value = 1;
  $("#ck-foto").innerHTML = fotoProduk(p, true);
  const semua = [p.foto, ...(p.galeri || [])].filter(Boolean);
  $("#ck-galeri").innerHTML = semua.length > 1 ? semua.map((g, i) => `<button type="button" class="${i ? "" : "aktif"}" data-galeri="${esc(g)}"><img src="${esc(g)}" alt="foto ${i + 1}"></button>`).join("") : "";
  $("#ck-nama").textContent = p.nama_produk;
  $("#ck-harga").innerHTML = `${rp(p.harga_per_kg)}<small>/kg</small>${p.promo_aktif ? ` <s>${rp(p.harga_normal)}</s> <span class="mp-diskon dalam">-${p.diskon_persen}%</span>` : ""}`;
  $("#ck-desk").textContent = p.deskripsi || `${p.komoditas} kualitas ${p.kualitas}, dipanen ${p.tanggal_panen}.`;
  $("#ck-info").innerHTML = `<span>Stok <b>${berat(p.sisa_kg)}</b></span><span>Kualitas <b>${esc(p.kualitas)}</b></span><span>Dipanen <b>${esc(p.tanggal_panen)}</b></span>`;
  $("#ck-toko").innerHTML = `<div class="ck-toko-ikon">${ikonOf(p.komoditas)}</div><div><b>${esc(p.toko)}</b> <span class="mp-cek">✓ Terverifikasi</span><br><small>📍 ${esc(p.kota)}, ${esc(judulP(p.provinsi))}</small></div><span class="tk-masuk"><button type="button" class="btn sm" data-mulai-chat="${p.penjual_id}" data-panen="${p.panen_id}">💬 Chat penjual</button><button type="button" class="btn sm" data-buka-toko="${p.toko_id}">Kunjungi toko</button></span>`;
  f.alamat_kirim.value = B.profil.alamat || "";
  f.no_hp_penerima.value = B.profil.no_hp || "";
  await pasangPilihKota(f.provinsi_tujuan, f.kota_tujuan_id, B.profil.provinsi, B.profil.kota_id);
  f.provinsi_tujuan.addEventListener("change", hitungCheckout);
  await siapkanVoucherCheckout(p);
  $("#dlg-produk").showModal();
  hitungCheckout();
  tampilUlasanProduk(p.panen_id);
}
let tundaOngkir;
function hitungCheckout() {
  clearTimeout(tundaOngkir);
  tundaOngkir = setTimeout(async () => {
    const f = $("#form-checkout"), p = B.produk;
    const kgBeli = keKg(f) || 0;
    const sub = kgBeli * p.harga_per_kg;
    $("#ck-sub").textContent = rp(sub);
    if (!f.provinsi_tujuan.value || !kgBeli) { $("#ck-ongkir").textContent = "pilih alamat"; $("#ck-total").textContent = rp(sub); return; }
    try {
      const d = await Estimasi.hitung(p.provinsi, f.provinsi_tujuan.value, kgBeli / 1000 + "", p.kota_id, f.kota_tujuan_id.value);
      $("#ck-ongkir").textContent = rp(d.total_biaya);
      $("#ck-kirim").innerHTML = `🚚 ${esc(d.moda)} · ${esc(d.kota_asal)} → ${esc(d.kota_tujuan)} · ± ${d.estimasi_hari_bulat} hari`;
      const pot = await potonganVoucher(sub, d.total_biaya);
      $("#ck-total").textContent = rp(sub + d.total_biaya - pot);
    } catch (e) { $("#ck-ongkir").textContent = "-"; $("#ck-kirim").textContent = e.message; }
  }, 250);
}
["input", "change"].forEach((ev) => $("#form-checkout").addEventListener(ev, (e) => { if (e.target.name !== "metode_bayar") hitungCheckout(); }));
$("#form-checkout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, p = B.produk;
  const body = { panen_id: p.panen_id, jumlah_kg: keKg(f), metode_bayar: f.metode_bayar.value, provinsi_tujuan: f.provinsi_tujuan.value,
    kota_tujuan_id: Number(f.kota_tujuan_id.value) || null, alamat_kirim: f.alamat_kirim.value, no_hp_penerima: f.no_hp_penerima.value,
    voucher_kode: B.voucher || undefined };
  if (!body.kota_tujuan_id) return toast("Pilih kab/kota tujuan", true);
  try {
    const r = await api("POST", "/api/penjualan", body);
    if (f.simpan_alamat.checked)
      api("PUT", "/api/auth/profil", { provinsi: body.provinsi_tujuan, kota_id: body.kota_tujuan_id, kota: namaKota(body.kota_tujuan_id), alamat: body.alamat_kirim, no_hp: body.no_hp_penerima || undefined })
        .then((x) => (B.profil = x.data)).catch(() => {});
    $("#dlg-produk").close();
    toast(r.message);
    await refresh();
    bukaPembayaran(r.data.id);
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- Pembayaran (simulasi semua metode)
let timerBayar2;
async function bukaPembayaran(id, metode) {
  try {
    const d = (await api("GET", `/api/penjualan/${id}/pembayaran${metode ? "?metode=" + encodeURIComponent(metode) : ""}`)).data;
    $("#by-metode").innerHTML = ["QRIS", "GoPay", "DANA", "Transfer Bank"].map((m) =>
      `<button type="button" class="by-tab${m === d.metode ? " aktif" : ""}" data-ganti-metode="${m}" data-id="${id}"><i class="logo-${m.split(" ")[0].toLowerCase()}"></i>${m}</button>`).join("");
    $("#by-total").textContent = rp(d.total);
    $("#by-kode").textContent = d.kode_bayar;
    $("#by-isi").innerHTML = d.virtual_account
      ? `<div class="by-va">${d.virtual_account.map((v) => `<div><span>${esc(v.bank)}</span><b>${esc(v.nomor)}</b><button type="button" class="btn sm" data-salin="${esc(v.nomor)}">Salin</button></div>`).join("")}</div>`
      : `<div class="qr">${d.qr_svg}</div>${d.metode !== "QRIS" ? `<p class="by-nomor">atau kirim ke <b>0811-0000-2026</b> (TaniMart, simulasi)</p>` : ""}`;
    $("#by-langkah").innerHTML = d.langkah.map((l) => `<li>${esc(l)}</li>`).join("");
    $("#by-sudah").dataset.id = id;
    let sisa = d.berlaku_menit * 60;
    clearInterval(timerBayar2);
    const tick = () => { $("#by-timer").textContent = `${String(Math.floor(sisa / 60)).padStart(2, "0")}:${String(sisa % 60).padStart(2, "0")}`; if (sisa-- <= 0) clearInterval(timerBayar2); };
    tick(); timerBayar2 = setInterval(tick, 1000);
    if (!$("#dlg-pembayaran").open) $("#dlg-pembayaran").showModal();
  } catch (err) { toast(err.message, true); }
}
$("#dlg-pembayaran").addEventListener("close", () => clearInterval(timerBayar2));
$("#by-sudah").addEventListener("click", async (e) => {
  try { toast((await api("POST", `/api/penjualan/${e.target.dataset.id}/sudah-bayar`)).message); $("#dlg-pembayaran").close(); refresh(); }
  catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- Pesanan saya + lacak
const FILTER_P = [["", "Semua"], ["Menunggu Bayar", "Belum bayar"], ["Dibayar", "Dibayar"], ["Diproses", "Dikemas"], ["Dikirim", "Dikirim"], ["Selesai", "Selesai"], ["Dibatalkan", "Dibatalkan"]];
function renderPesanan() {
  $("#ps-filter").innerHTML = FILTER_P.map(([v, l]) => {
    const n = v ? jualList.filter((j) => j.status_pesanan === v).length : jualList.length;
    return `<button class="chip${B.filterPesanan === v ? " aktif" : ""}" data-fp="${v}">${l}${n ? ` <b>${n}</b>` : ""}</button>`;
  }).join("");
  const rows = jualList.filter((j) => !B.filterPesanan || j.status_pesanan === B.filterPesanan);
  $("#ps-daftar").innerHTML = rows.map((j) => {
    const p = panenList.find((x) => x.id == j.panen_id) || {};
    const k = katalogList.find((x) => x.panen_id == j.panen_id);
    if (ulasanSaya === null) { ulasanSaya = {}; muatUlasanSaya(); }
    return `<article class="ps-kartu">
      <header><b>${esc(k?.toko || "Toko #" + j.penjual_id)}</b><span>#${j.id} · ${esc(j.tanggal_jual)}</span>${badgePesanan(j.status_pesanan)}</header>
      <div class="ps-isi"><div class="ps-foto">${fotoProduk({ foto: k?.foto || p.foto, komoditas: p.komoditas || "", nama_produk: k?.nama_produk })}</div>
        <div><h3>${esc(k?.nama_produk || p.nama_produk || p.komoditas || "Produk")}</h3><p>${berat(j.jumlah_kg)} × ${rp(j.harga_jual_per_kg)}/kg</p>
        ${j.no_resi ? `<p class="ps-resi">Resi <b>${esc(j.no_resi)}</b> · ${esc(j.jasa_kirim || "")}</p>` : ""}
        ${j.kota_tujuan ? `<p class="ps-kirim">🚚 ${esc(j.moda_kirim || "")} · ${esc(j.kota_asal || "")} → ${esc(j.kota_tujuan)} · ± ${Math.ceil(j.estimasi_hari || 1)} hari</p>` : ""}
        ${jejak(j.status_pesanan)}</div>
        <div class="ps-total"><small>Total bayar${j.metode_bayar ? " · " + esc(j.metode_bayar) : ""}</small><b>${rp(j.total_bayar ?? j.total_harga)}</b>${j.ongkir ? `<small>termasuk ongkir ${rp(j.ongkir)}</small>` : ""}${j.potongan ? `<small class="v-hemat">voucher ${esc(j.voucher_kode)} −${rp(j.potongan)}</small>` : ""}</div></div>
      <footer>${j.status_pesanan === "Menunggu Bayar" && j.status_bayar === "Belum Lunas" ? `<button class="btn primary sm" data-bayar2="${j.id}">Bayar sekarang</button>` : ""}
        ${j.status_bayar === "Menunggu Konfirmasi" ? '<span class="tag">menunggu konfirmasi penjual</span>' : ""}
        ${j.jalur ? `<button class="btn sm" data-lacak="${j.id}">Lacak pengiriman</button>` : ""}
        ${j.status_pesanan === "Dikirim" ? `<button class="btn primary sm" data-status="Selesai" data-id="${j.id}">Pesanan diterima</button>` : ""}
        ${j.status_pesanan === "Selesai" ? `<button class="btn sm ul-tombol" data-ulas="${j.id}">${ulasanSaya?.[j.id] ? bintang(ulasanSaya[j.id].rating) + " Ubah ulasan" : "★ Beri ulasan"}</button>` : ""}
        ${["Menunggu Bayar", "Dibayar"].includes(j.status_pesanan) ? `<button class="btn sm danger" data-batal="${j.id}">Batalkan</button>` : ["Diproses", "Dikirim"].includes(j.status_pesanan) ? '<span class="tag">tidak bisa dibatalkan</span>' : ""}</footer>
    </article>`;
  }).join("") || `<p class="empty">Belum ada pesanan di sini. <a href="#" data-tab-ke="beranda">Mulai belanja</a></p>`;
}
async function bukaLacak(id) {
  const j = jualList.find((x) => x.id == id);
  if (!j?.jalur) return;
  await muatGeo();
  const svg = $("#lacak-peta");
  const pts = j.jalur;
  // perbesar peta ke area rute (dengan ruang tepi), minimal selebar 260 satuan peta
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const lebar = Math.max(260, Math.max(...xs) - Math.min(...xs) + 120), tinggi = Math.max(lebar * 0.55, Math.max(...ys) - Math.min(...ys) + 80);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  svg.setAttribute("viewBox", `${cx - lebar / 2} ${cy - tinggi / 2} ${lebar} ${tinggi}`);
  const tahap = LANGKAH.indexOf(j.status_pesanan);
  // posisi paket: di asal (belum kirim), di tengah jalur (dikirim), di tujuan (selesai)
  const posisi = j.status_pesanan === "Selesai" ? pts.length - 1 : j.status_pesanan === "Dikirim" ? Math.floor((pts.length - 1) / 2) : 0;
  const pk = j.status_pesanan === "Dikirim" && pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[posisi];
  svg.innerHTML = Object.values(geo.prov).map((p) => `<path d="${p.d}" class="lc-prov"/>`).join("")
    + `<polyline points="${pts.map((p) => p.x + "," + p.y).join(" ")}" class="lc-garis"/>`
    + pts.map((p) => {
      // ukuran label & titik mengikuti skala peta; label di sisi kanan peta ditaruh di kiri titik supaya tidak terpotong
      const kanan = p.x > cx + lebar * 0.2;
      return `<circle cx="${p.x}" cy="${p.y}" r="${(p.jenis === "pelabuhan" ? lebar / 140 : lebar / 95).toFixed(2)}" class="lc-${p.jenis}"><title>${esc(p.nama)}</title></circle>
       <text x="${p.x + (kanan ? -1 : 1) * lebar / 70}" y="${p.y - lebar / 70}" class="lc-label" text-anchor="${kanan ? "end" : "start"}" style="font-size:${(lebar / 48).toFixed(1)}px">${esc(p.nama)}</text>`;
    }).join("")
    + (j.status_pesanan === "Dibatalkan" ? "" : `<text id="lc-paket" x="${pk.x}" y="${pk.y + lebar / 60}" class="lc-paket" text-anchor="middle" style="font-size:${(lebar / 22).toFixed(1)}px">📦</text>`);
  LACAK = { pts, lebar };
  $("#lacak-judul").textContent = `Lacak pesanan #${j.id}`;
  $("#lacak-info").innerHTML = `<b>${esc(j.moda_kirim || "")}</b> · ${esc(j.kota_asal)} → ${esc(j.kota_tujuan)} · perkiraan ${Math.ceil(j.estimasi_hari || 1)} hari<br><small>Alamat: ${esc(j.alamat_kirim || "-")}</small>`;
  $("#lacak-waktu").innerHTML = LANGKAH.map((l, i) => `<li class="${i <= tahap ? "on" : ""}"><b>${l}</b><span>${
    { "Menunggu Bayar": "Pesanan dibuat", Dibayar: "Pembayaran diterima penjual", Diproses: "Penjual mengemas barang", Dikirim: `Dalam perjalanan (${esc(j.moda_kirim || "kurir")})`, Selesai: "Barang diterima pembeli" }[l]}</span></li>`).join("")
    + (j.status_pesanan === "Dibatalkan" ? `<li class="batal"><b>Dibatalkan</b><span>Pesanan dibatalkan sebelum diproses</span></li>` : "");
  $("#lacak-resi").innerHTML = ""; $("#lacak-riwayat").innerHTML = "";
  $("#dlg-lacak").showModal();
  isiRiwayatLacak(j);
}

// ---------------------------------------------------------------- Akun saya
async function renderAkun() {
  B.profil = (await api("GET", "/api/auth/profil")).data;
  const u = B.profil, f = $("#form-profil");
  ["nama", "email", "no_hp", "alamat"].forEach((k) => (f[k].value = u[k] || ""));
  await pasangPilihKota(f.provinsi, f.kota_id, u.provinsi, u.kota_id);
  $("#akun-kartu").innerHTML = `<div class="akun-avatar">${esc((u.nama || "?").trim()[0].toUpperCase())}</div>
    <div><h3>${esc(u.nama)}</h3><p>${esc(u.email || u.username)}</p><span class="role ${u.role}">${LABEL_ROLE[u.role]}</span></div>
    <dl><dt>Alamat kirim</dt><dd>${u.alamat ? `${esc(u.alamat)}, ${esc(u.kota || "")}, ${esc(judulP(u.provinsi))}` : "<i>belum diisi</i>"}</dd><dt>No. HP</dt><dd>${esc(u.no_hp || "-")}</dd>
    <dt>Bergabung</dt><dd>${esc(String(u.created_at).slice(0, 10))}</dd></dl>`;
}
$("#form-profil").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  b.kota = namaKota(b.kota_id);
  try { toast((await api("PUT", "/api/auth/profil", b)).message); sesi.user.nama = b.nama; store.set(sesi); $("#user-nama").textContent = b.nama; renderAkun(); }
  catch (err) { toast(err.message, true); }
});
$("#form-sandi").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target));
  if (b.baru !== b.ulang) return toast("Ulangi password baru dengan benar", true);
  try { toast((await api("POST", "/api/auth/password", b)).message); e.target.reset(); } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- Notifikasi
async function muatNotif() {
  if (!sesi) return;
  try {
    const d = (await api("GET", "/api/auth/notifikasi")).data;
    $("#notif-jml").textContent = d.belum_dibaca > 9 ? "9+" : d.belum_dibaca;
    $("#notif-jml").hidden = !d.belum_dibaca;
    $("#notif-daftar").innerHTML = d.daftar.map((n) => `<li class="${n.dibaca ? "" : "baru"}" data-tautan="${esc(n.tautan || "")}"><b>${esc(n.judul)}</b><span>${esc(n.isi)}</span><small>${esc(n.created_at)}</small></li>`).join("")
      || `<li class="kosong">Belum ada notifikasi</li>`;
  } catch { /* abaikan */ }
}
$("#notif-btn").addEventListener("click", async (e) => {
  e.stopPropagation();
  const p = $("#notif-panel");
  p.hidden = !p.hidden;
  if (!p.hidden && !$("#notif-jml").hidden) { await api("POST", "/api/auth/notifikasi/baca").catch(() => {}); $("#notif-jml").hidden = true; }
});
document.addEventListener("click", (e) => { if (!e.target.closest("#notif-panel")) $("#notif-panel").hidden = true; });
$("#notif-daftar").addEventListener("click", (e) => {
  const t = e.target.closest("li")?.dataset.tautan;
  if (t === "chat") { $("#notif-panel").hidden = true; return bukaChat(); }
  const ke = { pesanan: role() === "pembeli" ? "pesanan" : "penjualan", toko: "toko", akun: "akun" }[t];
  if (ke && MENU[role()].some(([k]) => k === ke)) { bukaTab(ke); $("#notif-panel").hidden = true; }
});
setInterval(muatNotif, 30000);

// ---------------------------------------------------------------- Lupa password (kode simulasi)
$("#lupa-link").addEventListener("click", (e) => { e.preventDefault(); $("#form-lupa").reset(); $("#form-reset").hidden = true; $("#lupa-kotak").hidden = true; $("#dlg-lupa").showModal(); });
$("#form-lupa").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const d = (await api("POST", "/api/auth/lupa", { email: e.target.email.value })).data;
    $("#lupa-kotak").hidden = false;
    $("#lupa-kotak").innerHTML = `<p class="lk-atas">📧 Kotak masuk <b>${esc(d.email)}</b> <span class="sim">SIMULASI</span></p>
      <p>Kode reset password TaniMart Anda: <b class="lk-kode">${esc(d.kode)}</b><br><small>Berlaku ${d.berlaku_menit} menit. Jangan berikan kode ini ke siapa pun.</small></p>`;
    const r = $("#form-reset"); r.hidden = false; r.email.value = d.email; r.kode.focus();
  } catch (err) { toast(err.message, true); }
});
$("#form-reset").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const b = Object.fromEntries(new FormData(e.target));
    toast((await api("POST", "/api/auth/reset", b)).message);
    $("#dlg-lupa").close();
    $("#form-login").username.value = b.email;
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- Klik umum
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-produk],[data-kat],[data-fp],[data-bayar2],[data-lacak],[data-ganti-metode],[data-salin]");
  if (!t) return;
  if (t.dataset.produk) return bukaProduk(t.dataset.produk);
  if (t.dataset.kat !== undefined) { B.kategori = t.dataset.kat; return renderBeranda(); }
  if (t.dataset.fp !== undefined) { B.filterPesanan = t.dataset.fp; return renderPesanan(); }
  if (t.dataset.bayar2) return bukaPembayaran(t.dataset.bayar2);
  if (t.dataset.lacak) return bukaLacak(t.dataset.lacak);
  if (t.dataset.gantiMetode) return bukaPembayaran(t.dataset.id, t.dataset.gantiMetode);
  if (t.dataset.salin) { navigator.clipboard?.writeText(t.dataset.salin).then(() => toast("Nomor VA disalin")).catch(() => {}); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset?.produk) bukaProduk(e.target.dataset.produk); });

// Galeri: klik thumbnail untuk mengganti foto besar
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-galeri]");
  if (!g) return;
  $("#ck-foto").innerHTML = `<img src="${esc(g.dataset.galeri)}" alt="foto produk">`;
  document.querySelectorAll("#ck-galeri button").forEach((b) => b.classList.toggle("aktif", b === g));
});
