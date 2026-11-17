// TaniMart: sistem admin — dashboard grafik (Ringkasan) dan pusat Moderasi (iklan, voucher, ulasan, chat, pengiriman)
const MOD = { tab: "pengiriman", ulasan: [] };

// ---------------------------------------------------------------- Grafik sederhana (SVG, tanpa library)
function grafikBatang(data, warna = "#5a3e2b", fmt = (v) => v) {
  const W = 1100, H = 230, L = 8, B = 34, max = Math.max(1, ...data.map((d) => d[1]));
  const lb = (W - L * 2) / Math.max(1, data.length), bw = Math.min(46, lb * 0.62);
  return `<svg viewBox="0 0 ${W} ${H}" class="grafik-svg" role="img">` + data.map(([lab, v], i) => {
    const h = ((H - B - 22) * v) / max, x = L + i * lb + (lb - bw) / 2, y = H - B - h;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, v ? 2 : 0)}" rx="5" fill="${warna}"><title>${esc(lab)}: ${fmt(v)}</title></rect>
      ${v ? `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="g-nilai">${fmt(v)}</text>` : ""}
      <text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle" class="g-label">${esc(lab)}</text>`;
  }).join("") + `</svg>`;
}
function grafikMendatar(data, warna = "#c9a24d", fmt = (v) => v) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  return `<ul class="g-mendatar">${data.map(([lab, v]) => `<li><span>${esc(lab)}</span><i><b style="width:${(v / max) * 100}%;background:${warna}"></b></i><em>${fmt(v)}</em></li>`).join("")}</ul>`;
}
const rpSingkat = (n) => n >= 1e6 ? "Rp" + (n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + "jt" : n >= 1e3 ? "Rp" + Math.round(n / 1e3) + "rb" : "Rp" + Math.round(n);

function renderDashboardAdmin() {
  const box = $("#admin-grafik");
  if (!box || role() !== "admin") return;
  box.hidden = false;
  const aktif = jualList.filter((j) => j.status_pesanan !== "Dibatalkan");
  // 14 hari terakhir
  const hari = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10));
  const perHari = hari.map((h) => [h.slice(8) + "/" + h.slice(5, 7), aktif.filter((j) => j.tanggal_jual === h).length]);
  const urutan = ["Menunggu Bayar", "Dibayar", "Diproses", "Dikirim", "Selesai", "Dibatalkan"];
  const status = urutan.map((s) => [s, jualList.filter((j) => j.status_pesanan === s).length]);
  const perProduk = {};
  aktif.forEach((j) => { const p = panenList.find((x) => x.id == j.panen_id); const n = p?.nama_produk || p?.komoditas || "Panen #" + j.panen_id; perProduk[n] = (perProduk[n] || 0) + j.jumlah_kg; });
  const perToko = {};
  aktif.filter((j) => j.status_bayar === "Lunas").forEach((j) => { const t = tokoList.find((x) => x.user_id == j.penjual_id); const n = t?.nama_toko || "Penjual #" + j.penjual_id; perToko[n] = (perToko[n] || 0) + (j.total_harga || 0); });
  const terlambat = jualList.filter(telat).length, menunggu = tokoList.filter((t) => t.status === "Menunggu").length;
  const gmv = aktif.reduce((a, j) => a + (j.total_bayar ?? j.total_harga), 0);
  box.innerHTML = `
    <div class="adm-kpi">
      <div class="card"><span>Nilai transaksi (GMV)</span><b>${rp(gmv)}</b></div>
      <div class="card"><span>Pesanan aktif</span><b>${aktif.filter((j) => !["Selesai"].includes(j.status_pesanan)).length}</b></div>
      <div class="card ${menunggu ? "perlu" : ""}"><span>Toko menunggu verifikasi</span><b>${menunggu}</b></div>
      <div class="card ${terlambat ? "perlu" : ""}"><span>Kiriman melewati estimasi</span><b>${terlambat}</b></div>
    </div>
    <div class="adm-grafik">
      <section class="g-kartu lebar"><h3>Pesanan 14 hari terakhir</h3>${grafikBatang(perHari)}</section>
      <section class="g-kartu"><h3>Status pesanan</h3>${grafikMendatar(status, "#5a3e2b")}</section>
      <section class="g-kartu"><h3>Produk terlaris (kg)</h3>${grafikMendatar(Object.entries(perProduk).sort((a, b) => b[1] - a[1]).slice(0, 5), "#c9a06b", (v) => berat(v))}</section>
      <section class="g-kartu"><h3>Pendapatan lunas per toko</h3>${grafikMendatar(Object.entries(perToko).sort((a, b) => b[1] - a[1]).slice(0, 5), "#8a6a4f", rpSingkat)}</section>
    </div>`;
}
// kiriman dianggap terlambat bila sudah melewati tanggal kirim + estimasi hari (dibulatkan ke atas) + 1 hari toleransi
function telat(j) {
  if (j.status_pesanan !== "Dikirim" || !j.dikirim_at) return false;
  return Date.now() > new Date(String(j.dikirim_at).replace(" ", "T")).getTime() + (Math.ceil(j.estimasi_hari || 1) + 1) * 864e5;
}

// ---------------------------------------------------------------- Moderasi
async function renderModerasi() {
  if (role() !== "admin" || !$("#tab-moderasi")) return;
  $("#mod-tab").innerHTML = [["pengiriman", "🚚 Pengiriman"], ["iklan", "📣 Iklan"], ["voucher", "🎟️ Voucher"], ["ulasan", "⭐ Ulasan"], ["chat", "💬 Chat"]]
    .map(([k, l]) => `<button class="chip${MOD.tab === k ? " aktif" : ""}" data-mod="${k}">${l}</button>`).join("");
  const isi = $("#mod-isi");
  if (MOD.tab === "pengiriman") {
    const rows = jualList.filter((j) => ["Diproses", "Dikirim"].includes(j.status_pesanan) || j.no_resi);
    isi.innerHTML = tabel(["Pesanan", "Rute", "Jasa / Resi", "Status", "Dikirim", ""], rows.map((j) => `<tr class="${telat(j) ? "baris-telat" : ""}">
      <td><b>#${j.id}</b> ${esc(j.pembeli)}<br><small>${berat(j.jumlah_kg)} · ${esc(labelPanen(j.panen_id).split(" · ")[0])}</small></td>
      <td class="kirim-sel"><small>${esc(j.kota_asal || "-")} → ${esc(j.kota_tujuan || "-")}<br>${esc(j.moda_kirim || "")} · ± ${Math.ceil(j.estimasi_hari || 1)} hari</small></td>
      <td>${esc(j.jasa_kirim || "-")}<br><small>${esc(j.no_resi || "belum diatur")}</small></td>
      <td>${badgePesanan(j.status_pesanan)}${telat(j) ? '<br><span class="badge Bera">melewati estimasi</span>' : ""}</td>
      <td><small>${esc(j.dikirim_at ? String(j.dikirim_at).slice(0, 16) : "-")}</small></td>
      <td>${j.jalur ? `<button class="btn sm" data-lacak="${j.id}">Lacak</button>` : ""}${j.no_resi && j.status_pesanan === "Dikirim" ? `<button class="btn sm" data-update-lacak="${j.id}">Update lacak</button>` : ""}</td></tr>`), "Belum ada pesanan yang dikemas atau dikirim.");
  } else if (MOD.tab === "iklan") {
    isi.innerHTML = tabel(["Iklan", "Toko", "Periode", "Tayang / Klik", "Status", ""], iklanList.map((i) => `<tr>
      <td><b>${esc(i.judul)}</b><br><small>${esc(i.nama_produk || i.komoditas)} · ${esc(i.kata_kunci)}</small></td>
      <td>${esc(tokoList.find((t) => t.user_id == i.penjual_id)?.nama_toko || "#" + i.penjual_id)}</td>
      <td><small>${esc(i.mulai)} s.d. ${esc(i.selesai)}</small></td><td class="num">${i.tayang} / ${i.klik} <small>(${i.ctr_persen}%)</small></td>
      <td>${i.berjalan ? '<span class="badge Lunas">Tayang</span>' : `<span class="badge Belum">${esc(i.status)}</span>`}</td>
      <td><button class="btn sm" data-ik-jeda="${i.id}" data-ke="${i.status === "Aktif" ? "Dijeda" : "Aktif"}">${i.status === "Aktif" ? "Jeda" : "Aktifkan"}</button><button class="btn sm danger" data-del="iklan" data-id="${i.id}">Hapus</button></td></tr>`), "Belum ada iklan.");
  } else if (MOD.tab === "voucher") {
    isi.innerHTML = tabel(["Kode", "Toko", "Voucher", "Terpakai", "Status", ""], voucherList.map((v) => `<tr>
      <td><span class="v-kode">${esc(v.kode)}</span></td><td>${esc(tokoList.find((t) => t.user_id == v.penjual_id)?.nama_toko || "#" + v.penjual_id)}</td>
      <td>${esc(v.nama)}<br><small>${labelV(v)}</small></td><td class="num">${v.terpakai} / ${v.kuota}</td>
      <td>${v.berlaku ? '<span class="badge Lunas">Berlaku</span>' : '<span class="badge Belum">Tidak berlaku</span>'}</td>
      <td><button class="btn sm" data-v-aktif="${v.id}" data-ke="${v.aktif ? 0 : 1}">${v.aktif ? "Nonaktifkan" : "Aktifkan"}</button><button class="btn sm danger" data-del="voucher" data-id="${v.id}">Hapus</button></td></tr>`), "Belum ada voucher.");
  } else if (MOD.tab === "ulasan") {
    try { MOD.ulasan = (await api("GET", "/api/penjualan/ulasan")).data; } catch { MOD.ulasan = []; }
    isi.innerHTML = tabel(["Pembeli", "Produk", "Rating", "Komentar", "Tanggal", ""], MOD.ulasan.map((u) => `<tr>
      <td>${esc(u.nama_pembeli)}</td><td>${esc(labelPanen(u.panen_id).split(" · ")[0])}</td><td><span class="ul-bintang">${bintang(u.rating)}</span></td>
      <td class="kirim-sel"><small>${esc(u.komentar || "-")}</small></td><td><small>${esc(String(u.created_at).slice(0, 10))}</small></td>
      <td><button class="btn sm danger" data-hapus-ulasan="${u.id}">Hapus</button></td></tr>`), "Belum ada ulasan.");
  } else {
    await muatChat();
    isi.innerHTML = tabel(["Pembeli", "Toko", "Pesan terakhir", "Jumlah pesan", ""], CH.daftar.map((p) => `<tr>
      <td>${esc(p.pembeli_nama)}</td><td>${esc(p.toko_nama)}</td><td class="kirim-sel"><small>${esc(p.pesan_terakhir || "-")}</small></td><td class="num">${p.jumlah_pesan}</td>
      <td><button class="btn sm" data-buka-chat-admin="${p.id}">Pantau</button><button class="btn sm danger" data-hapus-chat="${p.id}">Hapus</button></td></tr>`), "Belum ada percakapan.");
  }
}
const tabel = (kepala, baris, kosong) => `<div class="tablewrap"><table><thead><tr>${kepala.map((k) => `<th>${k}</th>`).join("")}</tr></thead>
  <tbody>${baris.join("") || `<tr><td colspan="${kepala.length}" class="empty">${kosong}</td></tr>`}</tbody></table></div>`;

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-mod],[data-v-aktif],[data-hapus-ulasan],[data-buka-chat-admin]");
  if (!t) return;
  try {
    if (t.dataset.mod) { MOD.tab = t.dataset.mod; return renderModerasi(); }
    if (t.dataset.vAktif) { toast((await api("PUT", `/api/penjualan/voucher/${t.dataset.vAktif}`, { aktif: Number(t.dataset.ke) })).message); await muatVoucher(); }
    if (t.dataset.hapusUlasan) { if (!confirm("Hapus ulasan ini?")) return; toast((await api("DELETE", `/api/penjualan/ulasan/${t.dataset.hapusUlasan}`)).message); }
    if (t.dataset.bukaChatAdmin) return bukaChat(Number(t.dataset.bukaChatAdmin));
    renderModerasi();
  } catch (err) { toast(err.message, true); }
});
