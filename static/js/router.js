/**
 * =====================================================================
 * router.js — Hash Router Sederhana
 * ---------------------------------------------------------------------
 * - Berpindah "halaman" dengan menampilkan/menyembunyikan container DOM
 *   berdasarkan hash URL: #dashboard, #products, #orders, dst.
 * - Guard autentikasi: tanpa token di localStorage -> dipaksa ke #login.
 * - Guard RBAC: route bertanda `superadminOnly` ditolak untuk role 'admin'.
 * =====================================================================
 */

/**
 * Tabel rute. `render` adalah fungsi yang didefinisikan di app.js
 * dan dipanggil setiap kali route diakses.
 */
const Routes = {
  login: { view: "view-login", public: true },
  dashboard: { view: "view-dashboard", title: "Dashboard", render: () => renderDashboard() },
  products: { view: "view-products", title: "Produk", render: () => renderProducts() },
  orders: { view: "view-orders", title: "Pesanan", render: () => renderOrders() },
  chats: { view: "view-chats", title: "Riwayat Chat", render: () => renderChats() },
  "knowledge-base": {
    view: "view-knowledge-base",
    title: "Knowledge Base",
    render: () => renderKnowledgeBase(),
  },
  "agent-config": {
    view: "view-agent",
    title: "Agent Config",
    render: () => renderAgentConfig(),
    superadminOnly: true,
  },
  "admin-management": {
    view: "view-admins",
    title: "Manajemen Admin",
    render: () => renderAdmins(),
    superadminOnly: true,
  },
};

/** Ambil nama route aktif dari URL hash, cth: "#orders" -> "orders". */
function currentRouteName() {
  return window.location.hash.replace(/^#/, "") || "";
}

/** Sembunyikan semua view, lalu tampilkan satu view tertentu. */
function showView(viewId) {
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  const target = document.getElementById(viewId);
  if (target) target.classList.remove("hidden");
}

/** Tandai link navigasi di sidebar sesuai route aktif. */
function setActiveNav(name) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    const isActive = link.dataset.route === name;
    // Route aktif: efek kaca putih + teks putih penuh; inaktif semi-transparan
    link.classList.toggle("bg-white/20", isActive);
    link.classList.toggle("text-white", isActive);
    link.classList.toggle("text-white/70", !isActive);
  });
}

/**
 * Titik masuk router — dipanggil oleh event `hashchange` dan saat init.
 */
async function navigate() {
  const name = currentRouteName();
  const route = Routes[name];

  // ---- GUARD 1: belum login -> paksa ke #login ----
  if (!Api.getToken()) {
    if (name !== "login") {
      window.location.hash = "#login";
      return; // hashchange akan memicu navigate() lagi
    }
    showView("view-login");
    document.getElementById("app-shell").classList.add("hidden");
    return;
  }

  // ---- GUARD 2: token ada tapi state user belum dimuat (mis. refresh) ----
  if (!App.user) {
    try {
      const res = await Api.get("/auth/me");
      App.user = res.data; // { id, username, full_name, role, ... }
    } catch (e) {
      // 401 sudah ditangani api.js (redirect ke #login);
      // error lain cukup dilaporkan.
      showToast(e.message, "error");
      return;
    }
  }

  // Tampilkan shell aplikasi + terapkan RBAC pada UI (sembunyikan menu)
  document.getElementById("app-shell").classList.remove("hidden");
  applyRbacUi();

  // ---- GUARD 3: route tidak dikenal / masih di #login -> dashboard ----
  if (!route || route.public) {
    if (name !== "dashboard") {
      window.location.hash = "#dashboard";
      return;
    }
  }

  // ---- GUARD 4: route khusus superadmin ----
  if (route && route.superadminOnly && App.user.role !== "superadmin") {
    showToast("Halaman tersebut hanya dapat diakses superadmin.", "error");
    window.location.hash = "#dashboard";
    return;
  }

  // ---- Render route aktif ----
  const active = route ? name : "dashboard";
  showView(Routes[active].view);
  document.getElementById("page-title").textContent = Routes[active].title;
  setActiveNav(active);
  closeSidebar(); // tutup sidebar di layar mobile setelah berpindah halaman

  try {
    await Routes[active].render();
  } catch (e) {
    showToast(e.message, "error");
  }
}

window.addEventListener("hashchange", navigate);
