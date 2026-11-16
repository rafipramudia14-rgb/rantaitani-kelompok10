// Frontend RantaiTani: memanggil API gateway dengan token JWT
// /api/auth -> Express, /api/lahan -> Flask, /api/panen -> Express, /api/penjualan -> Flask
const $ = (s) => document.querySelector(s);
const rp = (n) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });
const kg = (n) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });
// Satuan berat: semua disimpan dalam kg di database, ditampilkan & diinput dalam satuan pilihan
const SATUAN = { g: 0.001, ons: 0.1, kg: 1, kuintal: 100, ton: 1000 };
const berat = (n) => {
  n = Number(n);
  if (n > 0 && n < 1) return Math.round(n * 1000).toLocaleString("id-ID") + " g";
  if (n >= 1000) return kg(n / 1000) + " ton";
  return kg(n) + " kg";
};
const keKg = (f) => Math.round(Number(f.jumlah.value) * SATUAN[f.satuan.value] * 1000) / 1000;
function isiJumlah(f, nilaiKg) {
  const n = Number(nilaiKg);
  const s = n > 0 && n < 1 ? "g" : n >= 1000 && Number.isInteger(n / 1000) ? "ton" : "kg";
  f.satuan.value = s;
  f.jumlah.value = Math.round((n / SATUAN[s]) * 1000) / 1000;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hariIni = () => new Date().toISOString().slice(0, 10);

// ---------------- Sesi
const store = {
  get() { try { return JSON.parse(localStorage.getItem("rantaitani") || "null"); } catch { return null; } },
  set(v) { try { localStorage.setItem("rantaitani", JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem("rantaitani"); } catch {} },
};
let sesi = store.get();
let lahanList = [], panenList = [], jualList = [], katalogList = [], userList = [], penjualList = [];

const MENU = {
  admin: [["ringkasan", "Ringkasan"], ["lahan", "Data Lahan"], ["panen", "Hasil Panen"], ["penjualan", "Penjualan"], ["pengguna", "Pengguna"]],
  penjual: [["ringkasan", "Ringkasan"], ["lahan", "Lahan Saya"], ["panen", "Panen Saya"], ["penjualan", "Penjualan Saya"]],
  pembeli: [["katalog", "Katalog Hasil Tani"], ["pembelian", "Pembelian Saya"]],
};
const LABEL_ROLE = { admin: "Admin", penjual: "Penjual", pembeli: "Pembeli" };
const role = () => sesi?.user.role;

async function api(method, url, body) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (sesi?.token) headers.Authorization = "Bearer " + sesi.token;
  const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ message: "Layanan tidak merespons" }));
  if (r.status === 401 && sesi && !url.startsWith("/api/auth/login")) { keluar("Sesi berakhir, silakan login lagi"); throw new Error(j.message); }
  if (!r.ok) throw new Error(j.message || "Terjadi kesalahan");
  return j;
}

function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " error" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ""), 2800);
}

// ---------------- Login / daftar / keluar
function modeLogin(daftar) {
  const judul = $("#judul-login");
  judul.style.transform = "translateY(-120%)"; judul.style.opacity = 0;
  setTimeout(() => {
    $("#form-login").hidden = daftar;
    $("#form-daftar").hidden = !daftar;
    judul.textContent = daftar ? "Daftar" : "Masuk";
    $("#tanya").textContent = daftar ? "Sudah punya akun?" : "Belum punya akun?";
    $("#ganti").textContent = daftar ? "Masuk" : "Daftar";
    judul.style.transition = "none"; judul.style.transform = "translateY(120%)";
    requestAnimationFrame(() => { judul.style.transition = ""; judul.style.transform = ""; judul.style.opacity = 1; });
  }, 220);
}
$("#ganti").addEventListener("click", (e) => { e.preventDefault(); modeLogin($("#form-daftar").hidden); });
document.querySelectorAll(".lihat").forEach((b) => b.addEventListener("click", () => {
  const i = b.closest(".isian").querySelector("input");
  i.type = i.type === "password" ? "text" : "password";
}));

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await api("POST", "/api/auth/login", Object.fromEntries(new FormData(e.target)));
    sesi = { token: r.data.token, user: r.data.user };
    store.set(sesi);
    e.target.reset();
    masuk();
    toast(`Selamat datang, ${sesi.user.nama}`);
  } catch (err) { toast(err.message, true); }
});

$("#form-daftar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const r = await api("POST", "/api/auth/register", body);
    toast(r.message);
    e.target.reset();
    modeLogin(false);
    $("#form-login").username.value = body.username;
    setTimeout(() => $("#form-login").password.focus(), 300);
  } catch (err) { toast(err.message, true); }
});

function keluar(pesan) {
  sesi = null;
  store.clear();
  // bersihkan data sesi sebelumnya agar tidak terlihat oleh pengguna berikutnya
  lahanList = []; panenList = []; jualList = []; katalogList = []; userList = []; penjualList = [];
  ["#tbl-lahan", "#tbl-panen", "#tbl-jual", "#tbl-beli", "#tbl-user", "#katalog", "#recent", "#status-lahan"].forEach((s) => ($(s).innerHTML = ""));
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  if (typeof chatReset === "function") chatReset();
  $("#app").hidden = true;
  $("#login-screen").hidden = false;
  $("#login-screen video")?.play?.().catch(() => {});
  if (pesan) toast(pesan, true);
}
$("#logout").addEventListener("click", () => keluar());

function masuk() {
  $("#login-screen").hidden = true;
  $("#login-screen video")?.pause?.();
  chatReset();
  $("#app").hidden = false;
  $("#user-nama").textContent = sesi.user.nama;
  $("#user-role").textContent = LABEL_ROLE[role()];
  $("#user-role").className = "role " + role();
  $("#status").hidden = role() !== "admin";
  $("#subjudul").textContent = { admin: "Panel admin: semua data & pengguna", penjual: "Kelola lahan, panen, dan penjualan Anda", pembeli: "Beli hasil tani langsung dari petani" }[role()];
  document.querySelectorAll(".admin-only").forEach((el) => (el.hidden = role() !== "admin"));
  $("#tabs").innerHTML = MENU[role()].map(([id, label], i) => `<button class="tab${i ? "" : " active"}" data-tab="${id}">${label}</button>`).join("");
  bukaTab(MENU[role()][0][0]);
  refresh();
}

function bukaTab(id) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === id));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + id));
}
$("#tabs").addEventListener("click", (e) => { if (e.target.dataset.tab) bukaTab(e.target.dataset.tab); });

// ---------------- Status layanan (admin)
async function cekStatus() {
  if (role() !== "admin") return;
  for (const svc of ["auth", "lahan", "panen", "penjualan", "bantuan"]) {
    const el = document.querySelector(`.pill[data-svc="${svc}"]`);
    try { await api("GET", `/api/${svc}/health`); el.className = "pill up"; }
    catch { el.className = "pill down"; }
  }
}

// ---------------- Helper data
const terjualKg = (pid, kecuali) => jualList.filter((j) => j.panen_id == pid && j.id != kecuali).reduce((a, j) => a + j.jumlah_kg, 0);
const sisaKg = (p, kecuali) => p.jumlah_kg - terjualKg(p.id, kecuali);
const lahanById = (id) => lahanList.find((l) => l.id == id);
const namaLahan = (id) => lahanById(id)?.nama_lahan || `Lahan #${id}`;
const labelPanen = (id) => {
  const p = panenList.find((x) => x.id == id);
  return p ? `${p.komoditas} · ${p.tanggal_panen} · ${namaLahan(p.lahan_id)}` : `Panen #${id} (dihapus)`;
};
const aksi = (jenis, id) => `<button class="btn sm" data-edit="${jenis}" data-id="${id}">Ubah</button><button class="btn sm danger" data-del="${jenis}" data-id="${id}">Hapus</button>`;

// ---------------- Lahan
function renderLahan() {
  const q = $("#cari-lahan").value.trim().toLowerCase();
  const rows = q ? lahanList.filter((l) => [l.nama_lahan, l.pemilik, l.komoditas].join(" ").toLowerCase().includes(q)) : lahanList;
  $("#tbl-lahan").innerHTML = rows.length ? rows.map((l) => `
    <tr><td>${l.id}</td><td><b>${esc(l.nama_lahan)}</b></td><td>${esc(l.pemilik)}</td><td>${esc(l.lokasi)}</td>
    <td class="num">${kg(l.luas_ha)}</td><td>${esc(l.jenis_tanah || "-")}</td><td>${esc(l.komoditas)}</td>
    <td><span class="badge ${esc(l.status.split(" ")[0])}">${esc(l.status)}</span></td><td>${aksi("lahan", l.id)}</td></tr>`).join("")
    : `<tr><td colspan="9" class="empty">Belum ada data lahan</td></tr>`;
  const opts = lahanList.map((l) => `<option value="${l.id}">${esc(l.nama_lahan)} (${esc(l.komoditas)})</option>`).join("");
  const f = $("#filter-lahan"), cur = f.value;
  f.innerHTML = `<option value="">Semua lahan</option>` + opts;
  f.value = cur;
  $("#form-panen").lahan_id.innerHTML = opts;
}

function bukaLahan(l) {
  const f = $("#form-lahan");
  f.reset();
  $("#judul-lahan").textContent = l ? "Ubah Lahan" : "Tambah Lahan";
  f.id.value = l?.id || "";
  f.pemilik_id.innerHTML = penjualList.map((u) => `<option value="${u.id}">${esc(u.nama)}</option>`).join("");
  f.pemilik_id.required = role() === "admin";
  if (l) ["nama_lahan", "lokasi", "luas_ha", "jenis_tanah", "komoditas", "status", "pemilik_id"].forEach((k) => (f[k].value = l[k] ?? ""));
  $("#dlg-lahan").showModal();
}

$("#form-lahan").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const id = body.id; delete body.id;
  body.luas_ha = Number(body.luas_ha);
  if (role() === "admin") {
    body.pemilik_id = Number(body.pemilik_id);
    body.pemilik = penjualList.find((u) => u.id === body.pemilik_id)?.nama;
  } else delete body.pemilik_id;
  await simpan(id ? "PUT" : "POST", "/api/lahan" + (id ? "/" + id : ""), body, "#dlg-lahan");
});

// ---------------- Panen
function renderPanen() {
  const fl = $("#filter-lahan").value;
  const rows = fl ? panenList.filter((p) => p.lahan_id == fl) : panenList;
  $("#tbl-panen").innerHTML = rows.length ? rows.map((p) => `
    <tr><td>${p.id}</td><td>${esc(p.tanggal_panen)}</td><td>${esc(namaLahan(p.lahan_id))}</td><td>${esc(p.komoditas)}</td>
    <td class="num">${berat(p.jumlah_kg)}</td><td class="num">${berat(sisaKg(p))}</td><td>${esc(p.kualitas)}</td><td class="num">${rp(p.harga_per_kg)}</td>
    <td class="num"><b>${rp(p.total_nilai)}</b></td><td>${esc(p.catatan || "-")}</td><td>${aksi("panen", p.id)}</td></tr>`).join("")
    : `<tr><td colspan="11" class="empty">Belum ada data panen</td></tr>`;
}

function bukaPanen(p) {
  if (!lahanList.length) return toast("Tambahkan data lahan terlebih dahulu", true);
  const f = $("#form-panen");
  f.reset();
  $("#judul-panen").textContent = p ? "Ubah Data Panen" : "Catat Panen";
  f.id.value = p?.id || "";
  if (p) { ["lahan_id", "tanggal_panen", "komoditas", "kualitas", "harga_per_kg", "catatan"].forEach((k) => (f[k].value = p[k] ?? "")); isiJumlah(f, p.jumlah_kg); }
  else { f.tanggal_panen.value = hariIni(); f.komoditas.value = lahanList[0].komoditas; }
  $("#dlg-panen").showModal();
}
$("#form-panen").lahan_id.addEventListener("change", (e) => {
  const l = lahanById(e.target.value);
  if (l && !$("#form-panen").id.value) $("#form-panen").komoditas.value = l.komoditas;
});
$("#form-panen").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const id = body.id; delete body.id;
  body.jumlah_kg = keKg(e.target); delete body.jumlah; delete body.satuan;
  ["lahan_id", "harga_per_kg"].forEach((k) => (body[k] = Number(body[k])));
  await simpan(id ? "PUT" : "POST", "/api/panen" + (id ? "/" + id : ""), body, "#dlg-panen");
});

// ---------------- Penjualan (admin & penjual)
function renderPenjualan() {
  const fb = $("#filter-bayar").value;
  const rows = fb ? jualList.filter((j) => j.status_bayar === fb) : jualList;
  $("#tbl-jual").innerHTML = rows.length ? rows.map((j) => `
    <tr><td>${j.id}</td><td>${esc(j.tanggal_jual)}</td><td>${esc(labelPanen(j.panen_id))}</td><td><b>${esc(j.pembeli)}</b>${j.pembeli_id ? ' <span class="tag">akun</span>' : ""}</td><td>${esc(j.jenis_pembeli)}</td>
    <td class="num">${berat(j.jumlah_kg)}</td><td class="num">${rp(j.harga_jual_per_kg)}</td><td class="num"><b>${rp(j.total_harga)}</b></td>
    <td><span class="badge ${esc(j.status_bayar.split(" ")[0])}">${esc(j.status_bayar)}</span></td><td>${j.status_bayar === "Menunggu Konfirmasi" ? `<button class="btn sm primary" data-lunas="${j.id}" title="Konfirmasi pembayaran diterima">Lunaskan</button>` : ""}${aksi("penjualan", j.id)}</td></tr>`).join("")
    : `<tr><td colspan="10" class="empty">Belum ada data penjualan</td></tr>`;
  $("#form-jual").panen_id.innerHTML = panenList.map((p) => `<option value="${p.id}">${esc(labelPanen(p.id))}</option>`).join("");
}
function infoStok() {
  const f = $("#form-jual");
  const p = panenList.find((x) => x.id == f.panen_id.value);
  $("#info-stok").textContent = p ? `Sisa stok: ${berat(sisaKg(p, f.id.value))} dari ${berat(p.jumlah_kg)} · harga panen ${rp(p.harga_per_kg)}/kg` : "";
}
function bukaJual(j) {
  if (!panenList.length) return toast("Catat hasil panen terlebih dahulu", true);
  const f = $("#form-jual");
  f.reset();
  $("#judul-jual").textContent = j ? "Ubah Penjualan" : "Catat Penjualan";
  f.id.value = j?.id || "";
  if (j) { ["panen_id", "pembeli", "jenis_pembeli", "harga_jual_per_kg", "tanggal_jual", "status_bayar"].forEach((k) => (f[k].value = j[k] ?? "")); isiJumlah(f, j.jumlah_kg); }
  else f.tanggal_jual.value = hariIni();
  infoStok();
  $("#dlg-jual").showModal();
}
$("#form-jual").panen_id.addEventListener("change", infoStok);
$("#form-jual").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const id = body.id; delete body.id;
  body.jumlah_kg = keKg(e.target); delete body.jumlah; delete body.satuan;
  ["panen_id", "harga_jual_per_kg"].forEach((k) => (body[k] = Number(body[k])));
  await simpan(id ? "PUT" : "POST", "/api/penjualan" + (id ? "/" + id : ""), body, "#dlg-jual");
});

// ---------------- Katalog & pembelian (pembeli)
function renderKatalog() {
  const q = $("#cari-katalog").value.trim().toLowerCase();
  const items = katalogList.map((k) => ({ ...k, lahan: lahanById(k.lahan_id) }))
    .filter((k) => !q || [k.komoditas, k.lahan?.lokasi, k.lahan?.pemilik].join(" ").toLowerCase().includes(q));
  $("#katalog").innerHTML = items.length ? items.map((k) => `
    <article class="produk">
      <div class="produk-top"><h3>${esc(k.komoditas)}</h3><span class="badge">Kualitas ${esc(k.kualitas)}</span></div>
      <p class="harga">${rp(k.harga_per_kg)}<small>/kg</small></p>
      <p class="harga-kecil">${rp(k.harga_per_kg / 10)}/ons · ${rp(k.harga_per_kg / 1000)}/gram</p>
      <dl>
        <dt>Petani</dt><dd>${esc(k.lahan?.pemilik || "-")}</dd>
        <dt>Asal</dt><dd>${esc(k.lahan?.lokasi || "-")}</dd>
        <dt>Dipanen</dt><dd>${esc(k.tanggal_panen)}</dd>
        <dt>Stok</dt><dd><b>${berat(k.sisa_kg)}</b></dd>
      </dl>
      <button class="btn primary block" data-beli="${k.panen_id}">Beli</button>
    </article>`).join("") : `<p class="empty">Belum ada hasil panen yang tersedia</p>`;
}
function renderPembelian() {
  $("#b-jumlah").textContent = jualList.length;
  $("#b-kg").textContent = berat(jualList.reduce((a, j) => a + j.jumlah_kg, 0));
  $("#b-lunas").textContent = rp(jualList.filter((j) => j.status_bayar === "Lunas").reduce((a, j) => a + j.total_harga, 0));
  $("#b-belum").textContent = rp(jualList.filter((j) => j.status_bayar !== "Lunas").reduce((a, j) => a + j.total_harga, 0));
  $("#tbl-beli").innerHTML = jualList.length ? jualList.map((j) => {
    const p = panenList.find((x) => x.id == j.panen_id);
    return `<tr><td>${j.id}</td><td>${esc(j.tanggal_jual)}</td><td>${esc(p?.komoditas || "Panen #" + j.panen_id)}</td><td>${esc(lahanById(p?.lahan_id)?.pemilik || "-")}</td>
      <td class="num">${berat(j.jumlah_kg)}</td><td class="num">${rp(j.harga_jual_per_kg)}</td><td class="num"><b>${rp(j.total_harga)}</b></td>
      <td><span class="badge ${esc(j.status_bayar.split(" ")[0])}">${esc(j.status_bayar)}</span></td>
      <td>${j.status_bayar === "Belum Lunas" ? `<button class="btn sm primary" data-bayar="${j.id}">Bayar QRIS</button><button class="btn sm danger" data-del="pembelian" data-id="${j.id}">Batalkan</button>`
        : j.status_bayar === "Menunggu Konfirmasi" ? '<span class="tag">menunggu penjual</span>' : ""}</td></tr>`;
  }).join("") : `<tr><td colspan="9" class="empty">Anda belum pernah membeli. Lihat tab Katalog.</td></tr>`;
}
function bukaBeli(pid) {
  const k = katalogList.find((x) => x.panen_id == pid);
  const f = $("#form-beli");
  f.reset();
  f.panen_id.value = pid;
  f.satuan.value = "kg";
  $("#beli-nama").textContent = k.komoditas;
  $("#beli-info").textContent = `${rp(k.harga_per_kg)}/kg · stok ${berat(k.sisa_kg)} · dari ${lahanById(k.lahan_id)?.pemilik || "petani"}`;
  $("#beli-total").textContent = rp(0);
  f._harga = k.harga_per_kg;
  $("#dlg-beli").showModal();
}
function hitungBeli() {
  const f = $("#form-beli");
  const nkg = keKg(f) || 0;
  $("#beli-total").textContent = rp(nkg * f._harga) + (nkg ? `  (${berat(nkg)})` : "");
}
$("#form-beli").jumlah.addEventListener("input", hitungBeli);
$("#form-beli").satuan.addEventListener("change", hitungBeli);
$("#form-beli").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  await simpan("POST", "/api/penjualan", { panen_id: Number(f.panen_id.value), jumlah_kg: keKg(f) }, "#dlg-beli");
});

// ---------------- Pembayaran QRIS (simulasi)
let timerBayar;
async function bukaBayar(id) {
  try {
    const d = (await api("GET", `/api/penjualan/${id}/qris`)).data;
    $("#bayar-merchant").textContent = d.merchant;
    $("#bayar-qr").innerHTML = d.qr_svg;          // SVG dibuat server (layanan-penjualan)
    $("#bayar-total").textContent = rp(d.total);
    $("#bayar-kode").textContent = d.kode_bayar;
    $("#bayar-sudah").dataset.id = id;
    let sisa = d.berlaku_menit * 60;
    clearInterval(timerBayar);
    const tick = () => {
      $("#bayar-timer").textContent = `${String(Math.floor(sisa / 60)).padStart(2, "0")}:${String(sisa % 60).padStart(2, "0")}`;
      if (sisa-- <= 0) { clearInterval(timerBayar); $("#dlg-bayar").close(); toast("Kode QRIS kedaluwarsa, silakan buka lagi", true); }
    };
    tick(); timerBayar = setInterval(tick, 1000);
    $("#dlg-bayar").showModal();
  } catch (err) { toast(err.message, true); }
}
$("#dlg-bayar").addEventListener("close", () => clearInterval(timerBayar));
$("#bayar-sudah").addEventListener("click", async (e) => {
  try {
    const r = await api("POST", `/api/penjualan/${e.target.dataset.id}/sudah-bayar`);
    $("#dlg-bayar").close();
    toast(r.message);
    refresh();
  } catch (err) { toast(err.message, true); }
});

// ---------------- Pengguna (admin)
function renderPengguna() {
  const fr = $("#filter-role").value;
  const rows = fr ? userList.filter((u) => u.role === fr) : userList;
  $("#tbl-user").innerHTML = rows.map((u) => `
    <tr><td>${u.id}</td><td><b>${esc(u.nama)}</b></td><td>${esc(u.username)}</td><td><span class="role ${u.role}">${LABEL_ROLE[u.role]}</span></td>
    <td>${esc(u.created_at)}</td><td>${u.id === sesi.user.id ? '<span class="tag">Anda</span>' : aksi("pengguna", u.id)}</td></tr>`).join("");
}
function bukaUser(u) {
  const f = $("#form-user");
  f.reset();
  $("#judul-user").textContent = u ? "Ubah Pengguna" : "Tambah Pengguna";
  $("#pw-hint").textContent = u ? "(kosongkan jika tidak diganti)" : "";
  f.password.required = !u;
  f.id.value = u?.id || "";
  if (u) ["nama", "username", "role"].forEach((k) => (f[k].value = u[k]));
  $("#dlg-user").showModal();
}
$("#form-user").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const id = body.id; delete body.id;
  if (!body.password) delete body.password;
  await simpan(id ? "PUT" : "POST", "/api/auth/users" + (id ? "/" + id : ""), body, "#dlg-user");
});

// ---------------- Ringkasan (admin & penjual)
function renderRingkasan() {
  $("#s-lahan").textContent = lahanList.length;
  $("#s-luas").textContent = kg(lahanList.reduce((a, l) => a + l.luas_ha, 0)) + " ha";
  $("#s-panen").textContent = berat(panenList.reduce((a, p) => a + p.jumlah_kg, 0));
  $("#s-nilai").textContent = rp(panenList.reduce((a, p) => a + p.total_nilai, 0));
  $("#s-terjual").textContent = berat(jualList.reduce((a, j) => a + j.jumlah_kg, 0));
  $("#s-pendapatan").textContent = rp(jualList.filter((j) => j.status_bayar === "Lunas").reduce((a, j) => a + j.total_harga, 0));
  $("#s-piutang").textContent = rp(jualList.filter((j) => j.status_bayar !== "Lunas").reduce((a, j) => a + j.total_harga, 0));
  $("#s-sisa").textContent = berat(panenList.reduce((a, p) => a + sisaKg(p), 0));
  const hit = {};
  lahanList.forEach((l) => (hit[l.status] = (hit[l.status] || 0) + 1));
  $("#status-lahan").innerHTML = Object.entries(hit).map(([s, n]) => `<span class="badge ${esc(s.split(" ")[0])}">${esc(s)}: ${n}</span>`).join("") || "<span class='empty'>-</span>";
  $("#recent").innerHTML = panenList.slice(0, 5).map((p) => `<tr><td>${esc(p.tanggal_panen)}</td><td>${esc(namaLahan(p.lahan_id))}</td><td>${esc(p.komoditas)}</td><td class="num">${berat(p.jumlah_kg)}</td><td class="num">${rp(p.total_nilai)}</td></tr>`).join("")
    || `<tr><td colspan="5" class="empty">Belum ada data panen</td></tr>`;
}

// ---------------- Aksi umum
async function simpan(method, url, body, dialog) {
  try {
    const r = await api(method, url, body);
    $(dialog).close();
    toast(r.message);
    refresh();
  } catch (err) { toast(err.message, true); }
}

const URL_HAPUS = { lahan: "/api/lahan/", panen: "/api/panen/", penjualan: "/api/penjualan/", pembelian: "/api/penjualan/", pengguna: "/api/auth/users/" };
const SUMBER = { lahan: () => lahanList, panen: () => panenList, penjualan: () => jualList, pengguna: () => userList };
const BUKA = { lahan: bukaLahan, panen: bukaPanen, penjualan: bukaJual, pengguna: bukaUser };

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.matches("[data-close]")) return t.closest("dialog").close();
  if (t.dataset.beli) return bukaBeli(t.dataset.beli);
  if (t.dataset.bayar) return bukaBayar(t.dataset.bayar);
  if (t.dataset.lunas) {
    if (!confirm(`Pembayaran transaksi ID ${t.dataset.lunas} sudah diterima?`)) return;
    try { toast((await api("PUT", "/api/penjualan/" + t.dataset.lunas, { status_bayar: "Lunas" })).message); refresh(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.edit) return BUKA[t.dataset.edit](SUMBER[t.dataset.edit]().find((x) => x.id == t.dataset.id));
  if (t.dataset.del) {
    const jenis = t.dataset.del;
    const tanya = jenis === "pembelian" ? `Batalkan pembelian ID ${t.dataset.id}?` : `Hapus data ${jenis} ID ${t.dataset.id}?`;
    if (!confirm(tanya)) return;
    try { toast((await api("DELETE", URL_HAPUS[jenis] + t.dataset.id)).message); refresh(); }
    catch (err) { toast(err.message, true); }
  }
});
$("#tambah-lahan").addEventListener("click", () => bukaLahan());
$("#tambah-panen").addEventListener("click", () => bukaPanen());
$("#tambah-jual").addEventListener("click", () => bukaJual());
$("#tambah-user").addEventListener("click", () => bukaUser());
$("#cari-lahan").addEventListener("input", renderLahan);
$("#cari-katalog").addEventListener("input", renderKatalog);
$("#filter-lahan").addEventListener("change", renderPanen);
$("#filter-bayar").addEventListener("change", renderPenjualan);
$("#filter-role").addEventListener("change", renderPengguna);

async function refresh() {
  if (!sesi) return;
  try {
    const [l, p, j] = await Promise.all([api("GET", "/api/lahan"), api("GET", "/api/panen"), api("GET", "/api/penjualan")]);
    lahanList = l.data; panenList = p.data; jualList = j.data;
    if (role() === "pembeli") {
      katalogList = (await api("GET", "/api/penjualan/katalog")).data;
      renderKatalog();
      renderPembelian();
    } else {
      if (role() === "admin") {
        userList = (await api("GET", "/api/auth/users")).data;
        penjualList = userList.filter((u) => u.role === "penjual");
        renderPengguna();
      }
      renderLahan(); renderPanen(); renderPenjualan(); renderRingkasan();
    }
  } catch (e) { if (sesi) toast(e.message, true); }
  cekStatus();
}

// ---------------- Chatbot asisten (layanan-bantuan)
const chat = { buka: false, mulai: false };
function chatPesan(teks, dari) {
  const el = document.createElement("div");
  el.className = "bubble " + dari;
  el.textContent = teks;                       // textContent: aman dari HTML injection
  $("#chat-isi").append(el);
  $("#chat-isi").scrollTop = $("#chat-isi").scrollHeight;
  return el;
}
function chatSaran(list) {
  $("#chat-saran").innerHTML = "";
  (list || []).forEach((s) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = s;
    b.addEventListener("click", () => chatKirim(s));
    $("#chat-saran").append(b);
  });
}
async function chatKirim(teks) {
  if (teks) chatPesan(teks, "saya");
  chatSaran([]);
  const ketik = chatPesan("Mengetik…", "bot ketik");
  try {
    const url = sesi ? "/api/bantuan/chat" : "/api/bantuan/publik";
    const r = await api("POST", url, { pesan: teks || "" });
    ketik.remove();
    chatPesan(r.data.jawaban, "bot");
    chatSaran(r.data.saran);
  } catch (e) {
    ketik.remove();
    chatPesan("Maaf, asisten sedang tidak bisa dihubungi. Coba lagi sebentar.", "bot");
  }
}
function chatReset() { $("#chat-isi").innerHTML = ""; chatSaran([]); chat.mulai = false; if (chat.buka) { chat.mulai = true; chatKirim(""); } }
$("#chat-buka").addEventListener("click", () => {
  chat.buka = true; $("#chat").hidden = false; $("#chat-buka").hidden = true;
  if (!chat.mulai) { chat.mulai = true; chatKirim(""); }
  $("#chat-form").pesan.focus();
});
$("#chat-tutup").addEventListener("click", () => { chat.buka = false; $("#chat").hidden = true; $("#chat-buka").hidden = false; });
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = e.target.pesan.value.trim();
  if (!t) return;
  e.target.pesan.value = "";
  chatKirim(t);
});

// ---------------- Mulai
(async () => {
  if (!sesi) return keluar();
  try { await api("GET", "/api/auth/me"); masuk(); } catch { keluar(); }
})();
