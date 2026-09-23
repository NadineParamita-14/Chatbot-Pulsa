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
    superadmin: "bg-purple-100 text-purple-800",
    admin: "bg-blue-100 text-blue-800",
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
function emptyRow(colspan, text = "Tidak ada data.") {
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
  // Merah untuk aksi berisiko (hapus), teal untuk aksi proses (verifikasi)
  okBtn.className = `px-4 py-2 text-sm font-semibold rounded-lg text-white ${
    danger ? "bg-red-600 hover:bg-red-700" : "bg-teal-500 hover:bg-teal-600"
  }`;
  document.getElementById("confirm-icon").className = `w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
    danger ? "bg-red-100 text-red-600" : "bg-teal-100 text-teal-600"
  }`;

  confirmAction = onConfirm;
  openModal("modal-confirm");
}

/** Tutup sidebar di layar mobile. */
function closeSidebar() {
  document.getElementById("sidebar").classList.add("-translate-x-full");
  document.getElementById("sidebar-overlay").classList.add("hidden");
}

// ---------------------------------------------------------------------
// RBAC UI — sembunyikan menu khusus superadmin
// ---------------------------------------------------------------------
function applyRbacUi() {
  const isSuper = App.user && App.user.role === "superadmin";
  document.querySelectorAll("[data-superadmin-only]").forEach((el) => {
    el.classList.toggle("hidden", !isSuper);
  });
  // Tombol tambah produk juga khusus superadmin
  const addProductBtn = document.getElementById("btn-add-product");
  addProductBtn.classList.toggle("hidden", !isSuper);
  addProductBtn.classList.toggle("flex", isSuper);
}

// ---------------------------------------------------------------------
// PAGINATION (kontrol Sebelumnya / Berikutnya)
// ---------------------------------------------------------------------
function renderPagination(container, meta, onPage) {
  if (!meta || meta.total_pages <= 1) {
    container.innerHTML = meta
      ? `<span class="text-slate-500">Total ${meta.total} data</span><span></span>`
      : "";
    return;
  }
  container.innerHTML = `
    <span class="text-slate-500">Halaman ${meta.page} dari ${meta.total_pages} — total ${meta.total} data</span>
    <div class="flex gap-2">
      <button data-page="${meta.page - 1}" ${meta.page <= 1 ? "disabled" : ""}
        class="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">Sebelumnya</button>
      <button data-page="${meta.page + 1}" ${meta.page >= meta.total_pages ? "disabled" : ""}
        class="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">Berikutnya</button>
    </div>`;
  container.querySelectorAll("button[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => onPage(parseInt(btn.dataset.page, 10)));
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
// VIEW: DASHBOARD
// =====================================================================
async function renderDashboard() {
  paintTopbarUser();
  const statsEl = document.getElementById("dashboard-stats");
  const recentEl = document.getElementById("dashboard-recent");
  setLoading(statsEl);
  recentEl.innerHTML = emptyRow(5, "Memuat...");

  const res = await Api.get("/dashboard/stats");
  const s = res.data;

  const cards = [
    {
      label: "Total Pendapatan", value: formatIDR(s.total_revenue), color: "bg-green-500",
      trend: "↑ 12%", trendClass: "text-emerald-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>`,
    },
    {
      label: "Pesanan Pending", value: s.pending_orders, color: "bg-yellow-500",
      trend: "↓ 3%", trendClass: "text-amber-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    },
    {
      label: "Total Produk", value: s.total_products, color: "bg-teal-500",
      trend: "↑ 5%", trendClass: "text-emerald-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>`,
    },
    {
      label: "Total Pesanan", value: s.total_orders, color: "bg-blue-500",
      trend: "↑ 9%", trendClass: "text-emerald-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/>`,
    },
    {
      label: "Pesanan Sukses", value: s.success_orders, color: "bg-emerald-500",
      trend: "↑ 15%", trendClass: "text-emerald-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    },
    {
      label: "Pesanan Gagal", value: s.failed_orders, color: "bg-red-500",
      trend: "↓ 2%", trendClass: "text-rose-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    },
    {
      label: "Total Pelanggan", value: s.total_customers, color: "bg-cyan-500",
      trend: "↑ 7%", trendClass: "text-emerald-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>`,
    },
    {
      label: "Chat Hari Ini", value: s.chats_today, color: "bg-purple-500",
      trend: "↑ 21%", trendClass: "text-emerald-500",
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"/>`,
    },
  ];

  statsEl.innerHTML = cards
    .map(
      (c) => `
      <div class="relative overflow-hidden bg-white rounded-2xl shadow-sm p-5 flex items-center gap-4">
        <div class="w-2 self-stretch rounded-full ${c.color}"></div>
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">${esc(c.label)}</p>
          <p class="text-2xl font-bold text-slate-900 mt-0.5">${esc(c.value)}</p>
          <p class="mt-1 text-sm">
            <span class="${c.trendClass} font-medium">${c.trend}</span>
            <span class="text-slate-400">dari bulan lalu</span>
          </p>
        </div>
        <svg class="w-12 h-12 text-slate-200 flex-shrink-0 ml-auto" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
          ${c.icon}
        </svg>
      </div>`
    )
    .join("");

  recentEl.innerHTML = s.recent_orders.length
    ? s.recent_orders
        .map(
          (o) => `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="px-5 py-3 font-mono text-xs">${esc(o.invoice_number)}</td>
          <td class="px-5 py-3">${statusBadge(o.status)}</td>
          <td class="px-5 py-3">${statusBadge(o.payment_status)}</td>
          <td class="px-5 py-3 font-semibold">${formatIDR(o.total_amount)}</td>
          <td class="px-5 py-3 text-slate-500">${formatDateTime(o.created_at)}</td>
        </tr>`
        )
        .join("")
    : emptyRow(5);
}

// =====================================================================
// VIEW: PRODUCTS
// =====================================================================
async function renderProducts() {
  const tbody = document.getElementById("products-tbody");
  setLoading(tbody);

  const res = await Api.get("/products");
  const products = res.data;

  const isSuper = App.user && App.user.role === "superadmin";
  tbody.innerHTML = products.length
    ? products
        .map(
          (p) => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-5 py-3 text-slate-400">${p.id}</td>
        <td class="px-5 py-3 font-semibold text-slate-800">${esc(p.name)}</td>
        <td class="px-5 py-3">
          <span class="${p.qty > 0 ? "text-slate-700" : "text-red-600 font-bold"}">${p.qty}</span>
        </td>
        <td class="px-5 py-3 font-semibold">${formatIDR(p.price)}</td>
        <td class="px-5 py-3 text-slate-500 max-w-xs truncate" title="${esc(p.description || "")}">${esc(p.description || "-")}</td>
        <td class="px-5 py-3 text-slate-500 text-xs">${formatDateTime(p.created_at)}</td>
        <td class="px-5 py-3 text-right whitespace-nowrap">
          ${
            isSuper
              ? `
          <button data-action="edit" data-id="${p.id}" class="text-teal-600 hover:text-teal-700 font-medium mr-3">Edit</button>
          <button data-action="delete" data-id="${p.id}" class="text-red-600 hover:text-red-800 font-medium">Hapus</button>`
              : `<span class="text-xs text-slate-400">read-only</span>`
          }
        </td>
      </tr>`
        )
        .join("")
    : emptyRow(7);

  // Delegasi aksi edit / hapus
  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    const product = products.find((p) => p.id === parseInt(btn.dataset.id, 10));
    if (btn.dataset.action === "edit") {
      btn.addEventListener("click", () => openProductModal(product));
    } else {
      btn.addEventListener("click", () => deleteProduct(product));
    }
  });
}

/** Buka modal produk; tanpa argumen = mode tambah. */
function openProductModal(product = null) {
  document.getElementById("product-modal-title").textContent = product ? "Edit Produk" : "Tambah Produk";
  document.getElementById("product-id").value = product ? product.id : "";
  document.getElementById("product-name").value = product ? product.name : "";
  document.getElementById("product-qty").value = product ? product.qty : "";
  document.getElementById("product-price").value = product ? product.price : "";
  document.getElementById("product-description").value = product ? product.description || "" : "";
  openModal("modal-product");
}

async function handleProductSubmit(event) {
  event.preventDefault();
  const id = document.getElementById("product-id").value;
  const payload = {
    name: document.getElementById("product-name").value.trim(),
    qty: parseInt(document.getElementById("product-qty").value, 10),
    price: parseFloat(document.getElementById("product-price").value),
    description: document.getElementById("product-description").value.trim(),
  };
  try {
    if (id) {
      await Api.put(`/products/${id}`, payload);
      showToast("Produk berhasil diperbarui.");
    } else {
      await Api.post("/products", payload);
      showToast("Produk berhasil ditambahkan.");
    }
    closeModal("modal-product");
    renderProducts();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function deleteProduct(product) {
  openConfirm({
    title: "Hapus Produk",
    message: `Produk "${product.name}" akan dihapus permanen. Lanjutkan?`,
    confirmText: "Ya, Hapus",
    danger: true,
    onConfirm: async () => {
      try {
        await Api.del(`/products/${product.id}`);
        showToast("Produk berhasil dihapus.");
        renderProducts();
      } catch (e) {
        showToast(e.message, "error");
      }
    },
  });
}

// =====================================================================
// VIEW: ORDERS
// =====================================================================
// State filter, pencarian invoice, & halaman dipertahankan selagi render
const ordersState = { status: "", search: "", page: 1 };
// Order yang sedang dibuka di modal detail
let currentOrder = null;

async function renderOrders(page = 1) {
  ordersState.page = page;
  const tbody = document.getElementById("orders-tbody");
  setLoading(tbody);

  const res = await Api.get("/orders", {
    status: ordersState.status,
    search: ordersState.search,
    page,
  });
  const { items, meta } = res.data;

  tbody.innerHTML = items.length
    ? items
        .map(
          (o) => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-5 py-3 font-mono text-xs">${esc(o.invoice_number)}</td>
        <td class="px-5 py-3">${statusBadge(o.status)}</td>
        <td class="px-5 py-3">${statusBadge(o.payment_status)}</td>
        <td class="px-5 py-3">${o.total_items} item</td>
        <td class="px-5 py-3">${formatIDR(o.sub_amount)}</td>
        <td class="px-5 py-3">${formatIDR(o.tax)}</td>
        <td class="px-5 py-3 font-semibold">${formatIDR(o.total_amount)}</td>
        <td class="px-5 py-3 text-slate-500 text-xs">${formatDateTime(o.created_at)}</td>
        <td class="px-5 py-3 text-right">
          <button data-id="${o.id}" data-action="detail" class="text-teal-600 hover:text-teal-700 font-medium">Detail</button>
        </td>
      </tr>`
        )
        .join("")
    : emptyRow(9);

  tbody.querySelectorAll("button[data-action='detail']").forEach((btn) => {
    btn.addEventListener("click", () => openOrderModal(parseInt(btn.dataset.id, 10)));
  });

  renderPagination(document.getElementById("orders-pagination"), meta, renderOrders);
}

/** Buka modal detail pesanan (ambil data lengkap termasuk items). */
async function openOrderModal(orderId) {
  const body = document.getElementById("order-detail-body");
  const verifyBtn = document.getElementById("btn-verify-payment");
  setLoading(body);
  verifyBtn.classList.add("hidden");
  openModal("modal-order");

  const res = await Api.get(`/orders/${orderId}`);
  currentOrder = res.data;
  const o = currentOrder;

  body.innerHTML = `
    <dl class="grid grid-cols-2 gap-4 text-sm">
      <div><dt class="text-slate-500">Invoice</dt><dd class="font-mono font-semibold">${esc(o.invoice_number)}</dd></div>
      <div><dt class="text-slate-500">Dibuat</dt><dd>${formatDateTime(o.created_at)}</dd></div>
      <div><dt class="text-slate-500">Status Order</dt><dd>${statusBadge(o.status)}</dd></div>
      <div><dt class="text-slate-500">Status Pembayaran</dt><dd>${statusBadge(o.payment_status)}</dd></div>
    </dl>

    <div class="mt-5 overflow-x-auto rounded-xl shadow-sm">
      <table class="w-full text-sm text-left">
        <thead class="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <tr><th class="px-4 py-2.5">Produk</th><th class="px-4 py-2.5">Qty</th><th class="px-4 py-2.5">Total Item</th></tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${
            o.items.length
              ? o.items
                  .map(
                    (i) => `
            <tr>
              <td class="px-4 py-2.5">${esc(i.product_name || `Produk #${i.product_id}`)}</td>
              <td class="px-4 py-2.5">${i.qty}</td>
              <td class="px-4 py-2.5">${i.total_items}</td>
            </tr>`
                  )
                  .join("")
              : `<tr><td colspan="3" class="px-4 py-6 text-center text-slate-400">Tidak ada item</td></tr>`
          }
        </tbody>
      </table>
    </div>

    <div class="mt-5 space-y-1.5 text-sm">
      <div class="flex justify-between"><span class="text-slate-500">Subtotal (${o.total_items} item)</span><span>${formatIDR(o.sub_amount)}</span></div>
      <div class="flex justify-between"><span class="text-slate-500">Pajak</span><span>${formatIDR(o.tax)}</span></div>
      <div class="flex justify-between text-base font-bold border-t border-slate-200 pt-2">
        <span>Total</span><span class="text-teal-600">${formatIDR(o.total_amount)}</span>
      </div>
    </div>`;

  // Tombol verifikasi hanya tampil saat order 'pending' & pembayaran
  // 'unpaid' — untuk order 'success' + 'paid' tombol disembunyikan agar
  // admin tidak bisa memverifikasi dua kali.
  const canVerify = o.status === "pending" && o.payment_status === "unpaid";
  verifyBtn.classList.toggle("hidden", !canVerify);
}

/** Verifikasi pembayaran: payment -> 'paid', order -> 'success',
 *  dan stok produk berkurang. Dikonfirmasi lewat modal, bukan window.confirm. */
function verifyCurrentOrder() {
  if (!currentOrder) return;
  openConfirm({
    title: "Verifikasi Pembayaran",
    message: `Tandai pembayaran ${currentOrder.invoice_number} sebagai 'paid', ubah status pesanan menjadi 'success', dan kurangi stok produk?`,
    confirmText: "Ya, Verifikasi",
    danger: false,
    onConfirm: async () => {
      try {
        const res = await Api.patch(`/orders/${currentOrder.id}/verify-payment`);
        showToast(res.message || "Pembayaran diverifikasi & stok dikurangi.");
        // Segarkan daftar pesanan di belakang modal, lalu render ulang isi
        // modal tanpa reload halaman — status kini 'success' sehingga
        // tombol verifikasi otomatis disembunyikan.
        renderOrders(ordersState.page);
        await openOrderModal(currentOrder.id);
      } catch (e) {
        showToast(e.message, "error");
      }
    },
  });
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
const chatsState = { agentId: null, activeId: null, users: [], isManualMode: false };

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
      <div class="col-span-full bg-white rounded-2xl shadow-sm p-10 text-center">
        <p class="text-sm text-slate-500">${esc(e.message)}</p>
      </div>`;
    return;
  }

  if (!agents.length) {
    grid.innerHTML = `
      <div class="col-span-full bg-white rounded-2xl shadow-sm p-10 text-center">
        <p class="text-slate-500">Belum ada agent terdaftar.</p>
      </div>`;
    return;
  }

  grid.innerHTML = agents
    .map(
      (a) => `
    <button type="button" data-chat-agent="${esc(a.agent_id)}"
      class="text-left bg-white rounded-2xl shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="text-3xl">${esc(AGENT_CARD_EMOJI[a.agent_id] || "🤖")}</div>
        ${agentActiveBadge(a.is_active)}
      </div>
      <h4 class="font-bold text-slate-900">${esc(a.name || a.agent_id)}</h4>
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

/** Ambil daftar kontak agent terpilih lalu render pane kirinya. */
async function renderChatUserListPane() {
  const listEl = document.getElementById("chat-user-list");
  setLoading(listEl);

  const res = await Api.get(`/chats/users/${encodeURIComponent(chatsState.agentId)}`);
  chatsState.users = res.data;

  // Pertahankan seleksi bila pengguna masih ada di daftar
  if (chatsState.activeId && !chatsState.users.some((u) => u.user_id === chatsState.activeId)) {
    chatsState.activeId = null;
  }

  renderChatUserList();
  paintChatPanes();
  if (chatsState.activeId) await loadChatConversation(chatsState.activeId);
}

/** Render pane kiri: kontak diurutkan dari pesan terbaru. */
function renderChatUserList() {
  const listEl = document.getElementById("chat-user-list");
  listEl.innerHTML = chatsState.users.length
    ? chatsState.users
        .map((u) => {
          const isActive = u.user_id === chatsState.activeId;
          const name = u.full_name || u.username || `User ${u.platform_id}`;
          const channelBadge = u.channel === "whatsapp"
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">WA</span>`
            : `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold">TG</span>`;
          return `
      <button data-user-id="${esc(u.user_id)}"
        class="w-full text-left px-4 py-3 flex items-center gap-3 transition ${
          isActive ? "bg-teal-50" : "hover:bg-slate-50"
        }">
        <div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
          isActive ? "bg-teal-500 text-white" : "bg-slate-200 text-slate-600"
        }">${esc(name.charAt(0).toUpperCase())}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold ${isActive ? "text-teal-900" : "text-slate-800"} truncate">${esc(name)}</p>
            <span class="text-[10px] text-slate-400 whitespace-nowrap">${formatTime(u.last_message_at)}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-slate-500 font-mono truncate">${esc(u.platform_id || "")}</p>
            <span class="flex items-center gap-1 flex-shrink-0">
              ${channelBadge}
              ${u.is_manual_mode ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 font-semibold">Manual</span>` : ""}
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">${u.total_messages} pesan</span>
            </span>
          </div>
        </div>
      </button>`;
        })
        .join("")
    : `<div class="px-4 py-10 text-center text-sm text-slate-400">Belum ada pengguna yang chat.</div>`;

  listEl.querySelectorAll("button[data-user-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectChatUser(Number(btn.dataset.userId)));
  });
}

/** Klik kontak: ambil & render percakapan, lalu gulir ke bawah. */
async function selectChatUser(userId) {
  chatsState.activeId = userId;
  renderChatUserList(); // perbarui sorotan kontak aktif
  paintChatPanes();     // di mobile: pindah dari daftar ke jendela chat
  await loadChatConversation(userId);
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
  document.getElementById("chat-header-id").textContent = `${channelLabel} · ${conv.platform_id || ""}`;
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
  label.className = `text-xs font-medium ${isManual ? "text-teal-600" : "text-slate-500"}`;
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
      <div class="col-span-full bg-white rounded-2xl shadow-sm p-10 text-center">
        <p class="text-sm text-slate-500">${esc(e.message)}</p>
      </div>`;
    return;
  }

  if (!agents.length) {
    grid.innerHTML = `
      <div class="col-span-full bg-white rounded-2xl shadow-sm p-10 text-center">
        <p class="text-slate-500">Belum ada agent terdaftar.</p>
        <p class="text-sm text-slate-400 mt-1">Gunakan tombol “+ Tambah Agent” untuk membuat agent pertama.</p>
      </div>`;
    return;
  }

  grid.innerHTML = agents
    .map(
      (a) => `
    <button type="button" data-agent-card="${esc(a.agent_id)}"
      class="text-left bg-white rounded-2xl shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="text-3xl">${esc(AGENT_CARD_EMOJI[a.agent_id] || "🤖")}</div>
        ${agentActiveBadge(a.is_active)}
      </div>
      <h4 class="font-bold text-slate-900">${esc(a.name || a.agent_id)}</h4>
      <p class="text-xs text-slate-400 font-mono mb-3">ID: ${esc(a.agent_id)}</p>
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
    <div class="bg-white rounded-2xl shadow-sm p-10 text-center">
      <p class="text-slate-500">Konfigurasi untuk agent
        <span class="font-mono font-semibold">${esc(agentId)}</span> belum ada di database.</p>
      <p class="text-sm text-slate-400 mt-2">Tekan “⬅ Kembali” lalu tambahkan baris konfigurasinya terlebih dahulu.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="w-full bg-white rounded-2xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="font-bold text-slate-900">${esc(cfg.agent_id)}</h3>
          <p class="text-xs text-slate-400">Terakhir diubah: ${formatDateTime(cfg.updated_at)}</p>
        </div>
        <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs">${esc(cfg.provider)}</span>
      </div>
      <form data-config-id="${cfg.id}" class="space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Nama Tampilan</label>
            <input name="name" value="${esc(cfg.name || "")}" maxlength="100" placeholder="cth: Bot Pulsa"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Provider</label>
            <input name="provider" value="${esc(cfg.provider)}" required
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Temperature (0–2)</label>
            <input name="temperature" type="number" step="0.1" min="0" max="2" value="${esc(cfg.temperature)}" required
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Model</label>
            <select name="model_name"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              ${modelOptions}
            </select>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Telegram Token</label>
          <div class="relative">
            <input name="telegram_token" type="password" data-token-input value="${esc(cfg.telegram_token || "")}"
              autocomplete="off" spellcheck="false"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 pr-12 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
              placeholder="token bot Telegram (BotFather)" />
            <button type="button" data-token-toggle title="Tampilkan token"
              class="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-1 text-base leading-none rounded hover:bg-slate-100">👁️</button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">System Prompt</label>
          <textarea name="system_prompt" rows="12" required
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500">${esc(cfg.system_prompt)}</textarea>
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
          <button type="submit" class="bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm hover:shadow-md transition-all">Simpan Perubahan</button>
        </div>
      </form>
    </div>`;

  // Pre-select model tersimpan, pasang toggle mata, lalu handler submit
  const form = container.querySelector("form[data-config-id]");
  form.querySelector("select[name='model_name']").value = cfg.model_name;
  bindTokenEyeToggle(form);

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
// Daftar bisa dilihat semua role admin; upload & hapus hanya superadmin
// (sesuai RBAC backend: GET admin_required, POST/DELETE superadmin_only).
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

  await fetchDocuments();
}

/** Ambil daftar dokumen dari GET /api/knowledge-base lalu render tabel. */
async function fetchDocuments() {
  const tbody = document.getElementById("kb-tbody");
  setLoading(tbody);

  const res = await Api.get("/knowledge-base");
  const documents = res.data;
  const isSuper = App.user && App.user.role === "superadmin";

  tbody.innerHTML = documents.length
    ? documents
        .map(
          (d) => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-5 py-3">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
            </svg>
            <span class="font-medium text-slate-800 break-all">${esc(d.file_name)}</span>
          </div>
        </td>
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
    : emptyRow(4, "Belum ada dokumen. Unggah PDF untuk menambah pengetahuan bot.");

  // Pasang listener hapus pada tiap tombol (tombol hanya dirender utk superadmin)
  tbody.querySelectorAll("button[data-action='delete']").forEach((btn) => {
    const doc = documents.find((d) => d.id === parseInt(btn.dataset.id, 10));
    btn.addEventListener("click", () => deleteDocument(doc));
  });
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
// VIEW: ADMIN MANAGEMENT (superadmin)
// =====================================================================
async function renderAdmins() {
  const tbody = document.getElementById("admins-tbody");
  setLoading(tbody);

  const res = await Api.get("/admins");
  const admins = res.data;

  tbody.innerHTML = admins.length
    ? admins
        .map(
          (a) => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-5 py-3 text-slate-400">${a.id}</td>
        <td class="px-5 py-3 font-semibold">${esc(a.username)}</td>
        <td class="px-5 py-3">${esc(a.full_name)}</td>
        <td class="px-5 py-3">${statusBadge(a.role)}</td>
        <td class="px-5 py-3">${statusBadge(a.is_active ? "active" : "inactive")}</td>
        <td class="px-5 py-3 text-slate-500 text-xs">${formatDateTime(a.created_at)}</td>
        <td class="px-5 py-3 text-right whitespace-nowrap">
          <button data-action="edit" data-id="${a.id}" class="text-teal-600 hover:text-teal-700 font-medium mr-3">Edit</button>
          <button data-action="delete" data-id="${a.id}" class="text-red-600 hover:text-red-800 font-medium">Hapus</button>
        </td>
      </tr>`
        )
        .join("")
    : emptyRow(7);

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    const admin = admins.find((a) => a.id === parseInt(btn.dataset.id, 10));
    if (btn.dataset.action === "edit") {
      btn.addEventListener("click", () => openAdminModal(admin));
    } else {
      btn.addEventListener("click", () => deleteAdmin(admin));
    }
  });
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
  openModal("modal-admin");
}

async function handleAdminSubmit(event) {
  event.preventDefault();
  const id = document.getElementById("admin-id").value;
  const payload = {
    username: document.getElementById("admin-username").value.trim(),
    full_name: document.getElementById("admin-full-name").value.trim(),
    role: document.getElementById("admin-role").value,
    is_active: document.getElementById("admin-is-active").checked,
  };
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

  // Logout
  document.getElementById("logout-btn").addEventListener("click", handleLogout);

  // Sidebar mobile
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    sidebar.classList.toggle("-translate-x-full");
    overlay.classList.toggle("hidden");
  });
  document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar);

  // Tutup modal lewat tombol/elemen bertanda data-close-modal
  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeAllModals);
  });

  // Modal Tambah Agent: kosongkan form saat ditutup lewat Batal/overlay
  // agar input lama tidak terbawa saat modal dibuka berikutnya.
  document.querySelectorAll("#modal-agent [data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => document.getElementById("agent-create-form").reset());
  });

  // Form produk & admin
  document.getElementById("product-form").addEventListener("submit", handleProductSubmit);
  document.getElementById("admin-form").addEventListener("submit", handleAdminSubmit);
  document.getElementById("btn-add-product").addEventListener("click", () => openProductModal());
  document.getElementById("btn-add-admin").addEventListener("click", () => openAdminModal());

  // Filter status pesanan
  document.getElementById("order-status-filter").addEventListener("change", (event) => {
    ordersState.status = event.target.value;
    renderOrders(1);
  });

  // Pencarian nomor invoice (dengan debounce agar tidak spam request)
  let searchTimer = null;
  document.getElementById("order-search").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      ordersState.search = event.target.value.trim();
      renderOrders(1);
    }, 300);
  });

  // Tombol persetujuan modal konfirmasi: jalankan aksi tersimpan
  document.getElementById("confirm-ok").addEventListener("click", () => {
    const action = confirmAction;
    confirmAction = null;
    closeModal("modal-confirm");
    if (action) action();
  });

  // Verifikasi pembayaran dari modal detail pesanan
  document.getElementById("btn-verify-payment").addEventListener("click", verifyCurrentOrder);

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

  // Jalankan router pertama kali (hash default -> sesuai status login)
  if (!window.location.hash) {
    window.location.hash = Api.getToken() ? "#dashboard" : "#login";
  }
  navigate();
});
