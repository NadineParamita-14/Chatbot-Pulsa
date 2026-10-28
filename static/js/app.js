/**
 * =====================================================================
 * app.js — Logika utama aplikasi (Vanilla JS)
 * ---------------------------------------------------------------------
 * - State global (data admin yang login).
 * - Handler login/logout.
 * - Fungsi render tiap view: Dashboard, Produk, Pesanan, Chat,
 *   Agent Config, Manajemen Admin (semua dipanggil oleh router.js).
 * - Utilitas UI: toast, modal, loading spinner, badge status,
 *   format Rupiah/tanggal, pagination, RBAC UI.
 * =====================================================================
 */

// =====================================================================
// STATE GLOBAL
// =====================================================================
const App = {
  user: null, // diisi dari GET /api/auth/me setelah token valid
};

// =====================================================================
// UTILITAS UMUM
// =====================================================================

/** Escape HTML — wajib untuk semua data dinamis agar aman dari XSS. */
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format angka menjadi Rupiah, cth: Rp 25.000. */
function formatIDR(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value || 0);
}

/** Format ISO datetime menjadi format Indonesia yang mudah dibaca. */
function formatDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Format platform ID internal menjadi kontak yang mudah dibaca:
 * - buang suffix internal WAHA/Baileys ("@c.us", "@lid", dst.);
 * - nomor WhatsApp diawali "+" (cth: 628123456789 -> +628123456789);
 * - ID Telegram dibiarkan apa adanya (bukan nomor telepon).
 * `channel` opsional — tanpa itu dipakai heuristik pola nomor Indonesia.
 */
function formatPlatformId(raw, channel) {
  if (raw === null || raw === undefined || raw === "") return "";
  const id = String(raw).split("@")[0].trim();
  const looksLikeWaNumber =
    (id.startsWith("62") && /^\d+$/.test(id) && id.length >= 10) ||
    (id.startsWith("0") && /^\d+$/.test(id) && id.length >= 9);
  const isWa = channel ? channel === "whatsapp" : looksLikeWaNumber;
  return isWa ? `+${id}` : id;
}

/** Badge pill berwarna untuk semua kolom status (gaya modern SaaS:
 *  emerald = sukses/paid/aktif, amber = pending/unpaid, rose = gagal). */
function statusBadge(status) {
  const colorMap = {
    success: "bg-emerald-100 text-emerald-800",
    paid: "bg-emerald-100 text-emerald-800",
    active: "bg-emerald-100 text-emerald-800",
    pending: "bg-amber-100 text-amber-800",
    unpaid: "bg-amber-100 text-amber-800",
    failed: "bg-rose-100 text-rose-800",
    inactive: "bg-slate-200 text-slate-700",
    superadmin: "bg-red-100 text-red-700",
    admin: "bg-gray-200 text-gray-800",
  };
  const cls = colorMap[status] || "bg-slate-100 text-slate-600";
  return `<span class="px-2.5 py-0.5 inline-flex text-xs font-medium rounded-full ${cls}">${esc(status || "-")}</span>`;
}

/** Tampilkan spinner di dalam container selagi data diambil. */
function setLoading(el) {
  el.innerHTML = `
    <div class="col-span-full flex justify-center py-10">
      <svg class="animate-spin h-8 w-8 text-slate-400" viewBox="0 0 24 24" fill="none">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
      </svg>
    </div>`;
}

/** Baris tabel saat tidak ada data. */
function emptyRow(colspan, text = "💤 Belum ada data untuk ditampilkan.") {
  return `<tr><td colspan="${colspan}" class="px-5 py-10 text-center text-sm text-slate-400">${esc(text)}</td></tr>`;
}

// ---------------------------------------------------------------------
// TOAST (notifikasi sukses / error)
// ---------------------------------------------------------------------
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const color =
    type === "error"
      ? "bg-red-600"
      : type === "info"
      ? "bg-slate-800"
      : "bg-green-600";
  const el = document.createElement("div");
  el.className = `${color} text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg`;
  el.textContent = message;
  container.appendChild(el);
  // Hilangkan otomatis setelah 3,5 detik (animasi keluar via style.css)
  setTimeout(() => {
    el.classList.add("closing");
    setTimeout(() => el.remove(), 220);
  }, 3500);
}

// ---------------------------------------------------------------------
// MODAL (buka/tutup generik)
// ---------------------------------------------------------------------
function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function closeAllModals() {
  // Tutup SEMUA modal sekaligus: setiap akar modal adalah parent dari
  // elemen .modal-overlay miliknya. Tanpa daftar ID manual — modal baru
  // otomatis ikut tertutup (dulu daftar statis lupa memuat modal-agent
  // sehingga tombol Batal/overlay tidak berfungsi).
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    const modalRoot = overlay.parentElement;
    if (modalRoot) modalRoot.classList.add("hidden");
  });
}

// ---------------------------------------------------------------------
// MODAL KONFIRMASI (pengganti window.confirm — dipakai verifikasi
// pembayaran, hapus produk, hapus admin)
// ---------------------------------------------------------------------
let confirmAction = null;

/**
 * Tampilkan modal konfirmasi. `onConfirm` dijalankan saat pengguna
 * menekan tombol persetujuan.
 */
function openConfirm({ title, message, confirmText = "Ya, Lanjutkan", danger = true, onConfirm }) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;

  const okBtn = document.getElementById("confirm-ok");
  okBtn.textContent = confirmText;
  // Tema Telkomsel: semua aksi persetujuan memakai pill merah
  okBtn.className =
    "px-6 py-2.5 text-[13px] uppercase tracking-widest font-semibold rounded-full text-white transition-all bg-red-600 hover:bg-red-700";
  document.getElementById("confirm-icon").className =
    "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-red-100 text-red-600";

  confirmAction = onConfirm;
  openModal("modal-confirm");
}

// ---------------------------------------------------------------------
// RBAC UI — sembunyikan menu khusus superadmin
// ---------------------------------------------------------------------
function applyRbacUi() {
  const isSuper = App.user && App.user.role === "superadmin";
  document.querySelectorAll("[data-superadmin-only]").forEach((el) => {
    el.classList.toggle("hidden", !isSuper);
  });
  // Kartu "Tren Pelanggan Aktif" memenuhi lebar grid saat kartu biaya AI
  // (superadmin-only) disembunyikan untuk role admin.
  const usersCard = document.getElementById("chart-users-card");
  if (usersCard) usersCard.classList.toggle("lg:col-span-2", !isSuper);
}

// ---------------------------------------------------------------------
// PAGINATION (Sebelumnya / nomor halaman / Berikutnya — 10 baris/halaman)
// ---------------------------------------------------------------------
/**
 * Susunan nomor halaman ala Flask .iter_pages(): tepi (2 halaman pertama
 * & terakhir) + tetangga halaman aktif (±1), celah ditandai "…".
 */
function paginationPages(current, totalPages) {
  const picked = new Set();
  const push = (p) => {
    if (p >= 1 && p <= totalPages) picked.add(p);
  };
  push(1); push(2);
  for (let p = current - 1; p <= current + 1; p++) push(p);
  push(totalPages - 1); push(totalPages);

  const sorted = [...picked].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Render kontrol paginasi ke `container` dari meta backend
 * {page, per_page, total, total_pages}. `compact` = varian ringkas
 * (tombol ‹ › + "2/5") untuk area sempit seperti pane kontak chat.
 * `scrollTarget` = elemen yang digulirkan ke atas viewport saat pindah
 * halaman, agar pengguna mendarat di kepala tabel — bukan tertinggal di
 * bawah halaman baru (SPA tanpa reload, jadi posisi scroll tetap).
 */
function renderPagination(container, meta, onPage, { compact = false, scrollTarget = null } = {}) {
  if (!meta || meta.total_pages <= 1) {
    container.innerHTML =
      !compact && meta && meta.total
        ? `<span class="text-slate-500">Total ${meta.total} data</span>`
        : "";
    return;
  }

  const baseBtn =
    "disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
  let html;

  if (compact) {
    html = `
      <div class="flex items-center gap-2">
        <button data-page="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""} aria-label="Halaman sebelumnya"
          class="w-7 h-7 rounded-full border border-slate-300 text-slate-600 hover:bg-gray-100 ${baseBtn}">‹</button>
        <span class="text-xs text-slate-500 whitespace-nowrap">${meta.page} / ${meta.total_pages}</span>
        <button data-page="${meta.page + 1}" ${meta.page >= meta.total_pages ? "disabled" : ""} aria-label="Halaman berikutnya"
          class="w-7 h-7 rounded-full border border-slate-300 text-slate-600 hover:bg-gray-100 ${baseBtn}">›</button>
      </div>`;
  } else {
    const pageBtns = paginationPages(meta.page, meta.total_pages)
      .map((p) =>
        p === "…"
          ? `<span class="px-1 text-slate-400 select-none">…</span>`
          : `<button data-page="${p}"
              class="min-w-[2rem] h-8 px-2 rounded-full text-xs font-semibold ${
                p === meta.page
                  ? "bg-gray-900 text-white"
                  : "border border-gray-300 text-slate-600 hover:bg-gray-100"
              } ${baseBtn}">${p}</button>`
      )
      .join("");
    html = `
      <span class="text-slate-500 text-center sm:text-left">Halaman ${meta.page} dari ${meta.total_pages} — total ${meta.total} data</span>
      <div class="flex items-center justify-center flex-wrap gap-2">
        <button data-page="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""}
          class="px-3 h-8 rounded-full border border-gray-300 text-sm hover:bg-gray-100 ${baseBtn}">‹ Sebelumnya</button>
        ${pageBtns}
        <button data-page="${meta.page + 1}" ${meta.page >= meta.total_pages ? "disabled" : ""}
          class="px-3 h-8 rounded-full border border-gray-300 text-sm hover:bg-gray-100 ${baseBtn}">Berikutnya ›</button>
      </div>`;
  }

  container.innerHTML = html;
  container.querySelectorAll("button[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      onPage(parseInt(btn.dataset.page, 10));
      // Gulirkan tabel ke atas viewport hanya saat pindah halaman (bukan
      // render awal) — pengguna selalu melihat baris pertama halaman baru.
      if (scrollTarget) {
        scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

// =====================================================================
// AUTH: LOGIN & LOGOUT
// =====================================================================
async function handleLogin(event) {
  event.preventDefault();
  const errorBox = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  errorBox.classList.add("hidden");

  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;

  submitBtn.disabled = true;
  submitBtn.textContent = "Memproses...";
  try {
    const res = await Api.post("/auth/login", { username, password });
    Api.setToken(res.data.token);
    App.user = res.data.admin;
    requestNotificationPermission(); // izin push notification (interaksi user)
    window.location.hash = "#dashboard"; // memicu navigate()
    showToast(`Selamat datang, ${res.data.admin.full_name}!`);
  } catch (e) {
    errorBox.textContent = e.message;
    errorBox.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Masuk";
  }
}

function handleLogout() {
  Api.setToken(null);
  App.user = null;
  window.location.hash = "#login";
  document.getElementById("app-shell").classList.add("hidden");
  showView("view-login");
  showToast("Anda telah keluar.", "info");
}

/** Tampilkan identitas user di topbar. */
function paintTopbarUser() {
  if (!App.user) return;
  document.getElementById("topbar-user-name").textContent = App.user.full_name;
  document.getElementById("topbar-user-role").textContent = App.user.role;
  document.getElementById("topbar-avatar").textContent = App.user.full_name.charAt(0).toUpperCase();
}

// =====================================================================
// VIEW: DASHBOARD — dengan filter global (agent + rentang tanggal)
// Filter disimpan di dashboardState agar bertahan saat pindah halaman;
// "Terapkan" memicu renderDashboard() ulang (kartu, chart, tabel).
// =====================================================================
const dashboardState = { agentId: "", startDate: "", endDate: "" };

/** Query params filter utk /dashboard/stats & /dashboard/charts. */
function dashboardFilterParams() {
  const params = {};
  if (dashboardState.agentId) params.agent_id = dashboardState.agentId;
  if (dashboardState.startDate) params.start_date = dashboardState.startDate;
  if (dashboardState.endDate) params.end_date = dashboardState.endDate;
  return params;
}

/** Isi dropdown agent filter dashboard.
 *  Superadmin: "Semua Agent" + seluruh agent (bebas memilih).
 *  Admin: terkunci (disabled) ke agent penugasannya — backend juga
 *  memaksa scoping yang sama, jadi UI hanya mencerminkan kebijakan itu. */
async function populateDashboardAgentFilter() {
  const select = document.getElementById("dash-filter-agent");
  if (!select) return;
  try {
    const res = await Api.get("/agents");
    const agents = res.data || [];
    if (App.user && App.user.role === "superadmin") {
      select.innerHTML =
        `<option value="">Semua Agent</option>` +
        agents
          .map(
            (a) => `<option value="${esc(a.agent_id)}">${esc(a.name || a.agent_id)}</option>`
          )
          .join("");
      select.disabled = false;
      select.value = dashboardState.agentId; // pertahankan pilihan tersimpan
    } else {
      // Daftar dari backend untuk admin memang hanya berisi agent penugasannya
      const own = agents[0];
      select.innerHTML = own
        ? `<option value="${esc(own.agent_id)}">${esc(own.name || own.agent_id)}</option>`
        : `<option value="">— tidak ada penugasan —</option>`;
      select.disabled = true;
      dashboardState.agentId = own ? own.agent_id : "";
    }
  } catch (e) {
    /* biarkan opsi default — dashboard tetap tampil tanpa filter agent */
  }
}

/** Baca input filter -> simpan ke state. Kembalikan pesan error / null. */
function applyDashboardFilters() {
  const agentId = document.getElementById("dash-filter-agent").value;
  const start = document.getElementById("dash-filter-start").value;
  const end = document.getElementById("dash-filter-end").value;
  if (start && end && start > end) {
    return "Tanggal mulai tidak boleh setelah tanggal akhir.";
  }
  dashboardState.agentId = agentId;
  dashboardState.startDate = start;
  dashboardState.endDate = end;
  return null;
}

async function renderDashboard() {
  paintTopbarUser();
  // Hero banner: sapa username admin yang sedang login
  const heroName = document.getElementById("hero-username");
  if (heroName && App.user) heroName.textContent = App.user.username;

  const statsEl = document.getElementById("dashboard-stats");
  const recentEl = document.getElementById("dashboard-recent");
  setLoading(statsEl);
  recentEl.innerHTML = emptyRow(6, "Memuat...");

  await populateDashboardAgentFilter();
  const res = await Api.get("/dashboard/stats", dashboardFilterParams());
  const s = res.data;

  // Chart paralel: kegagalan endpoint chart tidak boleh menggagalkan
  // render kartu statistik & tabel aktivitas.
  renderDashboardCharts().catch((e) => showToast(e.message, "error"));

  // Kartu statistik khusus aplikasi Customer Service (fitur pulsa sudah
  // dimatikan): aktivitas percakapan, pemakaian AI, hasil unreg DCB,
  // dan moderasi (blokir / mode manual). RBAC: kartu "Biaya AI Bulan Ini"
  // hanya untuk superadmin (backend pun hanya mengirim nilainya ke superadmin).
  const isSuper = App.user && App.user.role === "superadmin";
  const cards = [
    {
      label: "Total Pelanggan", value: s.total_customers, color: "bg-red-600",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>`,
    },
    {
      label: "Chat Hari Ini", value: s.chats_today, color: "bg-red-400",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"/>`,
    },
    {
      label: "Total Chat", value: s.total_chats, color: "bg-gray-800",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8l-3.5 1.5 1.2-3.2C4.2 15.9 3 14.1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>`,
    },
    {
      label: "Balasan AI Hari Ini", value: s.ai_replies_today, color: "bg-rose-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9.5 16.75c-.283.66-.68 1.256-1.178 1.77a5.517 5.517 0 01-1.82 1.187 5.5 5.5 0 01-4.29.093 5.486 5.486 0 01-1.817-1.13 5.5 5.5 0 01-1.664-4.238 5.5 5.5 0 011.596-3.988m8.916 8.457L12 21l3.5-3.5m-3.187 2.404l.844-.844m6.255-6.256l.844-.844M18.596 8.5l.844-.844M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-8.5 5.5a7.5 7.5 0 01-7.5-7.5 7.5 7.5 0 017.5-7.5 7.5 7.5 0 017.5 7.5 7.5 7.5 0 01-7.5 7.5z"/>`,
    },
    // Disisipkan kondisional: role admin tidak melihat biaya AI (RBAC)
    ...(isSuper
      ? [
          {
            label: "Biaya AI Bulan Ini", value: formatIDR(s.ai_cost_month), color: "bg-red-700",
            icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>`,
          },
        ]
      : []),
    {
      label: "Unreg Berhasil", value: s.unreg_success, color: "bg-gray-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    },
    {
      label: "Pengguna Diblokir", value: s.blocked_users, color: "bg-red-800",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>`,
    },
    {
      label: "Mode Manual Aktif", value: s.manual_mode_users, color: "bg-red-300",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>`,
    },
  ];

  statsEl.innerHTML = cards
    .map(
      (c) => `
      <div class="relative overflow-hidden bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 flex items-center gap-4">
        <div class="w-2 self-stretch rounded-full ${c.color}"></div>
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">${esc(c.label)}</p>
          <p class="text-3xl font-extrabold tracking-tighter text-black mt-0.5">${esc(c.value)}</p>
        </div>
        <svg class="w-12 h-12 text-slate-200 flex-shrink-0 ml-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
          ${c.icon}
        </svg>
      </div>`
    )
    .join("");

  // Ringkasan aktivitas chat terbaru (pengganti "Pesanan Terbaru")
  recentEl.innerHTML = s.recent_chats && s.recent_chats.length
    ? s.recent_chats
        .map(
          (c) => `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="px-5 py-3 font-semibold text-slate-800">${esc(c.full_name)}</td>
          <td class="px-5 py-3 font-mono text-xs text-slate-500">${esc(formatPlatformId(c.platform_id, c.channel))}</td>
          <td class="px-5 py-3">${statusBadge(c.channel)}</td>
          <td class="px-5 py-3"><span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600">${esc(c.agent_id)}</span></td>
          <td class="px-5 py-3 text-slate-600 max-w-xs truncate" title="${esc(c.input)}">${esc(c.input)}</td>
          <td class="px-5 py-3 text-slate-500 whitespace-nowrap">${formatDateTime(c.created_at)}</td>
        </tr>`
        )
        .join("")
    : emptyRow(6);
}

// =====================================================================
// CHART DASHBOARD (Chart.js) — penggunaan model AI & tren pelanggan
// Instansi disimpan agar chart lama di-destroy sebelum render ulang
// (Chart.js tidak boleh dibuat dua kali di canvas yang sama).
// =====================================================================
const dashboardCharts = { models: null, users: null };

async function renderDashboardCharts() {
  if (typeof Chart === "undefined") return; // CDN gagal — lewati diam-diam

  const res = await Api.get("/dashboard/charts", dashboardFilterParams());
  const { models, users } = res.data; // models = undefined untuk role admin (RBAC)

  // Tipografi chart mengikuti UI (Plus Jakarta Sans)
  Chart.defaults.font.family = "Plus Jakarta Sans, sans-serif";

  if (dashboardCharts.models) dashboardCharts.models.destroy();
  if (dashboardCharts.users) dashboardCharts.users.destroy();

  // 1. Bar chart RINCIAN HARIAN biaya AI — satu dataset per model
  // (bertumpuk per tanggal), tooltip menampilkan tanggal + model + biaya.
  // Kartu + datanya hanya ada untuk superadmin. Palet Telkomsel: merah
  // dominan, ditopang abu gelap & abu muda.
  const modelsCtx = models ? document.getElementById("chart-models") : null;
  if (modelsCtx && models.datasets) {
    const palette = ["#dc2626", "#111827", "#9ca3af", "#f87171", "#6b7280", "#fca5a5"];
    dashboardCharts.models = new Chart(modelsCtx, {
      type: "bar",
      data: {
        labels: models.labels,
        datasets: models.datasets.map((d, i) => ({
          label: d.model,
          data: d.values,
          backgroundColor: palette[i % palette.length],
          borderRadius: 4,
          maxBarThickness: 28,
          stack: "biaya",
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            // Legenda hanya mengganggu bila modelnya satu
            display: models.datasets.length > 1,
            position: "bottom",
            labels: { boxWidth: 10, boxHeight: 10 },
          },
          tooltip: {
            callbacks: {
              title: (items) => (items[0] ? items[0].label : ""),
              label: (ctx) => ` ${ctx.dataset.label}: ${formatIDR(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false } },
          y: {
            stacked: true,
            grid: { display: false },
            border: { display: false },
            ticks: { callback: (v) => formatIDR(v) },
          },
        },
      },
    });
  }

  // 2. Line chart tren pelanggan 7 hari — kurva halus + area transparan
  const usersCtx = document.getElementById("chart-users");
  if (usersCtx) {
    dashboardCharts.users = new Chart(usersCtx, {
      type: "line",
      data: {
        labels: users.labels,
        datasets: [
          {
            data: users.values,
            borderColor: "#dc2626",
            backgroundColor: "rgba(220, 38, 38, 0.08)",
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => `${ctx.parsed.y} pelanggan` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { precision: 0 },
          },
        },
      },
    });
  }
}

// =====================================================================
// VIEW: CHATS — sistem dua tampilan: pilih agent -> chat per agent
// Tahap 1    : daftar kartu agent   -> #chat-agent-view
// Tahap 2    : layout 2-pane WhatsApp -> #chat-room-view
//              Pane kiri  : kontak dari GET /chats/users/<agent_id>
//              Pane kanan : percakapan dari GET /chats/<agent_id>/<user_id>
// Kontak diidentifikasi lewat user_id (users.id) — mendukung pengguna
// Telegram maupun WhatsApp (kolom channel/platform_id).
// =====================================================================
const chatsState = {
  agentId: null,
  activeId: null,
  users: [],
  meta: null, // meta paginasi daftar kontak {page, per_page, total, total_pages}
  isManualMode: false,
  channelFilter: "all", // disaring di sisi server (query ?channel=)
  page: 1, // halaman kontak aktif (10 kontak/halaman)
};

// Tombol filter channel pane kiri chat: Semua (default, abu gelap netral) /
// WhatsApp (hijau) / Telegram (biru). Nonaktif = abu redup.
const CHANNEL_FILTER_UI = {
  all: { btn: "filter-all", active: "bg-gray-900 text-white shadow-sm" },
  whatsapp: { btn: "filter-wa", active: "bg-green-500 text-white shadow-sm", label: "WhatsApp" },
  telegram: { btn: "filter-tg", active: "bg-blue-500 text-white shadow-sm", label: "Telegram" },
  inactive: "bg-gray-100 text-gray-500 hover:bg-gray-200",
};

/** Cat ulang ketiga tombol filter sesuai chatsState.channelFilter. */
function applyChannelFilterUI() {
  for (const channel of ["all", "whatsapp", "telegram"]) {
    const ui = CHANNEL_FILTER_UI[channel];
    const active = chatsState.channelFilter === channel;
    document.getElementById(ui.btn).className = `flex-1 px-2 py-2.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
      active ? ui.active : CHANNEL_FILTER_UI.inactive
    }`;
  }
}

/** Klik filter: saring lewat server (?channel=) lalu ambil ulang halaman 1.
 *  "all" = universal inbox (tanpa parameter channel). */
function setChannelFilter(channel) {
  if (chatsState.channelFilter === channel) return; // tidak ada perubahan
  chatsState.channelFilter = channel;
  chatsState.page = 1;
  applyChannelFilterUI();
  renderChatUserListPane().catch((e) => showToast(e.message, "error"));
}

/** Jam:menit untuk gelembung pesan. */
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

/** Entry point route #chats: selalu mulai dari daftar agent (Tahap 1). */
function renderChats() {
  showChatAgentPicker();
}

/** Tampilkan Tahap 1 (pilih agent) dan reset seluruh state chat. */
function showChatAgentPicker() {
  chatsState.agentId = null;
  chatsState.activeId = null;
  chatsState.isManualMode = false;

  document.getElementById("chat-room-view").classList.add("hidden");
  document.getElementById("chat-agent-view").classList.remove("hidden");
  applyManualModeUI(); // kembalikan toggle/input ke kondisi netral
  renderChatAgentCards();
}

/** Tampilkan Tahap 2 (jendela chat) untuk agent terpilih. */
function selectChatAgent(agentId) {
  chatsState.agentId = agentId;
  chatsState.activeId = null;
  chatsState.page = 1; // agent baru -> mulai dari halaman kontak pertama

  // Kosongkan sisa UI percakapan agent sebelumnya (spec: back = clear UI)
  document.getElementById("chat-header-name").textContent = "—";
  document.getElementById("chat-header-id").textContent = "—";
  document.getElementById("chat-header-avatar").textContent = "?";
  document.getElementById("chat-bubbles").innerHTML = "";
  paintChatPanes(); // tampilkan empty state "Pilih pengguna..."

  document.getElementById("chat-agent-view").classList.add("hidden");
  document.getElementById("chat-room-view").classList.remove("hidden");
  renderChatUserListPane();
}

/** Tahap 1: render grid kartu agent dari GET /api/agents. */
async function renderChatAgentCards() {
  const grid = document.getElementById("chat-agents-grid");
  setLoading(grid);

  let agents;
  try {
    const res = await Api.get("/agents");
    agents = res.data;
  } catch (e) {
    grid.innerHTML = `
      <div class="col-span-full bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10 text-center">
        <p class="text-sm text-slate-500">${esc(e.message)}</p>
      </div>`;
    return;
  }

  if (!agents.length) {
    // Pesan dari backend membedakan "belum ada agent" (superadmin) vs
    // "belum ada penugasan" (admin) — selaras filter RBAC /api/agents.
    grid.innerHTML = `
      <div class="col-span-full bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10 text-center">
        <p class="text-slate-500">🤖 ${esc(res.message || "Belum ada agent terdaftar.")}</p>
      </div>`;
    return;
  }

  grid.innerHTML = agents
    .map(
      (a) => `
    <button type="button" data-chat-agent="${esc(a.agent_id)}"
      class="text-left bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-600">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="text-3xl">${esc(AGENT_CARD_EMOJI[a.agent_id] || "🤖")}</div>
        ${agentActiveBadge(a.is_active)}
      </div>
      <h4 class="font-extrabold tracking-tighter text-black">${esc(a.name || a.agent_id)}</h4>
      <p class="text-xs text-slate-400 font-mono mb-3">ID: ${esc(a.agent_id)}</p>
      <span class="text-xs text-slate-500">Pantau percakapan agent ini →</span>
    </button>`
    )
    .join("");

  grid.querySelectorAll("[data-chat-agent]").forEach((card) => {
    card.addEventListener("click", () => selectChatAgent(card.dataset.chatAgent));
  });
}

/** Terapkan visibilitas pane sesuai ada/tidaknya percakapan terpilih.
 *  Mobile: hanya satu pane tampil (daftar <-> chat). Desktop: keduanya. */
function paintChatPanes() {
  const hasUser = !!chatsState.activeId;
  const listPane = document.getElementById("chat-list-pane");
  const winPane = document.getElementById("chat-window-pane");
  const header = document.getElementById("chat-window-header");
  const emptyState = document.getElementById("chat-empty-state");
  const bubbles = document.getElementById("chat-bubbles");

  listPane.className = hasUser
    ? "hidden md:block md:col-span-1 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col min-h-0"
    : "md:col-span-1 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col min-h-0";
  winPane.className = hasUser
    ? "flex md:col-span-2 lg:col-span-3 flex-col min-h-0"
    : "hidden md:flex md:col-span-2 lg:col-span-3 flex-col min-h-0";
  header.classList.toggle("hidden", !hasUser);
  header.classList.toggle("flex", hasUser);
  emptyState.classList.toggle("hidden", hasUser);
  bubbles.classList.toggle("hidden", !hasUser);
}

/** Ambil daftar kontak agent terpilih (terpaginasi 10/halaman + filter
 *  channel di sisi server) lalu render pane kirinya. */
async function renderChatUserListPane() {
  const listEl = document.getElementById("chat-user-list");
  setLoading(listEl);

  const params = { page: chatsState.page, per_page: 10 };
  if (chatsState.channelFilter !== "all") {
    params.channel = chatsState.channelFilter;
  }
  const res = await Api.get(
    `/chats/users/${encodeURIComponent(chatsState.agentId)}`,
    params
  );
  chatsState.users = res.data;
  chatsState.meta = res.meta || null;
  if (res.meta) chatsState.page = res.meta.page;

  // Pertahankan seleksi bila pengguna masih ada di daftar
  if (chatsState.activeId && !chatsState.users.some((u) => u.user_id === chatsState.activeId)) {
    chatsState.activeId = null;
  }

  renderChatUserList();
  paintChatPanes();
  if (chatsState.activeId) await loadChatConversation(chatsState.activeId);
}

/** Render pane kiri: kontak diurutkan dari pesan terbaru.
 *  Penyaringan channel & halaman sudah dilakukan server —
 *  chatsState.users berisi persis kontak halaman aktif. */
function renderChatUserList() {
  const listEl = document.getElementById("chat-user-list");
  const visibleUsers = chatsState.users;
  const emptyText =
    chatsState.channelFilter === "all"
      ? "💤 Bot sedang istirahat. Belum ada pengguna yang chat dengan agent ini."
      : `💤 Belum ada pengguna ${CHANNEL_FILTER_UI[chatsState.channelFilter].label} yang chat.`;

  listEl.innerHTML = visibleUsers.length
    ? visibleUsers
        .map((u) => {
          const isActive = u.user_id === chatsState.activeId;
          const name = u.full_name || u.username || `User ${u.platform_id}`;
          const channelBadge = u.channel === "whatsapp"
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">WA</span>`
            : `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold">TG</span>`;
          return `
      <button data-user-id="${esc(u.user_id)}"
        class="w-full text-left px-4 py-3 flex items-center gap-3 transition ${
          isActive ? "bg-gray-100" : "hover:bg-slate-50"
        }">
        <div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
          isActive ? "bg-gray-900 text-white" : "bg-slate-200 text-slate-600"
        }">${esc(name.charAt(0).toUpperCase())}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold ${isActive ? "text-black" : "text-slate-800"} truncate">${esc(name)}</p>
            <span class="text-[10px] text-slate-400 whitespace-nowrap">${formatTime(u.last_message_at)}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-slate-500 font-mono truncate">${esc(formatPlatformId(u.platform_id, u.channel))}</p>
            <span class="flex items-center gap-1 flex-shrink-0">
              ${channelBadge}
              ${u.user_id !== chatsState.activeId ? unreadBadgeHTML(u.unread_count) : ""}
              ${u.is_manual_mode ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 font-semibold">Manual</span>` : ""}
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">${u.total_messages} pesan</span>
            </span>
          </div>
        </div>
      </button>`;
        })
        .join("")
    : `<div class="px-4 py-10 text-center text-sm text-slate-400">${esc(emptyText)}</div>`;

  listEl.querySelectorAll("button[data-user-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectChatUser(Number(btn.dataset.userId)));
  });

  // Footer paginasi pane kiri (varian ringkas: ‹ 2/5 ›)
  renderPagination(
    document.getElementById("chat-list-pagination"),
    chatsState.meta,
    (p) => {
      chatsState.page = p;
      renderChatUserListPane().catch((e) => showToast(e.message, "error"));
      // Kontak halaman baru mulai dari atas pane (ganti halaman, bukan render awal)
      document.getElementById("chat-user-list").scrollTop = 0;
    },
    { compact: true }
  );
}

/** Badge lingkaran bernomor "belum dibaca" — hanya tampil bila count > 0. */
function unreadBadgeHTML(count) {
  const n = Number(count || 0);
  if (n <= 0) return "";
  return `<span class="unread-badge min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0" title="${n} pesan belum dibaca">${n > 99 ? "99+" : n}</span>`;
}

/** Klik kontak: ambil & render percakapan, lalu gulir ke bawah.
 *  Badge unread dihapus di UI, lalu hitungan di DB direset di belakang
 *  layar lewat POST /api/sessions/<id>/mark_read. */
async function selectChatUser(userId) {
  chatsState.activeId = userId;
  const user = chatsState.users.find((u) => u.user_id === userId);
  if (user && (user.unread_count || 0) > 0) {
    user.unread_count = 0; // kosongkan segera di state lokal
    markSessionRead(user.session_id); // reset DB di belakang layar
  }
  renderChatUserList(); // perbarui sorotan kontak aktif (badge hilang)
  paintChatPanes();     // di mobile: pindah dari daftar ke jendela chat
  await loadChatConversation(userId);
}

/** Reset unread_count percakapan di database (best-effort, tanpa await
 *  wajib — kegagalan jaringan tidak boleh mengganggu alasan admin). */
function markSessionRead(sessionId) {
  if (!sessionId) return;
  Api.post(`/sessions/${sessionId}/mark_read`).catch(() => {});
}

/** Ambil riwayat percakapan pengguna dan render sebagai gelembung.
 *  Sekaligus sinkronkan status Manual Mode pada toggle & input. */
async function loadChatConversation(userId) {
  const bubblesEl = document.getElementById("chat-bubbles");
  setLoading(bubblesEl);

  const res = await Api.get(
    `/chats/${encodeURIComponent(chatsState.agentId)}/${encodeURIComponent(userId)}`
  );
  const conv = res.data;

  // Header jendela chat: nama + platform ID pengguna terpilih
  const name = conv.full_name || conv.username || `User ${conv.platform_id}`;
  const channelLabel = conv.channel === "whatsapp" ? "WhatsApp" : "Telegram";
  document.getElementById("chat-header-name").textContent = name;
  document.getElementById("chat-header-id").textContent = `${channelLabel} · ${formatPlatformId(conv.platform_id, conv.channel)}`;
  document.getElementById("chat-header-avatar").textContent = name.charAt(0).toUpperCase();

  // Status Human Takeover user ini -> UI toggle & input
  chatsState.isManualMode = !!conv.is_manual_mode;
  bubblesEl.innerHTML = conv.messages.map(buildMessageBubbleHTML).join("");
  applyManualModeUI();

  // Gulir otomatis ke pesan terbaru di bagian bawah
  requestAnimationFrame(() => {
    const win = document.getElementById("chat-window");
    win.scrollTop = win.scrollHeight;
  });
}

/**
 * Bangun HTML satu giliran percakapan — perspektif ADMIN PANEL:
 * - Pesan pelanggan (input) -> KIRI, gelembung putih (pesan masuk).
 * - Balasan sistem AI/admin (output) -> KANAN, gelembung hijau (pesan
 *   keluar) beserta indikator model_name yang dipakai.
 * Balasan admin manual (model_name "Human/Admin") tidak memiliki pesan
 * pelanggan sungguhan (input hanya penanda "[Admin Reply]"), sehingga
 * hanya gelembung keluarnya yang dirender.
 */
function buildMessageBubbleHTML(m) {
  const time = formatTime(m.created_at);
  const isAdminReply = m.model_name === "Human/Admin";

  // 1. Pesan masuk dari pelanggan -> kiri (justify-start), gelembung putih
  const incoming = isAdminReply
    ? ""
    : `
    <div class="flex justify-start">
      <div class="max-w-[85%] md:max-w-[70%]">
        <div class="bg-white rounded-2xl rounded-bl-sm px-4 py-2 shadow-sm">
          <p class="text-sm text-slate-800 whitespace-pre-wrap break-words">${esc(m.input)}</p>
          <p class="text-[10px] text-right text-slate-400 mt-1">${time}</p>
        </div>
      </div>
    </div>`;

  // 2. Pesan keluar dari sistem (AI/admin) -> kanan (justify-end), hijau
  const outgoing = `
    <div class="flex justify-end" data-msg-id="${m.id ?? ""}">
      <div class="max-w-[80%] md:max-w-[65%]">
        <div class="bg-[#d9fdd3] rounded-2xl rounded-br-sm px-4 py-2 shadow-sm">
          <p class="text-sm text-slate-800 whitespace-pre-wrap break-words">${esc(m.output)}</p>
          <div class="flex items-center justify-end gap-2 mt-1">
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/70 text-emerald-700 font-medium">${esc(m.model_name || "bot")}</span>
            <span class="text-[10px] text-emerald-800/50">${time}</span>
          </div>
        </div>
      </div>
    </div>`;

  return incoming + outgoing;
}

// =====================================================================
// NOTIFIKASI REAL-TIME (Socket.IO) — pesan masuk WhatsApp / Telegram.
// Backend mem-emit event 'new_incoming_message' begitu pesan diterima
// webhook; admin mendengar suara, melihat push notification browser,
// dan UI Riwayat Chat terupdate tanpa reload.
// =====================================================================
const notifSound = new Audio("/static/sounds/notif.mp3");
notifSound.preload = "auto";

const socket = io(); // default: origin yang sama dengan Admin Panel

socket.on("new_incoming_message", (data) => {
  // 1. Suara notifikasi — .play() bisa ditolak Autoplay Policy browser;
  //    tangkap errornya agar tidak menghentikan update UI.
  notifSound.play().catch(() => console.log("Autoplay blocked"));

  // 2. Browser push notification (hanya bila izin sudah diberikan)
  if (window.Notification && Notification.permission === "granted") {
    try {
      new Notification("Pesan Baru dari " + data.name, {
        body: data.message_snippet,
      });
    } catch (e) {
      /* beberapa browser melempar bila halaman tak fokus — abaikan */
    }
  }

  // 3. Update UI Riwayat Chat
  handleIncomingMessageUi(data);
});

/** Minta izin notifikasi sekali — dipanggil saat pengguna sudah masuk
 *  aplikasi (bukan di halaman login) dan hanya bila belum diminta. */
function requestNotificationPermission() {
  if (window.Notification && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/** Bubble pesan masuk tunggal (kiri, putih) — dipakai injeksi real-time. */
function buildIncomingBubbleHTML(data) {
  return `
    <div class="flex justify-start">
      <div class="max-w-[85%] md:max-w-[70%]">
        <div class="bg-white rounded-2xl rounded-bl-sm px-4 py-2 shadow-sm">
          <p class="text-sm text-slate-800 whitespace-pre-wrap break-words">${esc(data.message_snippet)}</p>
          <p class="text-[10px] text-right text-slate-400 mt-1">${formatTime(data.timestamp)}</p>
        </div>
      </div>
    </div>`;
}

/** Update DOM Riwayat Chat akibat pesan masuk:
 *  1. Kartu user di sidebar di-prepend ke atas (urutan terbaru).
 *  2. Badge unread bernomor — diambil dari unread_count hasil increment
 *     di database (payload Socket.IO), bukan dihitung manual di frontend.
 *  3. Chat aktif yang cocok langsung menerima bubble pesan barunya; admin
 *     sedang membaca -> hitungan di DB direset otomatis (mark_read).
 * Kontak yang belum ada di daftar -> daftar di-refresh dari server. */
function handleIncomingMessageUi(data) {
  if (currentRouteName() !== "chats") return;  // bukan halaman Riwayat Chat
  if (!chatsState.agentId || data.agent_id !== chatsState.agentId) return;

  const listEl = document.getElementById("chat-user-list");
  if (!listEl) return;

  const isActiveChat = chatsState.activeId === data.user_id;
  const user = chatsState.users.find((u) => u.user_id === data.user_id);
  if (user) {
    user.unread_count = data.unread_count ?? user.unread_count;
    user.session_id = data.session_id ?? user.session_id;
  }

  const card = listEl.querySelector(`button[data-user-id="${data.user_id}"]`);
  if (card) {
    listEl.prepend(card); // pesan terbaru selalu di atas

    // Perbarui badge unread pada kartu sesuai angka terbaru dari DB
    card.querySelector(".unread-badge")?.remove();
    if (!isActiveChat) {
      const badgeHost = card.querySelector("span.flex.items-center.gap-1");
      if (badgeHost && user) {
        badgeHost.insertAdjacentHTML("afterbegin", unreadBadgeHTML(user.unread_count));
      }
    }
  } else {
    // Kartu belum ada di halaman aktif (kontak baru, atau pesan masuk
    // membuat kontak melompat ke halaman 1) — kembali ke halaman pertama
    // dan ambil ulang; badge-nya dirender otomatis dari unread_count DB.
    chatsState.page = 1;
    renderChatUserListPane().catch(() => {});
    return;
  }

  // Chat yang sedang dibuka -> suntik bubble pesan masuk + scroll ke bawah;
  // admin jelas sedang membaca -> reset hitungan di DB secara diam-diam
  // agar badge tidak muncul palsu saat daftar berikutnya dimuat.
  if (isActiveChat) {
    if (user && user.unread_count > 0) {
      user.unread_count = 0;
      markSessionRead(user.session_id);
    }
    const bubblesEl = document.getElementById("chat-bubbles");
    if (bubblesEl) {
      bubblesEl.insertAdjacentHTML("beforeend", buildIncomingBubbleHTML(data));
      const win = document.getElementById("chat-window");
      if (win) win.scrollTop = win.scrollHeight;
    }
  }
}

/** Terapkan status Manual Mode ke toggle, input, dan tombol kirim.
 *  OFF: input & tombol disabled + placeholder sesuai spesifikasi.
 *  ON : input & tombol aktif, admin bisa mengetik balasan. */
function applyManualModeUI() {
  const isManual = !!chatsState.isManualMode;
  const toggle = document.getElementById("chat-manual-toggle");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");
  const label = document.getElementById("chat-manual-label");

  toggle.checked = isManual;
  input.disabled = !isManual;
  sendBtn.disabled = !isManual;
  input.placeholder = isManual
    ? "Ketik balasan Anda untuk pengguna ini..."
    : "AI is currently handling this chat. Turn on Manual Mode to reply.";
  label.textContent = isManual ? "Manual Mode: ON" : "Manual Mode";
  label.className = `text-xs font-medium ${isManual ? "text-gray-900" : "text-slate-500"}`;
}

/** Kirim pesan manual admin ke pengguna (Telegram/WhatsApp sesuai channel).
 *  Pesan langsung ditambahkan ke UI tanpa menunggu reload percakapan. */
async function sendManualMessage() {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");
  const message = input.value.trim();

  if (!message || !chatsState.activeId) return;
  if (!chatsState.isManualMode) {
    showToast("Aktifkan Manual Mode terlebih dahulu.", "error");
    return;
  }

  input.disabled = true;
  sendBtn.disabled = true;
  try {
    // Balasan dikirim ke user_id terpilih (backend pilih jalur Telegram/
    // WAHA sesuai channel-nya) dari identitas bot milik agent terpilih —
    // payload WAJIB memuat agent_id & user_id.
    const res = await Api.post("/chats/reply", {
      user_id: chatsState.activeId,
      agent_id: chatsState.agentId,
      message,
    });

    // Tambahkan gelembung balasan admin ( Human/Admin ) ke ujung bawah
    const bubblesEl = document.getElementById("chat-bubbles");
    bubblesEl.insertAdjacentHTML("beforeend", buildMessageBubbleHTML(res.data));
    requestAnimationFrame(() => {
      const win = document.getElementById("chat-window");
      win.scrollTop = win.scrollHeight;
    });

    input.value = "";
    showToast(res.message);
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// =====================================================================
// VIEW: AGENT CONFIG (superadmin) — sistem dua tampilan
// View 1 (default): daftar kartu agent -> #agent-list-view
// View 2          : form konfigurasi  -> #agent-form-view
// =====================================================================
let currentSelectedAgent = null; // agent yang form-nya sedang dibuka

// Emoji kartu per agent_id (agent baru memakai emoji default)
const AGENT_CARD_EMOJI = {
  pulsa_agent: "🤖",
  cs_agent: "🎧",
};

/** Entry point route #agent-config: selalu mulai dari daftar agent. */
function renderAgentConfig() {
  showAgentList();
}

/** Tampilkan View 1 (daftar agent) dan sembunyikan form. */
function showAgentList() {
  currentSelectedAgent = null;
  stopWahaQrPolling(); // polling QR milik form yang ditinggalkan — matikan
  document.getElementById("agent-form-view").classList.add("hidden");
  document.getElementById("agent-list-view").classList.remove("hidden");
  renderAgentCards();
}

/** Tampilkan View 2 (form) untuk agent tertentu. */
function showAgentForm(agentId) {
  currentSelectedAgent = agentId;
  document.getElementById("agent-list-view").classList.add("hidden");
  document.getElementById("agent-form-view").classList.remove("hidden");
  renderAgentForm(agentId);
}

/** Badge status aktif agent untuk kartu (View 1). */
function agentActiveBadge(isActive) {
  return isActive
    ? `<span class="px-2.5 py-0.5 inline-flex items-center text-xs font-medium rounded-full bg-emerald-100 text-emerald-800">🟢 Aktif</span>`
    : `<span class="px-2.5 py-0.5 inline-flex items-center text-xs font-medium rounded-full bg-slate-200 text-slate-700">🔴 Non-Aktif</span>`;
}

/**
 * View 1: render grid kartu agent dari GET /api/agents.
 * Dinamis agar agent hasil "Tambah Agent" langsung tampil saat daftar
 * dimuat ulang (bukan lagi kartu statis di HTML).
 */
async function renderAgentCards() {
  const grid = document.getElementById("agent-cards-grid");
  setLoading(grid);

  let agents;
  try {
    const res = await Api.get("/agents");
    agents = res.data;
  } catch (e) {
    grid.innerHTML = `
      <div class="col-span-full bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10 text-center">
        <p class="text-sm text-slate-500">${esc(e.message)}</p>
      </div>`;
    return;
  }

  if (!agents.length) {
    grid.innerHTML = `
      <div class="col-span-full bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10 text-center">
        <p class="text-slate-500">🤖 Bot siap menerima tugas — tapi belum ada agent terdaftar.</p>
        <p class="text-sm text-slate-400 mt-1">Gunakan tombol “+ Tambah Agent” untuk membuat agent pertama.</p>
      </div>`;
    return;
  }

  grid.innerHTML = agents
    .map(
      (a) => `
    <button type="button" data-agent-card="${esc(a.agent_id)}"
      class="text-left bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-600">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="text-3xl">${esc(AGENT_CARD_EMOJI[a.agent_id] || "🤖")}</div>
        ${agentActiveBadge(a.is_active)}
      </div>
      <h4 class="font-extrabold tracking-tighter text-black">${esc(a.name || a.agent_id)}</h4>
      <p class="text-xs text-slate-400 font-mono mb-3">ID: ${esc(a.agent_id)}</p>
      <!-- Info kontak: nomor WA per sesi WAHA + ID bot Telegram.
           Kecil & abu-abu agar tidak bersaing dgn nama agent. -->
      <div class="space-y-1 text-xs text-slate-500 mb-3">
        <p class="flex items-center gap-1.5 min-w-0" title="Nomor WhatsApp yang tertaut pada sesi WAHA agent ini">
          <svg class="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/>
          </svg>
          <span class="truncate">Nomor WA: ${
            a.wa_phones && a.wa_phones.length
              ? a.wa_phones.map(esc).join(", ")
              : "—"
          }</span>
        </p>
        <p class="flex items-center gap-1.5 min-w-0" title="ID bot Telegram (dari token yang tersimpan)">
          <svg class="w-3.5 h-3.5 flex-shrink-0 text-sky-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
          </svg>
          <span class="truncate font-mono">ID Telegram: ${a.telegram_bot_id ? esc(a.telegram_bot_id) : "—"}</span>
        </p>
      </div>
      <span data-card-status class="text-xs text-slate-500">Terakhir diubah: ${formatDateTime(a.updated_at)}</span>
    </button>`
    )
    .join("");

  // Kartu dirender dinamis -> listener dipasang setiap kali render
  grid.querySelectorAll("[data-agent-card]").forEach((card) => {
    card.addEventListener("click", () => showAgentForm(card.dataset.agentCard));
  });
}

/**
 * Toggle ikon mata pada input token: selang-seling type password <-> text.
 * Dipasang pada tombol bertanda data-token-toggle yang bersebelahan
 * (satu container) dengan input bertanda data-token-input.
 */
function bindTokenEyeToggle(scope) {
  scope.querySelectorAll("[data-token-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("[data-token-input]");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "🙈" : "👁️";
      btn.title = show ? "Sembunyikan token" : "Tampilkan token";
    });
  });
}

/** View 2: render form konfigurasi untuk SATU agent. */
async function renderAgentForm(agentId) {
  const container = document.getElementById("agent-configs-container");
  setLoading(container);

  // Ambil konfigurasi (detail lengkap: token & prompt) dan daftar model
  const [cfgRes, modelRes] = await Promise.all([
    Api.get("/agent/config"),
    Api.get("/agent/models"),
  ]);
  const configs = cfgRes.data;
  const modelOptions = modelRes.data
    .map((m) => `<option value="${esc(m.agent_name)}">${esc(m.agent_name)}</option>`)
    .join("");
  const cfg = configs.find((c) => c.agent_id === agentId);

  if (!cfg) {
    container.innerHTML = `
    <div class="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10 text-center">
      <p class="text-slate-500">🤖 Konfigurasi untuk agent
        <span class="font-mono font-semibold">${esc(agentId)}</span> belum ada di database.</p>
      <p class="text-sm text-slate-400 mt-2">Tekan “⬅ Kembali” lalu tambahkan baris konfigurasinya terlebih dahulu.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="w-full bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8">
      <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 class="text-xl font-extrabold tracking-tighter text-black">${esc(cfg.agent_id)}</h3>
          <p class="text-xs text-slate-400">Terakhir diubah: ${formatDateTime(cfg.updated_at)}</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">${esc(cfg.provider)}</span>
          <button type="button" id="btn-generate-qr" title="Tautkan nomor WhatsApp baru untuk agent ini"
            class="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-sm hover:shadow-md transition-all">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/>
            </svg>
            Generate QR WA
          </button>
        </div>
      </div>
      <form data-config-id="${cfg.id}" class="space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Nama Tampilan</label>
            <input name="name" value="${esc(cfg.name || "")}" maxlength="100" placeholder="cth: Bot Pulsa"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Provider</label>
            <input name="provider" value="${esc(cfg.provider)}" required
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600" />
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Temperature (0–2)</label>
            <input name="temperature" type="number" step="0.1" min="0" max="2" value="${esc(cfg.temperature)}" required
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Model</label>
            <select name="model_name"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-600">
              ${modelOptions}
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Telegram Token</label>
          <div class="relative">
            <input name="telegram_token" type="password" data-token-input value="${esc(cfg.telegram_token || "")}"
              autocomplete="off" spellcheck="false"
              class="w-full rounded-xl border border-slate-300 px-3 py-2 pr-12 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
              placeholder="token bot Telegram (BotFather)" />
            <button type="button" data-token-toggle title="Tampilkan token"
              class="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-1 text-base leading-none rounded hover:bg-slate-100">👁️</button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">System Prompt</label>
          <textarea name="system_prompt" rows="12" required
            class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-600">${esc(cfg.system_prompt)}</textarea>
        </div>
        <!-- Toggle aktif: matikan untuk menonaktifkan agent ini sementara -->
        <label class="flex items-center gap-3 cursor-pointer select-none" title="Agent non-aktif tidak akan merespons pengguna">
          <span class="relative inline-block flex-shrink-0">
            <input name="is_active" type="checkbox" class="peer sr-only" ${cfg.is_active ? "checked" : ""} />
            <span class="block w-11 h-6 bg-slate-300 peer-checked:bg-green-600 rounded-full transition-colors duration-200"></span>
            <span class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 peer-checked:translate-x-5"></span>
          </span>
          <span class="text-sm font-medium text-slate-700">Agent Aktif</span>
        </label>
        <div class="flex justify-end">
          <button type="submit" class="inline-flex items-center gap-2 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-600/30 px-6 py-2.5 text-[13px] uppercase tracking-widest font-semibold transition-all">Simpan Perubahan <span aria-hidden="true">→</span></button>
        </div>
      </form>
    </div>`;

  // Pre-select model tersimpan, pasang toggle mata, tombol Generate QR WA,
  // lalu handler submit
  const form = container.querySelector("form[data-config-id]");
  form.querySelector("select[name='model_name']").value = cfg.model_name;
  bindTokenEyeToggle(form);
  container
    .querySelector("#btn-generate-qr")
    .addEventListener("click", () => startWahaSession(agentId));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    try {
      // agent_id diambil dari kartu yang diklik (bukan id baris);
      // telegram_token & is_active ikut tersimpan sesuai kolom baru.
      await Api.put("/agent/config", {
        agent_id: currentSelectedAgent,
        name: fd.get("name"),
        provider: fd.get("provider"),
        temperature: parseFloat(fd.get("temperature")),
        model_name: fd.get("model_name"),
        telegram_token: fd.get("telegram_token"),
        is_active: form.querySelector("input[name='is_active']").checked,
        system_prompt: fd.get("system_prompt"),
      });
      showToast(`Konfigurasi "${currentSelectedAgent}" berhasil disimpan.`);
      renderAgentForm(currentSelectedAgent); // muat ulang data terbaru
    } catch (e) {
      showToast(e.message, "error");
    }
  });

  // Perangkat WhatsApp (WAHA) milik agent ini, tampil di bawah form
  renderAgentWahaDevices(agentId);
}

// ---------------------------------------------------------------------
// MODAL: TAMBAH AGENT BARU (POST /api/agents)
// ---------------------------------------------------------------------
async function handleAgentCreate(event) {
  event.preventDefault();
  const payload = {
    agent_id: document.getElementById("new-agent-id").value.trim(),
    name: document.getElementById("new-agent-name").value.trim(),
    telegram_token: document.getElementById("new-agent-token").value.trim(),
  };
  try {
    const res = await Api.post("/agents", payload);
    showToast(res.message || `Agent "${payload.agent_id}" berhasil dibuat.`);
    closeModal("modal-agent");
    showAgentList(); // segarkan grid kartu agar agent baru langsung terlihat
  } catch (e) {
    showToast(e.message, "error");
  }
}

// =====================================================================
// VIEW: KNOWLEDGE BASE (RAG) — daftar dokumen + upload PDF
// Menu khusus superadmin (RBAC): route diblokir router.js utk role admin
// dan seluruh endpoint /api/knowledge-base bertanda @superadmin_required.
// =====================================================================

/** Format ukuran byte menjadi teks ringkas, cth: 1.2 KB / 3.4 MB. */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1).replace(".", ",")} ${units[i]}`;
}

/** Entry point route #knowledge-base — dipanggil oleh router.js. */
async function renderKnowledgeBase() {
  const isSuper = App.user && App.user.role === "superadmin";

  // Tanpa kolom upload (role admin), daftar dokumen melebar penuh satu baris
  document.getElementById("kb-list-col").classList.toggle("lg:col-span-2", !isSuper);

  // Reset tampilan upload agar bersih setiap kali halaman dibuka
  document.getElementById("kb-upload-form").reset();
  document.getElementById("kb-file-label").textContent = "Klik untuk memilih file PDF";
  document.getElementById("kb-upload-loading").classList.add("hidden");
  document.getElementById("kb-upload-loading").classList.remove("flex");

  kbState.page = 1; // masuk halaman Knowledge Base -> mulai dari halaman pertama
  await Promise.all([fetchDocuments(), populateKbAgentSelect()]);
}

/** Isi dropdown "Milik Agent" (multi-agent dinamis): dokumen bisa
 *  privat satu agent atau bersama utk semua agent. Best-effort —
 *  bila daftar agent gagal diambil, opsi default tetap ada. */
async function populateKbAgentSelect() {
  const select = document.getElementById("kb-agent-select");
  if (!select) return;
  try {
    const res = await Api.get("/agents");
    const agents = res.data.agents || res.data || [];
    select.innerHTML =
      `<option value="">Bersama (semua agent)</option>` +
      agents
        .map(
          (a) => `<option value="${esc(a.agent_id)}">${esc(a.name || a.agent_id)}</option>`
        )
        .join("");
  } catch (e) {
    /* biarkan opsi "Bersama" — upload tetap bisa jalan tanpa pemilik */
  }
}

/** Ambil daftar dokumen dari GET /api/knowledge-base lalu render tabel.
 *  Terpaginasi 10 dokumen/halaman (kbState.page). */
const kbState = { page: 1 };

async function fetchDocuments(page = kbState.page) {
  const tbody = document.getElementById("kb-tbody");
  setLoading(tbody);

  const res = await Api.get("/knowledge-base", { page, per_page: 10 });
  kbState.page = res.meta ? res.meta.page : 1;
  const documents = res.data;
  const isSuper = App.user && App.user.role === "superadmin";

  // Dokumen terakhir halaman terakhir baru dihapus -> mundur satu halaman
  if (!documents.length && res.meta && res.meta.page > 1) {
    return fetchDocuments(res.meta.total_pages);
  }

  tbody.innerHTML = documents.length
    ? documents
        .map(
          (d) => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-5 py-3 min-w-[200px]">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
            </svg>
            <!-- nowrap + min-w kolom: nama panjang tetap satu baris horizontal;
                 tabel meluap & digeser via wrapper overflow-x-auto -->
            <span class="font-medium text-slate-800 whitespace-nowrap">${esc(d.file_name)}</span>
          </div>
        </td>
        <td class="px-5 py-3 whitespace-nowrap">${
          d.agent_id
            ? `<span class="text-[10px] px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold" title="Privat: hanya agent ini yang menerima konteks dokumen ini">${esc(d.agent_name || d.agent_id)}</span>`
            : `<span class="text-[10px] px-2.5 py-1 rounded-full bg-slate-50 text-slate-500" title="Bersama: tersuntik ke semua agent">Bersama</span>`
        }</td>
        <td class="px-5 py-3 text-slate-500 whitespace-nowrap">${formatBytes(d.size)}</td>
        <td class="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">${esc(d.upload_at)}</td>
        <td class="px-5 py-3 text-right whitespace-nowrap">
          ${
            isSuper
              ? `<button data-action="delete" data-id="${d.id}" title="Hapus dokumen"
                   class="inline-flex items-center justify-center p-1.5 rounded-lg text-red-600 hover:text-red-800 hover:bg-red-50 transition-colors">
                   <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                     <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
                   </svg>
                 </button>`
              : `<span class="text-xs text-slate-400">—</span>`
          }
        </td>
      </tr>`
        )
        .join("")
    : emptyRow(5, "🤖 Otak bot masih kosong — unggah PDF pertama untuk mengajarinya.");

  // Pasang listener hapus pada tiap tombol (tombol hanya dirender utk superadmin)
  tbody.querySelectorAll("button[data-action='delete']").forEach((btn) => {
    const doc = documents.find((d) => d.id === parseInt(btn.dataset.id, 10));
    btn.addEventListener("click", () => deleteDocument(doc));
  });

  renderPagination(
    document.getElementById("kb-pagination"),
    res.meta,
    fetchDocuments,
    { scrollTarget: document.getElementById("kb-list-col") }
  );
}

/** Konfirmasi lalu hapus dokumen (chunk & file fisik ikut dihapus backend). */
function deleteDocument(doc) {
  openConfirm({
    title: "Hapus Dokumen",
    message: `Dokumen "${doc.file_name}" beserta seluruh chunk pengetahuannya akan dihapus permanen. Lanjutkan?`,
    confirmText: "Ya, Hapus",
    danger: true,
    onConfirm: async () => {
      try {
        const res = await Api.del(`/knowledge-base/${doc.id}`);
        showToast(res.message || "Dokumen berhasil dihapus.");
        fetchDocuments();
      } catch (e) {
        showToast(e.message, "error");
      }
    },
  });
}

/**
 * Handler submit form upload (multipart/form-data).
 * Api.post tidak dipakai karena wrapper itu meng-JSON-kan body —
 * FormData butuh fetch langsung dengan header Authorization manual.
 */
async function uploadDocument(event) {
  event.preventDefault();
  const input = document.getElementById("kb-file-input");
  const label = document.getElementById("kb-file-label");
  const loading = document.getElementById("kb-upload-loading");
  const submitBtn = document.getElementById("kb-upload-btn");

  if (!input.files || !input.files.length) {
    showToast("Pilih file PDF terlebih dahulu.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("file", input.files[0]);

  // Kepemilikan dokumen (multi-agent dinamis): kosong = dokumen bersama
  const agentSelect = document.getElementById("kb-agent-select");
  if (agentSelect && agentSelect.value) {
    formData.append("agent_id", agentSelect.value);
  }

  // Tampilkan loading & kunci tombol selama ekstraksi + embedding berjalan
  submitBtn.disabled = true;
  loading.classList.remove("hidden");
  loading.classList.add("flex");

  try {
    const res = await fetch("/api/knowledge-base/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${Api.getToken()}` }, // biarkan browser isi Content-Type multipart
      body: formData,
    });
    const json = await res.json().catch(() => null);

    if (res.status === 401) {
      Api.setToken(null);
      window.location.hash = "#login";
      throw new Error((json && json.message) || "Sesi berakhir, silakan login kembali.");
    }
    if (!res.ok || (json && json.status === "error")) {
      throw new Error((json && json.message) || `Terjadi kesalahan (HTTP ${res.status}).`);
    }

    showToast(json.message || "Dokumen berhasil diunggah.");
    fetchDocuments();
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    submitBtn.disabled = false;
    loading.classList.add("hidden");
    loading.classList.remove("flex");
    event.target.reset();
    label.textContent = "Klik untuk memilih file PDF";
  }
}

// =====================================================================
// VIEW: WHATSAPP SESSION — monitoring sesi WAHA
// ---------------------------------------------------------------------
// Polling tiap 20 detik hanya saat view ini aktif; timer menghentikan
// dirinya sendiri begitu route berpindah (cek currentRouteName).
// =====================================================================
const wahaState = { timer: null };

/** Badge status sesi WAHA: hijau = nyala, kuning = proses, merah/abu = mati. */
function wahaStatusBadge(status) {
  const s = (status || "").toUpperCase();
  const colorMap = {
    WORKING: "bg-emerald-100 text-emerald-800",
    CONNECTED: "bg-emerald-100 text-emerald-800",
    SCAN_QR: "bg-amber-100 text-amber-800",
    SCAN_QR_CODE: "bg-amber-100 text-amber-800",
    STARTING: "bg-amber-100 text-amber-800",
    FAILED: "bg-rose-100 text-rose-800",
    STOPPED: "bg-slate-200 text-slate-700",
  };
  const cls = colorMap[s] || "bg-slate-100 text-slate-600";
  return `<span class="px-2.5 py-0.5 inline-flex text-xs font-medium rounded-full ${cls}">${esc(s || "UNKNOWN")}</span>`;
}

/** Entry point route #waha — dipanggil oleh router.js; mulai siklus polling. */
async function renderWahaSessions() {
  // Hentikan polling sisa kunjungan sebelumnya agar tidak dobel interval
  if (wahaState.timer) {
    clearInterval(wahaState.timer);
    wahaState.timer = null;
  }

  await fetchWahaSessions();

  // Polling periodik; berhenti otomatis saat pengguna pindah halaman
  wahaState.timer = setInterval(() => {
    if (currentRouteName() !== "waha") {
      clearInterval(wahaState.timer);
      wahaState.timer = null;
      return;
    }
    fetchWahaSessions(true); // silent: tanpa spinner saat polling
  }, 20000);
}

/** Ambil status sesi dari GET /api/waha/sessions lalu render kartu. */
async function fetchWahaSessions(silent = false) {
  const grid = document.getElementById("waha-sessions-grid");
  if (!silent) setLoading(grid);

  let res;
  try {
    res = await Api.get("/waha/sessions");
  } catch (e) {
    // Kegagalan jaringan/server: tampilkan pesan di dalam view, bukan toast,
    // agar polling tidak membanjiri notifikasi.
    grid.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center gap-2 py-10 text-center">
        <svg class="w-12 h-12 text-rose-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
        </svg>
        <p class="text-sm font-medium text-slate-600">${esc(e.message)}</p>
        <p class="text-xs text-slate-400">Periksa apakah container WAHA berjalan, lalu klik Refresh.</p>
      </div>`;
    return;
  }

  const sessions = res.data || [];

  // WAHA tak terjangkau (backend mengembalikan list kosong + pesan)
  if (!sessions.length) {
    grid.innerHTML = `
      <div class="col-span-full py-10 text-center">
        <p class="text-sm font-medium text-slate-500">🤖 Bot siap menerima tugas — belum ada sesi WhatsApp.</p>
        ${res.message && res.message !== "OK" ? `<p class="text-xs text-slate-400 mt-1">${esc(res.message)}</p>` : ""}
      </div>`;
    return;
  }

  // Sesi yang menunggu pemindaian QR memunculkan tombol "Scan QR"
  // (modal + polling — alur tanpa reload, lihat wahaPageQrState).
  // Kartu PLACEHOLDER (agent belum punya sesi sama sekali — dikirim backend
  // dgn flag placeholder:true) juga selalu memunculkan tombol; klik-nya
  // me-bootstrap sesi WAHA baru utk agent dulu (startPlaceholderSession).
  const SCAN_STATUSES = ["SCAN_QR", "SCAN_QR_CODE", "STARTING"];
  const isWorking = (s) => (s.status || "").toUpperCase() === "WORKING";
  const isPlaceholder = (s) => !!s.placeholder;
  const canScan = (s) =>
    isPlaceholder(s) || SCAN_STATUSES.includes((s.status || "").toUpperCase());
  const statusBadgeFor = (s) =>
    isPlaceholder(s)
      ? `<span class="px-2.5 py-0.5 inline-flex text-xs font-medium rounded-full bg-slate-200 text-slate-700">TIDAK TERHUBUNG</span>`
      : wahaStatusBadge(s.status);

  grid.innerHTML = sessions
    .map(
      (s) => `
    <div class="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 hover:-translate-y-0.5 transition-all"
         data-waha-card="${esc(isPlaceholder(s) ? s.agent_id : s.name || "")}" data-waha-status="${esc(s.status || "")}">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"/>
            </svg>
          </div>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-800 truncate">${esc(s.name)}</p>
            <p class="text-xs text-slate-400 font-mono truncate" data-waha-phone>${esc(s.phone || (isPlaceholder(s) ? "belum ada sesi WhatsApp" : "nomor belum terhubung"))}</p>
          </div>
        </div>
        <span data-waha-badge>${statusBadgeFor(s)}</span>
      </div>
      <div class="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span class="min-w-0 truncate">Nama WhatsApp: <span class="font-medium text-slate-700">${esc(s.push_name || "-")}</span></span>
        <span class="inline-flex items-center gap-1.5 flex-shrink-0">
          <span data-waha-dot class="w-2 h-2 rounded-full ${isWorking(s) ? "bg-emerald-500 animate-pulse" : "bg-slate-300"}"></span>
          <span data-waha-status-text>${isWorking(s) ? "Terhubung" : "Tidak terhubung"}</span>
          ${canScan(s)
            ? `<button type="button" ${
                isPlaceholder(s)
                  ? `data-waha-scan-agent="${esc(s.agent_id)}"`
                  : `data-waha-scan="${esc(s.name)}"`
              }
                class="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-400 hover:bg-amber-500 text-amber-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z"/>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z"/>
                </svg>
                Scan QR
              </button>`
            : ""}
        </span>
      </div>
    </div>`
    )
    .join("");

  // Kartu dinamis -> pasang ulang listener tombol Scan QR tiap render:
  // kartu placeholder me-bootstrap sesi, kartu nyata langsung buka modal.
  grid.querySelectorAll("[data-waha-scan], [data-waha-scan-agent]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (btn.dataset.wahaScanAgent) {
        startPlaceholderSession(btn.dataset.wahaScanAgent);
      } else {
        openWahaPageQrModal(btn.dataset.wahaScan);
      }
    });
  });
}

// ---------------------------------------------------------------------
// QR MODAL HALAMAN WAHA — scan tanpa pindah halaman (role admin & superadmin)
// Sama-sama memakai modal #modal-waha-qr dengan alur milik Agent Config,
// tetapi polling-nya lewat /waha/sessions (daftar sudah disaring backend
// sesuai role) dan interval 2 detik. Saat sesi WORKING: polling berhenti,
// modal menutup sendiri, dan kartu terkait diperbarui tanpa reload.
// ---------------------------------------------------------------------
const wahaPageQrState = {
  session: null, // nama sesi yang menunggu scan
  timer: null,   // handle setInterval polling
  deadline: 0,   // batas waktu polling agar tidak abadi
  bootstrapping: false, // pengaman dobel-klik tombol Scan QR placeholder
};

/**
 * Tombol Scan QR pada kartu PLACEHOLDER: bootstrap sesi WAHA untuk agent
 * penugasan admin (POST /agent/<id>/waha/start), segarkan daftar kartu
 * (placeholder -> kartu sesi nyata), lalu buka modal QR sesi baru tersebut.
 */
async function startPlaceholderSession(agentId) {
  if (wahaPageQrState.bootstrapping) return;
  wahaPageQrState.bootstrapping = true;
  try {
    const res = await Api.post(`/agent/${encodeURIComponent(agentId)}/waha/start`);
    showToast(res.message || "Sesi WhatsApp dibuat — silakan scan QR.");
    fetchWahaSessions(true); // kartu placeholder digantikan kartu sesi nyata
    openWahaPageQrModal(res.data.session_name);
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    wahaPageQrState.bootstrapping = false;
  }
}

/** Buka modal QR utk sesi halaman WAHA & mulai polling tiap 2 detik. */
function openWahaPageQrModal(sessionName) {
  stopWahaPageQrPolling(); // bersihkan polling sebelumnya bila ada

  wahaPageQrState.session = sessionName;
  wahaPageQrState.deadline = Date.now() + 2 * 60 * 1000; // maks 2 menit

  document.getElementById("waha-qr-img").classList.add("hidden");
  document.getElementById("waha-qr-img").removeAttribute("src");
  document.getElementById("waha-qr-spinner").classList.remove("hidden");
  document.getElementById("waha-qr-status").textContent = "Menyiapkan sesi…";
  openModal("modal-waha-qr");

  pollWahaPageQrTick(); // tick pertama tanpa menunggu interval
  wahaPageQrState.timer = setInterval(pollWahaPageQrTick, 2000);
}

/** Satu iterasi polling halaman WAHA: status sesi + gambar QR. */
async function pollWahaPageQrTick() {
  const { session, deadline } = wahaPageQrState;
  if (!session) return;

  if (Date.now() > deadline) {
    stopWahaPageQrPolling();
    showToast("QR tidak tersedia / sesi terlalu lama menunggu. Coba Scan QR lagi.", "error");
    return;
  }

  const statusEl = document.getElementById("waha-qr-status");

  // 1) Status sesi via daftar terfilter (/waha/sessions sesuai role)
  try {
    const res = await Api.get("/waha/sessions");
    const s = (res.data || []).find((x) => x.name === session);
    if (s && s.status === "WORKING") {
      stopWahaPageQrPolling();
      showToast(`Perangkat ${s.phone || session} berhasil tertaut!`);
      updateWahaCardLive(session, s); // badge & indikator kartu, tanpa reload
      return;
    }
    if (s && s.status) {
      statusEl.textContent = s.status.startsWith("SCAN_QR")
        ? "Menunggu scan QR dari WhatsApp…"
        : `Status sesi: ${s.status}…`;
    }
  } catch (e) {
    statusEl.textContent = e.message; // coba lagi di tick berikutnya
  }

  // 2) Gambar QR (WAHA kadang perlu beberapa detik sebelum menerbitkan)
  try {
    const qrRes = await Api.get(`/waha/session/${encodeURIComponent(session)}/qr`);
    if (qrRes.data && qrRes.data.qr) {
      const img = document.getElementById("waha-qr-img");
      img.src = qrRes.data.qr;
      img.classList.remove("hidden");
      document.getElementById("waha-qr-spinner").classList.add("hidden");
    }
  } catch (e) {
    /* QR belum terbit — spinner tetap; detail sudah tampil di status */
  }
}

/** Hentikan polling modal halaman WAHA (idempoten). */
function stopWahaPageQrPolling() {
  if (wahaPageQrState.timer) {
    clearInterval(wahaPageQrState.timer);
    wahaPageQrState.timer = null;
  }
  wahaPageQrState.session = null;
  closeModal("modal-waha-qr");
}

/**
 * Perbarui kartu sesi di halaman WAHA secara in-place (tanpa reload):
 * badge SCAN_QR/STARTING -> WORKING hijau, titik koneksi + teks
 * "Terhubung", dan nomor telepon yang baru tertaut.
 */
function updateWahaCardLive(sessionName, s) {
  const card = document.querySelector(
    `[data-waha-card="${CSS.escape(sessionName)}"]`
  );
  if (!card) {
    fetchWahaSessions(true); // kartu tak ditemukan (mis. filter berubah) — segar diam-diam
    return;
  }

  card.dataset.wahaStatus = s.status || "";
  const badge = card.querySelector("[data-waha-badge]");
  if (badge) badge.innerHTML = wahaStatusBadge(s.status);

  const dot = card.querySelector("[data-waha-dot]");
  if (dot) {
    dot.classList.toggle("bg-emerald-500", true);
    dot.classList.toggle("animate-pulse", true);
    dot.classList.toggle("bg-slate-300", false);
  }
  const statusText = card.querySelector("[data-waha-status-text]");
  if (statusText) statusText.textContent = "Terhubung";

  const phone = card.querySelector("[data-waha-phone]");
  if (phone && s.phone) phone.textContent = s.phone;

  // Tombol Scan QR tak relevan lagi setelah terhubung
  card.querySelector("[data-waha-scan]")?.remove();
}

// =====================================================================
// VIEW: AGENT CONFIG — PERANGKAT WHATSAPP (WAHA MULTI-DEVICE)
// Satu agent dapat menautkan beberapa nomor WhatsApp sekaligus.
// Alur "Generate QR WA": POST start -> modal QR -> polling tiap 3 dtk
// (gambar QR + status sesi) sampai WORKING (tertaut) / modal ditutup /
// batas waktu 2 menit tercapai.
// =====================================================================
const wahaDeviceState = {
  agentId: null,   // agent yang daftar perangkatnya sedang ditampilkan
  qrSession: null, // sesi yang sedang menunggu scan QR di modal
  qrTimer: null,   // handle setInterval polling QR
  qrDeadline: 0,   // batas waktu polling (ms epoch) agar tidak abadi
};

/** Muat & render daftar perangkat WAHA milik agent di bawah form config. */
async function renderAgentWahaDevices(agentId) {
  const box = document.getElementById("agent-waha-devices");
  if (!box) return;
  wahaDeviceState.agentId = agentId;
  box.classList.remove("hidden");
  setLoading(box);

  let res;
  try {
    res = await Api.get(`/agent/${encodeURIComponent(agentId)}/waha/sessions`);
  } catch (e) {
    box.innerHTML = `
      <div class="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 text-center">
        <p class="text-sm text-slate-500">${esc(e.message)}</p>
        <p class="text-xs text-slate-400 mt-1">Periksa apakah server WAHA berjalan, lalu buka ulang form ini.</p>
      </div>`;
    return;
  }

  const devices = res.data || [];

  box.innerHTML = `
    <div class="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div class="px-8 py-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="font-extrabold tracking-tighter text-black">Perangkat WhatsApp Tertaut</h3>
          <p class="text-xs font-serif italic text-gray-500 mt-0.5">
            Nomor WhatsApp yang melayani agent ini — status diperbarui saat form dibuka.
          </p>
        </div>
        <span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          ${devices.length} perangkat
        </span>
      </div>
      <div class="divide-y divide-slate-100">
        ${
          devices.length
            ? devices
                .map(
                  (d) => `
          <div class="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"/>
                </svg>
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">
                  ${esc(d.phone || "nomor belum terhubung")}
                  ${d.push_name ? `<span class="text-slate-400 font-normal">· ${esc(d.push_name)}</span>` : ""}
                </p>
                <p class="text-xs text-slate-400 font-mono truncate">${esc(d.session_name)}</p>
              </div>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
              ${wahaStatusBadge(d.status)}
              <button type="button" data-waha-delete="${esc(d.session_name)}"
                title="Logout & hapus perangkat"
                class="inline-flex items-center justify-center p-1.5 rounded-lg text-red-600 hover:text-red-800 hover:bg-red-50 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
                </svg>
              </button>
            </div>
          </div>`
                )
                .join("")
            : `<div class="px-5 py-8 text-center">
                 <p class="text-sm text-slate-500">🤖 Belum ada perangkat WhatsApp tertaut.</p>
                 <p class="text-xs text-slate-400 mt-1">Klik “Generate QR WA” untuk menautkan nomor pertama.</p>
               </div>`
        }
      </div>
    </div>`;

  // Kartu/baris dinamis -> pasang ulang listener hapus tiap render
  box.querySelectorAll("[data-waha-delete]").forEach((btn) => {
    btn.addEventListener("click", () =>
      deleteAgentWahaSession(agentId, btn.dataset.wahaDelete)
    );
  });
}

/** POST start sesi WAHA baru untuk agent, lalu buka modal QR + polling. */
async function startWahaSession(agentId) {
  const btn = document.getElementById("btn-generate-qr");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("opacity-60", "pointer-events-none");
  }
  try {
    const res = await Api.post(`/agent/${encodeURIComponent(agentId)}/waha/start`);
    openWahaQrModal(agentId, res.data.session_name);
    renderAgentWahaDevices(agentId); // sesi baru langsung muncul di daftar
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("opacity-60", "pointer-events-none");
    }
  }
}

/** Buka modal QR & mulai polling status sesi tiap 3 detik. */
function openWahaQrModal(agentId, sessionName) {
  stopWahaQrPolling(); // bersihkan polling sesi sebelumnya bila ada

  wahaDeviceState.agentId = agentId;
  wahaDeviceState.qrSession = sessionName;
  wahaDeviceState.qrDeadline = Date.now() + 2 * 60 * 1000; // maks 2 menit

  document.getElementById("waha-qr-img").classList.add("hidden");
  document.getElementById("waha-qr-img").removeAttribute("src");
  document.getElementById("waha-qr-spinner").classList.remove("hidden");
  document.getElementById("waha-qr-status").textContent = "Menyiapkan sesi…";
  openModal("modal-waha-qr");

  pollWahaQrTick(); // tick pertama tanpa menunggu 3 detik
  wahaDeviceState.qrTimer = setInterval(pollWahaQrTick, 3000);
}

/** Satu iterasi polling: tarik gambar QR + cek status sesi di WAHA. */
async function pollWahaQrTick() {
  const { agentId, qrSession, qrDeadline } = wahaDeviceState;
  if (!qrSession) return;

  // Batas waktu tercapai: berhenti & minta admin generate ulang
  if (Date.now() > qrDeadline) {
    stopWahaQrPolling();
    document.getElementById("waha-qr-status").textContent =
      "QR tidak tersedia / sesi terlalu lama menunggu. Silakan Generate QR WA lagi.";
    return;
  }

  const statusEl = document.getElementById("waha-qr-status");

  // 1) Cek status sesi: WORKING = perangkat sudah tertaut -> selesai
  try {
    const res = await Api.get(`/agent/${encodeURIComponent(agentId)}/waha/sessions`);
    const device = (res.data || []).find((d) => d.session_name === qrSession);
    if (device && device.status === "WORKING") {
      const phone = device.phone || "perangkat";
      stopWahaQrPolling();
      showToast(`Perangkat ${phone} berhasil tertaut!`);
      renderAgentWahaDevices(agentId);
      return;
    }
    if (device && device.status) {
      statusEl.textContent = device.status.startsWith("SCAN_QR")
        ? "Menunggu scan QR dari WhatsApp…"
        : `Status sesi: ${device.status}…`;
    }
  } catch (e) {
    statusEl.textContent = e.message; // coba lagi di tick berikutnya
  }

  // 2) Muat gambar QR (WAHA kadang butuh beberapa detik sebelum menerbitkan)
  try {
    const qrRes = await Api.get(
      `/waha/session/${encodeURIComponent(qrSession)}/qr`
    );
    if (qrRes.data && qrRes.data.qr) {
      const img = document.getElementById("waha-qr-img");
      img.src = qrRes.data.qr;
      img.classList.remove("hidden");
      document.getElementById("waha-qr-spinner").classList.add("hidden");
    }
  } catch (e) {
    // QR belum terbit — biarkan spinner; pesan detail sudah di status
  }
}

/** Hentikan polling QR & tutup modalnya (idempoten, aman dipanggil dua kali). */
function stopWahaQrPolling() {
  if (wahaDeviceState.qrTimer) {
    clearInterval(wahaDeviceState.qrTimer);
    wahaDeviceState.qrTimer = null;
  }
  wahaDeviceState.qrSession = null;
  closeModal("modal-waha-qr");
}

/** Logout & hapus perangkat WAHA agent (dengan konfirmasi). */
function deleteAgentWahaSession(agentId, sessionName) {
  openConfirm({
    title: "Hapus Perangkat WhatsApp",
    message: `Perangkat "${sessionName}" akan di-logout dari WhatsApp dan dihapus. Lanjutkan?`,
    confirmText: "Ya, Hapus",
    danger: true,
    onConfirm: async () => {
      try {
        await Api.del(
          `/agent/${encodeURIComponent(agentId)}/waha/session/${encodeURIComponent(sessionName)}`
        );
        showToast("Perangkat WhatsApp berhasil dihapus.");
        renderAgentWahaDevices(agentId);
      } catch (e) {
        showToast(e.message, "error");
      }
    },
  });
}

// =====================================================================
// VIEW: AI USAGE — monitoring token & estimasi biaya LLM
// Sumber: GET /api/ai-usage (ringkasan bulan/hari ini + 100 log terbaru
// dari tabel ai_usage_logs, satu baris per balasan AI webhook).
// =====================================================================
async function renderAiUsage() {
  aiUsageState.page = 1; // masuk halaman AI Usage -> mulai dari halaman pertama
  await fetchAiUsage();
}

/** Ambil data pemakaian AI lalu render 3 kartu ringkasan + tabel log
 *  (terpaginasi 10 baris/halaman). Tabel log bisa disaring rentang tanggal
 *  (start_date/end_date) — ringkasan bulan berjalan tetap global. */
const aiUsageState = { page: 1, startDate: "", endDate: "" };

async function fetchAiUsage(page = aiUsageState.page) {
  const statsEl = document.getElementById("ai-usage-stats");
  const tbody = document.getElementById("ai-usage-tbody");
  setLoading(statsEl);
  setLoading(tbody);

  const params = { page, per_page: 10 };
  if (aiUsageState.startDate) params.start_date = aiUsageState.startDate;
  if (aiUsageState.endDate) params.end_date = aiUsageState.endDate;
  const res = await Api.get("/ai-usage", params);
  aiUsageState.page = res.meta ? res.meta.page : 1;
  const { summary, logs } = res.data;

  // Kartu ringkasan — gaya Enblox: kartu putih rounded-3xl berbayang
  // sangat lembut, bilah warna aksen mengikuti palet mesh gradient.
  const cards = [
    {
      label: "Total Token Bulan Ini",
      value: (summary.total_tokens_this_month || 0).toLocaleString("id-ID"),
      sub: "jumlah token input + output",
      color: "bg-red-600",
    },
    {
      label: "Estimasi Biaya Bulan Ini",
      value: formatIDR(summary.total_cost_this_month),
      sub: "perkiraan biaya layanan LLM",
      color: "bg-gray-800",
    },
    {
      label: "Pesan AI Hari Ini",
      value: (summary.total_conversations_today || 0).toLocaleString("id-ID"),
      sub: "balasan AI yang dibuat hari ini",
      color: "bg-rose-400",
    },
  ];

  statsEl.innerHTML = cards
    .map(
      (c) => `
      <div class="relative overflow-hidden bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 flex items-center gap-4">
        <div class="w-2 self-stretch rounded-full ${c.color}"></div>
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">${esc(c.label)}</p>
          <p class="text-3xl font-extrabold tracking-tighter text-black mt-0.5">${esc(c.value)}</p>
          <p class="mt-1 text-sm text-slate-400">${esc(c.sub)}</p>
        </div>
      </div>`
    )
    .join("");

  // Tabel log: pembatas horizontal halus, badge pil untuk nama model
  tbody.innerHTML = logs.length
    ? logs
        .map(
          (l) => `
        <tr class="hover:bg-gray-50 transition-colors">
          <td class="px-8 py-4 text-slate-500 whitespace-nowrap">${formatDateTime(l.created_at)}</td>
          <td class="px-5 py-4 font-mono text-xs">${esc(formatPlatformId(l.platform_id))}</td>
          <td class="px-5 py-4 font-medium text-gray-900">${esc(l.agent_id)}</td>
          <td class="px-5 py-4">
            <span class="inline-flex items-center bg-gray-50 text-gray-600 rounded-full px-3 py-1 text-xs">${esc(l.model_name)}</span>
          </td>
          <td class="px-5 py-4">${(l.input_tokens || 0).toLocaleString("id-ID")}</td>
          <td class="px-5 py-4">${(l.output_tokens || 0).toLocaleString("id-ID")}</td>
          <td class="px-5 py-4 text-right font-semibold text-gray-900 whitespace-nowrap">${formatIDR(l.total_cost)}</td>
        </tr>`
        )
        .join("")
    : emptyRow(7, "💤 Bot belum melakukan percakapan — pemakaian AI akan tercatat di sini.");

  // Tanpa scrollTarget: posisi scroll dipertahankan persis saat pindah
  // halaman — kontrol paginasi ada di bawah kartu, jadi pengguna tetap
  // berada di tempat yang sama (tinggi tabel konstan, 10 baris/halaman).
  renderPagination(
    document.getElementById("ai-usage-pagination"),
    res.meta,
    fetchAiUsage
  );
}

// =====================================================================
// VIEW: ADMIN MANAGEMENT (superadmin) — daftar admin, 10 baris/halaman
// =====================================================================
const adminsState = { page: 1 };

async function renderAdmins(page = adminsState.page) {
  const tbody = document.getElementById("admins-tbody");
  setLoading(tbody);

  const res = await Api.get("/admins", { page, per_page: 10 });
  adminsState.page = res.meta ? res.meta.page : 1;
  let admins = res.data;

  // Baris terakhir halaman terakhir baru saja dihapus -> mundur satu halaman
  // agar admin tidak melihat tabel kosong tanpa sebab.
  if (!admins.length && res.meta && res.meta.page > 1) {
    return renderAdmins(res.meta.total_pages);
  }

  // Sel "Akses Agent": superadmin -> "Semua Agent" (implisit);
  // admin -> nama agent yang ditugaskan (pivot), atau "—" bila belum ada.
  const agentAccessCell = (a) => {
    if (a.role === "superadmin") {
      return `<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Semua Agent</span>`;
    }
    if (a.agent_access && a.agent_access.length) {
      return a.agent_access
        .map(
          (g) => `<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600">${esc(g.name)}</span>`
        )
        .join(" ");
    }
    return `<span class="text-slate-400 text-xs">— belum ditugaskan —</span>`;
  };

  tbody.innerHTML = admins.length
    ? admins
        .map(
          (a) => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-5 py-3 text-slate-400">${a.id}</td>
        <td class="px-5 py-3 font-semibold">${esc(a.username)}</td>
        <td class="px-5 py-3">${esc(a.full_name)}</td>
        <td class="px-5 py-3">${statusBadge(a.role)}</td>
        <td class="px-5 py-3">${agentAccessCell(a)}</td>
        <td class="px-5 py-3">${statusBadge(a.is_active ? "active" : "inactive")}</td>
        <td class="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">${formatDateTime(a.created_at)}</td>
        <td class="px-5 py-3 text-right whitespace-nowrap">
          <button data-action="edit" data-id="${a.id}" class="text-gray-900 hover:opacity-60 font-medium mr-3">Edit</button>
          <button data-action="delete" data-id="${a.id}" class="text-red-600 hover:text-red-800 font-medium">Hapus</button>
        </td>
      </tr>`
        )
        .join("")
    : emptyRow(8, "🤖 Belum ada admin terdaftar. Tambahkan admin pertama lewat tombol di atas.");

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    const admin = admins.find((a) => a.id === parseInt(btn.dataset.id, 10));
    if (btn.dataset.action === "edit") {
      btn.addEventListener("click", () => openAdminModal(admin));
    } else {
      btn.addEventListener("click", () => deleteAdmin(admin));
    }
  });

  renderPagination(
    document.getElementById("admins-pagination"),
    res.meta,
    renderAdmins,
    { scrollTarget: document.getElementById("admins-table-card") }
  );
}

/** Isi dropdown "Akses Agent" dari GET /api/agents (best-effort). */
async function populateAdminAgentSelect() {
  const select = document.getElementById("admin-agent");
  if (!select) return;
  try {
    const res = await Api.get("/agents");
    const agents = res.data || [];
    select.innerHTML =
      `<option value="">— Pilih Agent —</option>` +
      agents
        .map(
          (a) => `<option value="${esc(a.agent_id)}">${esc(a.name || a.agent_id)}</option>`
        )
        .join("");
  } catch (e) {
    select.innerHTML = `<option value="">— Gagal memuat agent —</option>`;
  }
}

/** RBAC pivot: dropdown Akses Agent hanya relevan untuk role Admin. */
function syncAdminAgentVisibility() {
  const role = document.getElementById("admin-role").value;
  document
    .getElementById("admin-agent-wrap")
    .classList.toggle("hidden", role !== "admin");
}

/** Buka modal admin; tanpa argumen = mode tambah. */
function openAdminModal(admin = null) {
  document.getElementById("admin-modal-title").textContent = admin ? "Edit Admin" : "Tambah Admin";
  document.getElementById("admin-id").value = admin ? admin.id : "";
  document.getElementById("admin-username").value = admin ? admin.username : "";
  document.getElementById("admin-full-name").value = admin ? admin.full_name : "";
  document.getElementById("admin-password").value = "";
  document.getElementById("admin-password").required = !admin; // password wajib saat create
  document.getElementById("admin-password-hint").textContent = admin ? "(kosongkan jika tidak diubah)" : "";
  document.getElementById("admin-role").value = admin ? admin.role : "admin";
  document.getElementById("admin-is-active").checked = admin ? admin.is_active : true;

  // Dropdown agent: isi ulang tiap buka (daftar agent bisa bertambah),
  // lalu prapilih penugasan saat mode edit.
  populateAdminAgentSelect().then(() => {
    if (admin && admin.agent_access && admin.agent_access.length) {
      document.getElementById("admin-agent").value = admin.agent_access[0].agent_id;
    }
  });
  syncAdminAgentVisibility();
  openModal("modal-admin");
}

async function handleAdminSubmit(event) {
  event.preventDefault();
  const id = document.getElementById("admin-id").value;
  const role = document.getElementById("admin-role").value;
  const payload = {
    username: document.getElementById("admin-username").value.trim(),
    full_name: document.getElementById("admin-full-name").value.trim(),
    role,
    is_active: document.getElementById("admin-is-active").checked,
  };

  // RBAC pivot: role admin wajib membawa agent_id (single select)
  const agentId = document.getElementById("admin-agent").value;
  if (role === "admin") {
    if (!agentId) {
      showToast("Pilih agent untuk role Admin (Akses Agent wajib).", "error");
      return;
    }
    payload.agent_id = agentId;
  }

  const password = document.getElementById("admin-password").value;
  if (password || !id) payload.password = password; // kirim hanya saat perlu

  try {
    if (id) {
      await Api.put(`/admins/${id}`, payload);
      showToast("Data admin berhasil diperbarui.");
    } else {
      await Api.post("/admins", payload);
      showToast("Admin baru berhasil dibuat.");
    }
    closeModal("modal-admin");
    renderAdmins();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function deleteAdmin(admin) {
  openConfirm({
    title: "Hapus Admin",
    message: `Akun admin "${admin.username}" akan dihapus permanen. Lanjutkan?`,
    confirmText: "Ya, Hapus",
    danger: true,
    onConfirm: async () => {
      try {
        await Api.del(`/admins/${admin.id}`);
        showToast("Admin berhasil dihapus.");
        renderAdmins();
      } catch (e) {
        showToast(e.message, "error");
      }
    },
  });
}

// =====================================================================
// INIT: pasang semua event listener & jalankan router pertama kali
// =====================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Form login
  document.getElementById("login-form").addEventListener("submit", handleLogin);

  // Dashboard: tombol "Terapkan" filter global (agent + rentang tanggal)
  document.getElementById("dash-filter-apply").addEventListener("click", () => {
    const error = applyDashboardFilters();
    if (error) {
      showToast(error, "error");
      return;
    }
    renderDashboard();
  });

  // AI Usage: tombol "Terapkan" filter rentang tanggal tabel log —
  // filter baru berarti kembali ke halaman pertama.
  document.getElementById("ai-usage-filter-apply").addEventListener("click", () => {
    aiUsageState.startDate = document.getElementById("ai-usage-filter-start").value || "";
    aiUsageState.endDate = document.getElementById("ai-usage-filter-end").value || "";
    if (aiUsageState.startDate && aiUsageState.endDate && aiUsageState.startDate > aiUsageState.endDate) {
      showToast("Tanggal mulai tidak boleh melebihi tanggal akhir.", "error");
      return;
    }
    fetchAiUsage(1);
  });

  // Logout
  document.getElementById("logout-btn").addEventListener("click", handleLogout);

  // Tutup modal lewat tombol/elemen bertanda data-close-modal
  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeAllModals);
  });

  // Modal Tambah Agent: kosongkan form saat ditutup lewat Batal/overlay
  // agar input lama tidak terbawa saat modal dibuka berikutnya.
  document.querySelectorAll("#modal-agent [data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => document.getElementById("agent-create-form").reset());
  });

  // Modal QR WhatsApp (dipakai dua alur: Agent Config & halaman WAHA):
  // hentikan polling kedua alur saat ditutup lewat tombol Tutup maupun
  // klik overlay gelap.
  document.querySelectorAll("#modal-waha-qr [data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => {
      stopWahaQrPolling();
      stopWahaPageQrPolling();
    });
  });

  // Form admin
  document.getElementById("admin-form").addEventListener("submit", handleAdminSubmit);
  document.getElementById("btn-add-admin").addEventListener("click", () => openAdminModal());
  // RBAC pivot: ganti role -> tampilkan/sembunyikan dropdown Akses Agent
  document.getElementById("admin-role").addEventListener("change", syncAdminAgentVisibility);

  // Tombol persetujuan modal konfirmasi: jalankan aksi tersimpan
  document.getElementById("confirm-ok").addEventListener("click", () => {
    const action = confirmAction;
    confirmAction = null;
    closeModal("modal-confirm");
    if (action) action();
  });

  // Agent Config: tombol "+ Tambah Agent" -> modal; form modal -> POST /agents;
  // tombol Kembali -> daftar (klik kartu dipasang di renderAgentCards karena
  // kartu dirender dinamis dari database).
  document.getElementById("btn-add-agent").addEventListener("click", () => {
    document.getElementById("agent-create-form").reset();
    openModal("modal-agent");
  });
  document.getElementById("agent-create-form").addEventListener("submit", handleAgentCreate);
  document.getElementById("agent-back-btn").addEventListener("click", showAgentList);

  // Riwayat Chat: tombol "⬅ Kembali ke Daftar Agent" (Tahap 2 -> Tahap 1);
  // klik kartu agent dipasang di renderChatAgentCards karena kartu dinamis.
  document.getElementById("chat-agent-back-btn").addEventListener("click", showChatAgentPicker);

  // Filter channel pane kiri: Semua (default) / WhatsApp / Telegram
  document.getElementById("filter-all").addEventListener("click", () => setChannelFilter("all"));
  document.getElementById("filter-wa").addEventListener("click", () => setChannelFilter("whatsapp"));
  document.getElementById("filter-tg").addEventListener("click", () => setChannelFilter("telegram"));

  // Tombol kembali ke daftar kontak (hanya tampil di mobile)
  document.getElementById("chat-back-btn").addEventListener("click", () => {
    chatsState.activeId = null;
    renderChatUserList(); // hilangkan sorotan kontak aktif
    paintChatPanes();
  });

  // Toggle Manual Mode (Human Takeover): cabut/kembalikan AI untuk user ini
  document.getElementById("chat-manual-toggle").addEventListener("change", async (event) => {
    if (!chatsState.activeId) {
      event.target.checked = false;
      return;
    }
    try {
      const res = await Api.post(`/chats/${encodeURIComponent(chatsState.activeId)}/toggle-mode`);
      chatsState.isManualMode = res.data.is_manual_mode;
      applyManualModeUI();
      showToast(res.message);
      renderChatUserList(); // perbarui badge "Manual" di daftar kontak
    } catch (e) {
      event.target.checked = !event.target.checked; // kembalikan posisi toggle
      showToast(e.message, "error");
    }
  });

  // Kirim balasan manual: tombol kirim & tombol Enter di kolom input
  document.getElementById("chat-send-btn").addEventListener("click", sendManualMessage);
  document.getElementById("chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendManualMessage();
    }
  });

  // Knowledge Base: form upload multipart + tampilkan nama file terpilih
  document.getElementById("kb-upload-form").addEventListener("submit", uploadDocument);
  document.getElementById("kb-file-input").addEventListener("change", (event) => {
    const label = document.getElementById("kb-file-label");
    label.textContent =
      event.target.files && event.target.files.length
        ? event.target.files[0].name
        : "Klik untuk memilih file PDF";
  });

  // WhatsApp Session: tombol Refresh memicu pengambilan data manual (dgn spinner)
  document.getElementById("btn-refresh-waha").addEventListener("click", () => {
    fetchWahaSessions();
  });

  // Jalankan router pertama kali (hash default -> sesuai status login)
  if (!window.location.hash) {
    window.location.hash = Api.getToken() ? "#dashboard" : "#login";
  }
  // Sudah login (refresh halaman): minta izin notifikasi bila belum pernah
  if (Api.getToken()) requestNotificationPermission();
  navigate();
});
