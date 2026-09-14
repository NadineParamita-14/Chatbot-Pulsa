/**
 * =====================================================================
 * api.js — Wrapper fetch API
 * ---------------------------------------------------------------------
 * - Otomatis menyuntikkan header `Authorization: Bearer <JWT>` dari localStorage.
 * - Menyeragamkan penanganan error berdasarkan format respons backend:
 *   { "status": "success"|"error", "data": {}, "message": "..." }
 * - Bila API mengembalikan 401 (token hilang/kedaluwarsa), token dihapus
 *   dan pengguna diarahkan kembali ke #login.
 * =====================================================================
 */
const Api = (() => {
  const TOKEN_KEY = "admin_token";
  const BASE_URL = "/api";

  /** Ambil token JWT dari localStorage. */
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  /** Simpan / hapus token (null = hapus). */
  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  /**
   * Fungsi inti request. `params` akan diserialisasi menjadi query string.
   * Selalu melempar Error dengan pesan dari backend bila gagal.
   */
  async function request(path, { method = "GET", body = null, params = {} } = {}) {
    // Bangun URL + query string
    const url = new URL(BASE_URL + path, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });

    // Header dasar + Bearer token bila ada
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      // Kegagalan jaringan / server mati
      throw new Error("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
    }

    // Respons backend dijamin JSON; guard tetap dipasang bila bukan JSON
    let json = null;
    try {
      json = await res.json();
    } catch (parseErr) {
      /* biarkan json = null */
    }

    // 401 -> sesi habis / token tidak valid: paksa logout & ke halaman login
    if (res.status === 401) {
      setToken(null);
      if (window.location.hash !== "#login") {
        window.location.hash = "#login";
      }
      throw new Error((json && json.message) || "Sesi berakhir, silakan login kembali.");
    }

    // Status HTTP gagal atau backend eksplisit melaporkan error
    if (!res.ok || (json && json.status === "error")) {
      throw new Error((json && json.message) || `Terjadi kesalahan (HTTP ${res.status}).`);
    }

    return json; // { status, data, message }
  }

  // API publik yang ringkas dipakai di seluruh aplikasi
  return {
    getToken,
    setToken,
    get: (path, params) => request(path, { params }),
    post: (path, body) => request(path, { method: "POST", body }),
    put: (path, body) => request(path, { method: "PUT", body }),
    patch: (path, body) => request(path, { method: "PATCH", body }),
    del: (path) => request(path, { method: "DELETE" }),
  };
})();
