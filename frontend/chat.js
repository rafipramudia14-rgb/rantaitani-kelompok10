// TaniMart: chat penjual-pembeli (layanan-bantuan, db_bantuan). Admin hanya memantau & bisa menghapus.
const CH = { daftar: [], aktif: null, timer: null };

async function muatChat() {
  if (!sesi) return;
  try { CH.daftar = (await api("GET", "/api/bantuan/percakapan")).data; } catch { CH.daftar = []; }
  const n = CH.daftar.reduce((a, p) => a + Number(p.belum_dibaca || 0), 0);
  $("#chat2-btn").hidden = false;
  $("#chat2-jml").textContent = n > 9 ? "9+" : n;
  $("#chat2-jml").hidden = !n || role() === "admin";
  if ($("#dlg-chat2").open) renderDaftarChat();
}
function renderDaftarChat() {
  const admin = role() === "admin";
  $("#ch-daftar").innerHTML = CH.daftar.map((p) => {
    const lawan = admin ? `${esc(p.pembeli_nama)} ↔ ${esc(p.toko_nama)}` : role() === "pembeli" ? esc(p.toko_nama) : esc(p.pembeli_nama);
    return `<li class="${CH.aktif == p.id ? "aktif" : ""}" data-buka-chat="${p.id}"><div class="ch-av">${esc(lawan.trim()[0] || "?")}</div>
      <div><b>${lawan}</b><small>${esc(p.pesan_terakhir || "belum ada pesan")}</small></div>
      ${Number(p.belum_dibaca) && !admin ? `<span class="ch-n">${p.belum_dibaca}</span>` : ""}</li>`;
  }).join("") || `<li class="kosong">${role() === "pembeli" ? "Belum ada chat. Mulai dari tombol Chat penjual di halaman produk atau toko." : "Belum ada chat dari pembeli."}</li>`;
}
async function bukaChat(cid) {
  if (!$("#dlg-chat2").open) $("#dlg-chat2").showModal();
  await muatChat();
  renderDaftarChat();
  if (!cid && CH.daftar[0]) cid = CH.daftar[0].id;
  CH.aktif = cid || null;
  renderDaftarChat();
  await renderPesan();
  clearInterval(CH.timer);
  CH.timer = setInterval(() => { if ($("#dlg-chat2").open) { renderPesan(true); muatChat(); } }, 8000);
}
async function renderPesan(diam) {
  const box = $("#ch-isi");
  if (!CH.aktif) { box.innerHTML = "<p class='ch-kosong'>Pilih percakapan di sebelah kiri.</p>"; $("#form-ch").hidden = true; $("#ch-kepala").textContent = ""; return; }
  try {
    const d = (await api("GET", `/api/bantuan/percakapan/${CH.aktif}/pesan`)).data, p = d.percakapan, admin = role() === "admin";
    const bawah = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    $("#ch-kepala").innerHTML = admin ? `<b>${esc(p.pembeli_nama)}</b> ↔ <b>${esc(p.toko_nama)}</b> <span class="tag">mode pantau admin</span> <button type="button" class="btn sm danger" data-hapus-chat="${p.id}">Hapus percakapan</button>`
      : `<b>${esc(role() === "pembeli" ? p.toko_nama : p.pembeli_nama)}</b>${p.panen_id ? ` <small>· tentang ${esc((katalogList.find((k) => k.panen_id == p.panen_id) || panenList.find((x) => x.id == p.panen_id) || {}).nama_produk || "produk")}</small>` : ""}`;
    box.innerHTML = d.pesan.map((m) => {
      const milik = m.pengirim_id === sesi.user.id;
      return `<div class="ch-baris ${milik ? "saya" : ""}"><div class="ch-bubble">${admin ? `<small class="ch-nama">${esc(m.pengirim_nama)}</small>` : ""}${esc(m.isi)}
        <small class="ch-waktu">${esc(String(m.created_at).slice(11, 16))}${m.diubah ? " · diubah" : ""}${milik ? (m.dibaca ? " · ✓✓" : " · ✓") : ""}</small></div>
        ${milik ? `<span class="ch-aksi"><button type="button" data-ubah-pesan="${m.id}" title="Ubah">✎</button><button type="button" data-hapus-pesan="${m.id}" title="Hapus">🗑</button></span>` : admin ? `<span class="ch-aksi"><button type="button" data-hapus-pesan="${m.id}" title="Hapus">🗑</button></span>` : ""}</div>`;
    }).join("") || "<p class='ch-kosong'>Belum ada pesan. Sapa dulu, misalnya tanya stok atau waktu kirim.</p>";
    if (!diam || bawah) box.scrollTop = box.scrollHeight;
    $("#form-ch").hidden = admin;
  } catch (e) { if (!diam) toast(e.message, true); }
}
async function mulaiChat(penjualId, panenId) {
  try {
    const p = (await api("POST", "/api/bantuan/percakapan", { penjual_id: penjualId, panen_id: panenId })).data;
    document.querySelectorAll("dialog[open]").forEach((d) => d.id !== "dlg-chat2" && d.close());
    bukaChat(p.id);
  } catch (e) { toast(e.message, true); }
}
$("#form-ch").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = e.target.isi.value.trim();
  if (!t) return;
  try { await api("POST", `/api/bantuan/percakapan/${CH.aktif}/pesan`, { isi: t }); e.target.isi.value = ""; renderPesan(); muatChat(); }
  catch (err) { toast(err.message, true); }
});
$("#ch-templat").addEventListener("change", (e) => { if (e.target.value) { $("#form-ch").isi.value = e.target.value; e.target.value = ""; $("#form-ch").isi.focus(); } });
$("#dlg-chat2").addEventListener("close", () => clearInterval(CH.timer));
$("#chat2-btn").addEventListener("click", () => bukaChat());
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-buka-chat],[data-mulai-chat],[data-ubah-pesan],[data-hapus-pesan],[data-hapus-chat]");
  if (!t) return;
  if (t.dataset.bukaChat) { CH.aktif = Number(t.dataset.bukaChat); renderDaftarChat(); return renderPesan(); }
  if (t.dataset.mulaiChat) return mulaiChat(Number(t.dataset.mulaiChat), Number(t.dataset.panen) || undefined);
  try {
    if (t.dataset.ubahPesan) {
      const lama = t.closest(".ch-baris").querySelector(".ch-bubble").childNodes[0].textContent.trim();
      const baru = prompt("Ubah pesan:", lama);
      if (baru === null || !baru.trim()) return;
      toast((await api("PUT", `/api/bantuan/pesan/${t.dataset.ubahPesan}`, { isi: baru })).message);
    }
    if (t.dataset.hapusPesan) { if (!confirm("Hapus pesan ini?")) return; toast((await api("DELETE", `/api/bantuan/pesan/${t.dataset.hapusPesan}`)).message); }
    if (t.dataset.hapusChat) { if (!confirm("Hapus seluruh percakapan ini?")) return; toast((await api("DELETE", `/api/bantuan/percakapan/${t.dataset.hapusChat}`)).message); CH.aktif = null; await muatChat(); }
    renderPesan();
  } catch (err) { toast(err.message, true); }
});
setInterval(() => { if (sesi && !$("#dlg-chat2").open) muatChat(); }, 30000);
