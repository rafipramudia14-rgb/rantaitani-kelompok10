// Halaman Info TaniMart (publik, tanpa login). Data dari layanan-info lewat /api/info/publik/...
const $ = (s) => document.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const rp = (n) => "Rp " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n);
const angka = (n, d = 0) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: d }).format(n);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const judul = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const periodeTeks = (p) => { const [y, m] = p.split("-"); return `${BULAN[+m - 1]} ${y}`; };
const WARNA = ["#1f5a34", "#c9a24d", "#7fae3a", "#8a4b2a"];

async function ambil(url) {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || "Gagal memuat data");
  return j.data;
}

// ---------------------------------------------------------------- Harga pangan
let semuaHarga = [], terbaru = [];

function kunciSeri(h) { return `${h.komoditas}|${h.varian}|${h.tingkat}|${h.wilayah}`; }

function renderTerbaru() {
  const k = $("#pilih-komoditas").value;
  // kartu hanya angka nasional; angka per provinsi ada di tabel "Lihat semua data harga"
  const data = terbaru.filter((h) => (!k || h.komoditas === k) && h.wilayah === "Nasional");
  $("#harga-terbaru").innerHTML = data.map((h) => {
    let ubah = "<span class='tetap'>Belum ada data periode sebelumnya</span>";
    if (h.harga_sebelumnya) {
      const pct = ((h.harga - h.harga_sebelumnya) / h.harga_sebelumnya) * 100;
      const kelas = pct > 0.05 ? "naik" : pct < -0.05 ? "turun" : "tetap";
      const panah = kelas === "naik" ? "▲" : kelas === "turun" ? "▼" : "•";
      ubah = `<span class="${kelas}">${panah} ${angka(Math.abs(pct), 1)}% dari periode sebelumnya</span>`;
    }
    return `<article class="harga-kartu">
      <div class="atas"><h3>${esc(h.komoditas)}</h3><span class="tingkat">${esc(h.tingkat)}</span></div>
      <span class="varian">${esc(h.varian === "-" ? h.wilayah : h.varian + " · " + h.wilayah)}</span>
      <span class="nilai">${rp(h.harga)}<small> /${esc(h.satuan)}</small></span>
      <span class="ubah">${ubah}</span>
      <span class="meta">${periodeTeks(h.periode)} · ${esc(h.sumber)}</span>
    </article>`;
  }).join("") || "<p class='empty'>Belum ada data harga.</p>";
}

function renderTabel() {
  const k = $("#pilih-komoditas").value;
  $("#tbl-harga").innerHTML = semuaHarga.filter((h) => !k || h.komoditas === k).map((h) => `<tr>
    <td>${periodeTeks(h.periode)}</td><td>${esc(h.komoditas)}</td><td>${esc(h.varian)}</td><td>${esc(h.tingkat)}</td>
    <td>${esc(h.wilayah)}</td><td class="num">${rp(h.harga)}/${esc(h.satuan)}</td><td>${esc(h.sumber)}</td></tr>`).join("");
}

function renderGrafik() {
  const svg = $("#grafik");
  const k = $("#pilih-komoditas").value || terbaru[0]?.komoditas;
  const seri = {};
  semuaHarga.filter((h) => h.komoditas === k && h.wilayah === "Nasional").forEach((h) => (seri[kunciSeri(h)] ||= []).push(h));
  const daftar = Object.values(seri).map((s) => s.sort((a, b) => a.periode.localeCompare(b.periode))).slice(0, 4);
  $("#grafik-judul").textContent = k ? `Perkembangan harga ${k}` : "Perkembangan harga";
  svg.replaceChildren();
  const periode = [...new Set(daftar.flat().map((h) => h.periode))].sort();
  if (periode.length < 2) {
    $("#grafik-legenda").innerHTML = "";
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", 360); t.setAttribute("y", 130); t.setAttribute("text-anchor", "middle"); t.setAttribute("class", "sumbu");
    t.textContent = "Grafik muncul jika ada data minimal dua periode.";
    svg.append(t);
    return;
  }
  const W = 720, H = 260, L = 64, R = 34, T = 14, B = 34;
  const nilai = daftar.flat().map((h) => h.harga);
  let min = Math.min(...nilai), max = Math.max(...nilai);
  const pad = (max - min) * 0.12 || max * 0.1; min -= pad; max += pad;
  const x = (p) => L + (periode.indexOf(p) / (periode.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const tambah = (tag, attr, teks) => { const e = document.createElementNS(NS, tag); for (const a in attr) e.setAttribute(a, attr[a]); if (teks) e.textContent = teks; svg.append(e); return e; };
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    tambah("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "garis-bantu" });
    tambah("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end", class: "sumbu" }, angka(v));
  }
  const langkah = Math.ceil(periode.length / 8);
  periode.forEach((p, i) => { if (i % langkah === 0 || i === periode.length - 1) tambah("text", { x: x(p), y: H - 10, "text-anchor": "middle", class: "sumbu" }, periodeTeks(p)); });
  daftar.forEach((s, i) => {
    tambah("path", { d: s.map((h, j) => `${j ? "L" : "M"}${x(h.periode)},${y(h.harga)}`).join(""), fill: "none", stroke: WARNA[i], "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" });
    s.forEach((h) => { const c = tambah("circle", { cx: x(h.periode), cy: y(h.harga), r: 3.5, fill: "#fff", stroke: WARNA[i], "stroke-width": 2 }); c.innerHTML = `<title>${esc(h.varian)} · ${periodeTeks(h.periode)}: ${rp(h.harga)}</title>`; });
  });
  $("#grafik-legenda").innerHTML = daftar.map((s, i) => `<span><i style="background:${WARNA[i]}"></i>${esc(s[0].varian === "-" ? s[0].komoditas : s[0].varian)} (${esc(s[0].tingkat)}, ${esc(s[0].wilayah)})</span>`).join("");
}

function renderHarga() { renderTerbaru(); renderGrafik(); renderTabel(); }

async function muatHarga() {
  try {
    [semuaHarga, terbaru] = await Promise.all([ambil("/api/info/publik/harga"), ambil("/api/info/publik/harga/terbaru")]);
    const kom = [...new Set(terbaru.map((h) => h.komoditas))];
    $("#pilih-komoditas").innerHTML = `<option value="">Semua komoditas</option>` + kom.map((k) => `<option>${esc(k)}</option>`).join("");
    $("#h-komoditas").textContent = kom.length;
    const akhir = terbaru.map((h) => h.periode).sort().at(-1);
    $("#h-periode").textContent = akhir ? periodeTeks(akhir) : "–";
    renderHarga();
  } catch (e) {
    $("#harga-terbaru").innerHTML = `<p class="empty">Data harga belum bisa dimuat (${esc(e.message)}).</p>`;
  }
}
$("#pilih-komoditas").addEventListener("change", renderHarga);

// ---------------------------------------------------------------- Peta produksi
const KELAS_WARNA = ["#e9e3c4", "#b9d38a", "#7fae3a", "#3f7f3c", "#1f5a34"];
let produksi = [], paths = {}, komAktif = "Padi";

function tampilkanPeta() {
  const data = produksi.filter((d) => d.komoditas === komAktif);
  const per = Object.fromEntries(data.map((d) => [d.provinsi, d]));
  const nilai = data.map((d) => d.produksi_ton).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => nilai[Math.min(nilai.length - 1, Math.floor(p * nilai.length))];
  const batas = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const kelas = (v) => (!v ? -1 : batas.filter((b) => v >= b).length);
  for (const [nama, el] of Object.entries(paths)) {
    const k = kelas(per[nama]?.produksi_ton);
    el.setAttribute("fill", k < 0 ? "#f4f1e6" : KELAS_WARNA[k]);
  }
  const fmtBatas = (v) => angka(v >= 1000 ? Math.round(v / 1000) * 1000 : v);
  $("#peta-legenda").innerHTML = [`<li><span style="background:#f4f1e6"></span>Tidak ada produksi</li>`]
    .concat(KELAS_WARNA.map((w, i) => `<li><span style="background:${w}"></span>${i === 0 ? "< " + fmtBatas(batas[0]) : i === 4 ? "≥ " + fmtBatas(batas[3]) : fmtBatas(batas[i - 1]) + " – " + fmtBatas(batas[i])} ton</li>`)).join("");
  const top = data.slice(0, 5);
  $("#peringkat-judul").textContent = `5 provinsi teratas: ${komAktif}`;
  $("#peringkat").innerHTML = top.map((d) => `<li><b>${esc(judul(d.provinsi))}</b><span>${angka(d.produksi_ton)} ton</span></li>`).join("");
  const total = data.reduce((s, d) => s + d.produksi_ton, 0);
  $("#peta-total").textContent = `Total nasional ${angka(total)} ton (${data.filter((d) => d.produksi_ton > 0).length} provinsi berproduksi). Sumber: ${data[0]?.sumber || "BPS"}.`;
  document.querySelectorAll("#chips-peta .chip").forEach((c) => c.setAttribute("aria-pressed", c.dataset.k === komAktif));
}

function tip(nama, e) {
  const d = produksi.find((x) => x.provinsi === nama && x.komoditas === komAktif);
  const t = $("#peta-tip");
  t.innerHTML = `<b>${esc(judul(nama))}</b><br>${komAktif}: ${d && d.produksi_ton ? angka(d.produksi_ton) + " ton" : "tidak ada produksi"}`
    + (d?.luas_panen_ha ? `<br>Luas panen: ${angka(d.luas_panen_ha)} ha` : "");
  t.hidden = false;
  const kotak = $(".peta-kartu").getBoundingClientRect();
  const px = (e.clientX ?? kotak.left + kotak.width / 2) - kotak.left, py = (e.clientY ?? kotak.top + 40) - kotak.top;
  t.style.left = Math.min(px + 14, kotak.width - 250) + "px";
  t.style.top = Math.max(py - 60, 6) + "px";
}

async function muatPeta() {
  try {
    const [geo, prod] = await Promise.all([fetch("aset/data/peta-provinsi.json").then((r) => r.json()), ambil("/api/info/publik/produksi")]);
    produksi = prod.data;
    const svg = $("#peta-svg");
    svg.setAttribute("viewBox", geo.viewBox);
    for (const p of geo.provinsi) {
      const el = document.createElementNS(NS, "path");
      el.setAttribute("d", p.d);
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", judul(p.nama));
      el.addEventListener("mousemove", (e) => tip(p.nama, e));
      el.addEventListener("mouseleave", () => ($("#peta-tip").hidden = true));
      el.addEventListener("focus", (e) => tip(p.nama, e));
      el.addEventListener("blur", () => ($("#peta-tip").hidden = true));
      el.addEventListener("click", (e) => tip(p.nama, e));
      svg.append(el);
      paths[p.nama] = el;
    }
    $("#chips-peta").innerHTML = prod.komoditas.map((k) => `<button class="chip" data-k="${esc(k)}" aria-pressed="false">${esc(k)}</button>`).join("");
    $("#h-provinsi").textContent = geo.provinsi.length;
    const padi = produksi.filter((d) => d.komoditas === "Padi").reduce((s, d) => s + d.produksi_ton, 0);
    $("#h-padi").textContent = padi ? angka(padi / 1e6, 1) + " jt ton" : "–";
    tampilkanPeta();
  } catch (e) {
    $("#peringkat").innerHTML = `<li>Peta belum bisa dimuat (${esc(e.message)}).</li>`;
  }
}
$("#chips-peta").addEventListener("click", (e) => { if (e.target.dataset.k) { komAktif = e.target.dataset.k; tampilkanPeta(); } });

// ---------------------------------------------------------------- Menu aktif saat menggulir
const tabs = [...document.querySelectorAll(".info .tab")];
const amati = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) tabs.forEach((t) => t.classList.toggle("active", t.getAttribute("href") === "#" + e.target.id));
}), { rootMargin: "-45% 0px -50% 0px" });
["beranda", "harga", "peta", "kirim"].forEach((id) => amati.observe(document.getElementById(id)));

// ---------------------------------------------------------------- Estimasi kirim
async function hitungEstimasi(e) {
  e?.preventDefault();
  const f = $("#form-estimasi");
  try {
    const d = await Estimasi.hitung(f.asal.value, f.tujuan.value, f.ton.value);
    $("#hasil-estimasi").innerHTML = Estimasi.html(d, f.komoditas.value);
  } catch (x) { $("#hasil-estimasi").innerHTML = `<p class="empty">${esc(x.message)}</p>`; }
}
async function siapkanEstimasi() {
  const prov = await ambil("/api/info/publik/provinsi");
  const opsi = prov.map((p) => `<option value="${esc(p.nama)}">${esc(judul(p.nama))}</option>`).join("");
  const f = $("#form-estimasi");
  f.asal.innerHTML = opsi; f.tujuan.innerHTML = opsi;
  f.asal.value = "JAWA TENGAH"; f.tujuan.value = "KALIMANTAN TIMUR";
  f.addEventListener("submit", hitungEstimasi);
  hitungEstimasi();
}

muatHarga();
muatPeta();
siapkanEstimasi().catch((x) => ($("#hasil-estimasi").innerHTML = `<p class="empty">${esc(x.message)}</p>`));
