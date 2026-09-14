"""
=====================================================================
 Admin Panel API — Flask + SQLAlchemy + PyJWT
---------------------------------------------------------------------
 Sistem: Telegram Bot penjual produk digital (Pulsa)

 - Autentikasi  : JWT (PyJWT), token dikirim via header `Authorization: Bearer`
 - RBAC         : @admin_required (admin + superadmin),
                  @superadmin_required (hanya superadmin)
 - Format JSON  : { "status": "success"|"error", "data": {}, "message": "..." }

 Catatan impor:
 `my_agent/__init__.py` mengimpor `agent.py` (Google ADK + dependensi bot),
 jadi model diambil LANGSUNG dari my_agent/models.py lewat sys.path
 agar admin panel tidak ikut memuat dependensi bot Telegram/ADK.
=====================================================================
"""

import io
import os
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

import jwt
import PyPDF2
import requests
from flask import Flask, g, jsonify, render_template, request
from flask_cors import CORS
from sqlalchemy import func
from sqlalchemy.orm import joinedload
from werkzeug.security import check_password_hash, generate_password_hash

# ---------------------------------------------------------------------
# Impor modul model dari my_agent/models.py
# ---------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
MY_AGENT_DIR = BASE_DIR / "my_agent"
sys.path.insert(0, str(MY_AGENT_DIR))

from models import (  # noqa: E402
    Admin,
    AdminRole,
    AgentConfig,
    ChatHistory,
    Document,
    ModelAgent,
    Order,
    OrderItem,
    OrderPayment,
    Product,
    RagDocument,
    SessionLocal,
    User,
)

# Logika bisnis order (verifikasi + potong stok) dibagi pakai dengan bot
from db_service import (  # noqa: E402
    check_order_status,
    create_new_agent_config,
    create_new_order,
    get_agent_config,
    get_agent_telegram_token,
    get_all_rag_knowledge,
    get_chatted_users,
    get_chat_history as fetch_agent_chat_history,  # hindari bentrok nama route
    get_last_10_history,
    get_or_create_user,
    get_products_json_string,
    is_agent_active,
    is_user_in_manual_mode,
    mark_order_as_paid,
    save_chat_history,
)

# .env di root (untuk JWT_SECRET dsb). models.py sendiri sudah memuat
# my_agent/.env (DATABASE_URL) saat diimpor.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BASE_DIR / ".env")

# ---------------------------------------------------------------------
# Konfigurasi Aplikasi
# ---------------------------------------------------------------------
app = Flask(__name__)

# CORS: frontend SPA diizinkan memanggil semua endpoint /api/*
CORS(app, resources={r"/api/*": {"origins": "*"}})

JWT_SECRET = os.getenv("JWT_ADMIN_SECRET", "rahasia-dev-ganti-di-produksi")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "12"))


# =====================================================================
# SESI DATABASE
# Satu session SQLAlchemy per request, disimpan di flask.g,
# lalu ditutup otomatis setelah request selesai (teardown).
# =====================================================================
def get_db():
    """Ambil (atau buat) session DB untuk request yang sedang berjalan."""
    if "db" not in g:
        g.db = SessionLocal()
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    """Wajib: pastikan session ditutup/rollback setiap akhir request."""
    db = g.pop("db", None)
    if db is not None:
        if exception is not None:
            db.rollback()
        db.close()


# =====================================================================
# HELPER RESPONS JSON TERSTANDAR
# =====================================================================
def ok(data=None, message="OK", code=200):
    return jsonify({"status": "success", "data": data, "message": message}), code


def err(message="Terjadi kesalahan", code=400, data=None):
    return jsonify({"status": "error", "data": data, "message": message}), code


def api_endpoint(fn):
    """Dekorator kecil: tangkap exception -> respons error terstandar."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ValueError as e:  # kesalahan validasi input
            get_db().rollback()
            return err(str(e), 400)
        except Exception as e:  # kesalahan tak terduga
            get_db().rollback()
            return err(f"Kesalahan server: {e}", 500)

    return wrapper


# =====================================================================
# AUTENTIKASI & RBAC DECORATORS
# =====================================================================
def create_token(admin: Admin) -> str:
    """Buat JWT berisi identitas admin (kadaluarsa sesuai JWT_EXPIRE_HOURS)."""
    payload = {
        "sub": str(admin.id),
        "username": admin.username,
        "full_name": admin.full_name,
        "role": admin.role.value if isinstance(admin.role, AdminRole) else str(admin.role),
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(header_value: str):
    """Validasi header Authorization. Kembalikan (payload, None) atau (None, pesan)."""
    if not header_value or not header_value.startswith("Bearer "):
        return None, "Token tidak ditemukan, silakan login."
    token = header_value.split(" ", 1)[1]
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM]), None
    except jwt.ExpiredSignatureError:
        return None, "Token kedaluwarsa, silakan login kembali."
    except jwt.InvalidTokenError:
        return None, "Token tidak valid."


# =====================================================================
# TOKEN BLACKLIST (untuk endpoint logout)
# JWT sifatnya stateless; agar logout benar-benar mencabut token,
# klaim (sub, exp) token yang di-logout disimpan sementara di memori.
# Cukup untuk proses tunggal (development). Untuk produksi multi-worker,
# ganti dengan penyimpanan bersama (Redis, tabel DB, dsb).
# =====================================================================
_token_blacklist: set = set()


def _blacklist_token(payload: dict) -> None:
    """Catat token sebagai dicabut sampai waktu kedaluwarsanya."""
    entry = (payload.get("sub"), int(payload.get("exp", 0)))
    _token_blacklist.add(entry)
    # Buang entri yang sudah kedaluwarsa agar set tidak tumbuh tanpa batas
    now = int(datetime.now(timezone.utc).timestamp())
    _token_blacklist.difference_update(t for t in _token_blacklist if t[1] <= now)


def _is_blacklisted(payload: dict) -> bool:
    return (payload.get("sub"), int(payload.get("exp", 0))) in _token_blacklist


def _load_current_admin(payload):
    """Ambil admin dari DB berdasarkan klaim `sub` dan pastikan aktif."""
    db = get_db()
    admin = db.get(Admin, int(payload["sub"]))
    if admin is None or not admin.is_active:
        return None
    g.current_admin = admin
    g.token_payload = payload  # dipakai endpoint logout untuk mencabut token
    return admin


def admin_required(fn):
    """Izinkan role 'admin' dan 'superadmin' (harus login & aktif)."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        payload, error = _decode_token(request.headers.get("Authorization"))
        if error:
            return err(error, 401)
        if _is_blacklisted(payload):
            return err("Token sudah di-logout, silakan login kembali.", 401)
        if _load_current_admin(payload) is None:
            return err("Akun tidak ditemukan atau sedang nonaktif.", 403)
        return fn(*args, **kwargs)

    return wrapper


def superadmin_required(fn):
    """Hanya izinkan role 'superadmin'."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        payload, error = _decode_token(request.headers.get("Authorization"))
        if error:
            return err(error, 401)
        if _is_blacklisted(payload):
            return err("Token sudah di-logout, silakan login kembali.", 401)
        admin = _load_current_admin(payload)
        if admin is None:
            return err("Akun tidak ditemukan atau sedang nonaktif.", 403)
        if admin.role != AdminRole.SUPERADMIN:
            return err("Akses ditolak: halaman ini khusus superadmin.", 403)
        return fn(*args, **kwargs)

    return wrapper


# =====================================================================
# SERIALIZER (model -> dict JSON)
# =====================================================================
def _iso(dt):
    return dt.isoformat() if dt else None


def serialize_admin(a: Admin) -> dict:
    return {
        "id": a.id,
        "username": a.username,
        "full_name": a.full_name,
        "role": a.role.value if isinstance(a.role, AdminRole) else str(a.role),
        "is_active": a.is_active,
        "created_at": _iso(a.created_at),
        "updated_at": _iso(a.updated_at),
    }


def serialize_product(p: Product) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "qty": p.qty,
        "price": float(p.price),
        "description": p.description,
        "created_at": _iso(p.created_at),
        "updated_at": _iso(p.updated_at),
    }


def serialize_order_item(i: OrderItem) -> dict:
    return {
        "id": i.id,
        "order_id": i.order_id,
        "product_id": i.product_id,
        "product_name": i.product.name if i.product else None,
        "qty": i.qty,
        "total_items": i.total_items,
    }


def serialize_order(o: Order, with_items: bool = True) -> dict:
    data = {
        "id": o.id,
        "invoice_number": o.invoice_number,
        "status": o.status,
        "sub_amount": float(o.sub_amount),
        "tax": float(o.tax),
        "total_amount": float(o.total_amount),
        "total_items": o.total_items,
        "telegram_id": o.telegram_id,
        "payment_status": o.payment.status if o.payment else None,
        "created_at": _iso(o.created_at),
        "updated_at": _iso(o.updated_at),
    }
    if with_items:
        data["items"] = [serialize_order_item(i) for i in o.items]
    return data


def serialize_chat(c: ChatHistory) -> dict:
    return {
        "id": c.id,
        "telegram_id": c.telegram_id,
        "user_name": c.user.full_name if c.user else None,
        "username": c.user.username if c.user else None,
        "agent_id": c.agent_id,
        "model_name": c.model_name,
        "input": c.input,
        "output": c.output,
        "created_at": _iso(c.created_at),
    }


def serialize_agent_config(cfg: AgentConfig) -> dict:
    return {
        "id": cfg.id,
        "agent_id": cfg.agent_id,
        "name": cfg.name,
        "telegram_token": cfg.telegram_token,
        "is_active": bool(cfg.is_active),
        "provider": cfg.provider,
        "model_name": cfg.model_name,
        "system_prompt": cfg.system_prompt,
        "temperature": cfg.temperature,
        "created_at": _iso(cfg.created_at),
        "updated_at": _iso(cfg.updated_at),
    }


# =====================================================================
# HELPER PAGINASI & VALIDASI
# =====================================================================
def paginate(query, default_per_page=20):
    """Potong query menjadi halaman. Kembalikan (items, meta)."""
    page = max(request.args.get("page", 1, type=int) or 1, 1)
    per_page = min(max(request.args.get("per_page", default_per_page, type=int) or default_per_page, 1), 100)
    total = query.count()
    items = query.offset((page - 1) * per_page).limit(per_page).all()
    meta = {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": (total + per_page - 1) // per_page,
    }
    return items, meta


def parse_decimal(value, field: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"Kolom '{field}' harus berupa angka.")


# =====================================================================
# ROUTE: HALAMAN SPA
# =====================================================================
@app.route("/")
def index():
    """Satu-satunya halaman HTML — seluruh UI dikelola router hash di frontend."""
    return render_template("index.html")


# =====================================================================
# ENDPOINT: AUTH
# =====================================================================
@app.route("/api/auth/login", methods=["POST"])
@api_endpoint
def login():
    db = get_db()
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    if not username or not password:
        raise ValueError("Username dan password wajib diisi.")

    admin = db.query(Admin).filter_by(username=username).first()
    # Pesan error sengaja sama agar tidak membocorkan username yang terdaftar
    if admin is None or not check_password_hash(admin.password_hash, password):
        return err("Username atau password salah.", 401)
    if not admin.is_active:
        return err("Akun Anda dinonaktifkan. Hubungi superadmin.", 403)

    db.refresh(admin)  # pastikan updated_at terbaca
    return ok(
        data={"token": create_token(admin), "admin": serialize_admin(admin)},
        message="Login berhasil.",
    )


@app.route("/api/auth/me", methods=["GET"])
@admin_required
@api_endpoint
def me():
    """Profil admin yang sedang login (dipakai frontend saat refresh halaman)."""
    return ok(data=serialize_admin(g.current_admin))


@app.route("/api/auth/logout", methods=["POST"])
@admin_required
@api_endpoint
def logout():
    """Cabut token saat ini: klaim (sub, exp) dimasukkan ke blacklist
    sehingga token yang sama tidak bisa dipakai lagi meski belum kedaluwarsa."""
    _blacklist_token(g.token_payload)
    return ok(message="Logout berhasil.")


# =====================================================================
# ENDPOINT: DASHBOARD
# =====================================================================
@app.route("/api/dashboard/stats", methods=["GET"])
@admin_required
@api_endpoint
def dashboard_stats():
    db = get_db()

    # Pendapatan = total order yang pembayarannya sudah 'paid'
    revenue = (
        db.query(func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .join(OrderPayment, OrderPayment.order_id == Order.id)
        .filter(OrderPayment.status == "paid")
        .scalar()
    )

    status_counts = dict(
        db.query(Order.status, func.count(Order.id)).group_by(Order.status).all()
    )

    stats = {
        "total_revenue": float(revenue or 0),
        "total_orders": sum(status_counts.values()),
        "pending_orders": status_counts.get("pending", 0),
        "success_orders": status_counts.get("success", 0),
        "failed_orders": status_counts.get("failed", 0),
        "total_products": db.query(func.count(Product.id)).scalar() or 0,
        "total_stock": db.query(func.coalesce(func.sum(Product.qty), 0)).scalar() or 0,
        "total_customers": db.query(func.count(User.id)).scalar() or 0,
        "total_chats": db.query(func.count(ChatHistory.id)).scalar() or 0,
        # Chat sejak awal hari ini (batas hari mengikuti UTC server)
        "chats_today": db.query(func.count(ChatHistory.id))
        .filter(ChatHistory.created_at >= datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0))
        .scalar()
        or 0,
    }

    # 5 order terbaru untuk tabel ringkasan
    recent = (
        db.query(Order)
        .options(joinedload(Order.payment))
        .order_by(Order.created_at.desc())
        .limit(5)
        .all()
    )
    stats["recent_orders"] = [serialize_order(o, with_items=False) for o in recent]

    return ok(data=stats)


# =====================================================================
# ENDPOINT: PRODUCTS (CRUD — tulis hanya superadmin)
# =====================================================================
@app.route("/api/products", methods=["GET"])
@admin_required
@api_endpoint
def list_products():
    db = get_db()
    products = db.query(Product).order_by(Product.created_at.desc()).all()
    return ok(data=[serialize_product(p) for p in products])


def _product_from_payload(data, product: Product) -> Product:
    """Validasi & terapkan payload produk ke objek Product."""
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("Nama produk wajib diisi.")
    if len(name) > 150:
        raise ValueError("Nama produk maksimal 150 karakter.")

    try:
        qty = int(data.get("qty", 0))
    except (TypeError, ValueError):
        raise ValueError("Stok (qty) harus berupa bilangan bulat.")
    if qty < 0:
        raise ValueError("Stok (qty) tidak boleh negatif.")

    price = parse_decimal(data.get("price"), "price")
    if price < 0:
        raise ValueError("Harga tidak boleh negatif.")

    product.name = name
    product.qty = qty
    product.price = price
    product.description = (data.get("description") or "").strip() or None
    return product


@app.route("/api/products", methods=["POST"])
@superadmin_required
@api_endpoint
def create_product():
    db = get_db()
    body = request.get_json(silent=True) or {}
    product = _product_from_payload(body, Product())
    db.add(product)
    db.commit()
    return ok(data=serialize_product(product), message="Produk berhasil ditambahkan.", code=201)


@app.route("/api/products/<int:product_id>", methods=["PUT"])
@superadmin_required
@api_endpoint
def update_product(product_id: int):
    db = get_db()
    product = db.get(Product, product_id)
    if product is None:
        return err("Produk tidak ditemukan.", 404)
    body = request.get_json(silent=True) or {}
    _product_from_payload(body, product)
    db.commit()
    return ok(data=serialize_product(product), message="Produk berhasil diperbarui.")


@app.route("/api/products/<int:product_id>", methods=["DELETE"])
@superadmin_required
@api_endpoint
def delete_product(product_id: int):
    db = get_db()
    product = db.get(Product, product_id)
    if product is None:
        return err("Produk tidak ditemukan.", 404)

    # orders_items.product_id memakai ondelete="RESTRICT" -> cek dulu
    used = db.query(OrderItem).filter_by(product_id=product_id).first()
    if used is not None:
        return err("Produk tidak dapat dihapus karena sudah digunakan dalam pesanan.", 400)

    db.delete(product)
    db.commit()
    return ok(message="Produk berhasil dihapus.")


# =====================================================================
# ENDPOINT: ORDERS (read + verifikasi pembayaran)
# =====================================================================
@app.route("/api/orders", methods=["GET"])
@admin_required
@api_endpoint
def list_orders():
    db = get_db()
    query = db.query(Order).options(
        joinedload(Order.payment),
        joinedload(Order.items).joinedload(OrderItem.product),
    )

    status = (request.args.get("status") or "").strip().lower()
    if status in ("pending", "success", "failed"):
        query = query.filter(Order.status == status)

    # Pencarian nomor invoice (parsel, tidak peka huruf besar/kecil)
    search = (request.args.get("search") or "").strip()
    if search:
        query = query.filter(Order.invoice_number.ilike(f"%{search}%"))

    query = query.order_by(Order.created_at.desc())
    orders, meta = paginate(query, default_per_page=20)
    return ok(data={"items": [serialize_order(o) for o in orders], "meta": meta})


@app.route("/api/orders/<int:order_id>", methods=["GET"])
@admin_required
@api_endpoint
def get_order(order_id: int):
    db = get_db()
    order = (
        db.query(Order)
        .options(joinedload(Order.payment), joinedload(Order.items).joinedload(OrderItem.product))
        .filter(Order.id == order_id)
        .first()
    )
    if order is None:
        return err("Pesanan tidak ditemukan.", 404)
    return ok(data=serialize_order(order))


@app.route("/api/orders/<int:order_id>/verify-payment", methods=["PATCH"])
@admin_required
@api_endpoint
def verify_payment(order_id: int):
    """Set pembayaran jadi 'paid', status order jadi 'success', dan potong
    stok produk — delegasi ke mark_order_as_paid agar logikanya identik
    dengan alur verifikasi lewat bot (stok hanya terpotong sekali)."""
    db = get_db()
    order = db.get(Order, order_id)
    if order is None:
        return err("Pesanan tidak ditemukan.", 404)

    result = mark_order_as_paid(order.invoice_number)
    if result.get("status") != "success":
        # status 'info' berarti order sudah 'success' sebelumnya -> 409 Conflict
        code = 409 if result.get("status") == "info" else 400
        return err(result.get("message", "Verifikasi pembayaran gagal."), code)

    # Ambil ulang data terbaru: status & stok sudah berubah di DB lewat
    # session lain (mark_order_as_paid memakai SessionLocal sendiri).
    db.expire_all()
    order = (
        db.query(Order)
        .options(joinedload(Order.payment), joinedload(Order.items).joinedload(OrderItem.product))
        .filter(Order.id == order_id)
        .first()
    )
    return ok(
        data=serialize_order(order),
        message=result.get("message", "Pembayaran diverifikasi & stok dikurangi."),
    )


# Agent pemilik bot transaksi: sumber token Telegram untuk notifikasi
# pembayaran & balasan manual admin (pesanan dibuat oleh bot penjualan).
# Token diambil dari DATABASE — sama seperti bot.py — bukan dari .env.
NOTIFY_AGENT_ID = "pulsa_agent"


def _notify_buyer(invoice_number: str) -> dict:
    """Kirim pesan Telegram 'pembayaran terverifikasi' ke pemilik invoice.
    Bersifat best-effort: selalu mengembalikan {"sent": bool, "detail": str}
    dan TIDAK melempar exception — kegagalan kirim tidak boleh menggagalkan
    webhook karena pembayaran sendiri sudah tercatat di database.

    Token bot diambil dari tabel agent_configs (kolom telegram_token milik
    NOTIFY_AGENT_ID). Bila konfigurasi/token belum diisi, notifikasi
    dilewati dengan aman (dilog ke terminal) tanpa crash.
    """
    db = get_db()
    order = db.query(Order).filter_by(invoice_number=invoice_number).first()
    if order is None or not order.telegram_id:
        return {"sent": False, "detail": "Order tidak memiliki telegram_id — notifikasi dilewati."}

    bot_token = get_agent_telegram_token(NOTIFY_AGENT_ID)
    if not bot_token:
        print(f"[NOTIF] Token Telegram '{NOTIFY_AGENT_ID}' belum diisi di Admin Panel — notifikasi dilewati.")
        return {
            "sent": False,
            "detail": f"Token Telegram '{NOTIFY_AGENT_ID}' belum diisi di Admin Panel — notifikasi dilewati.",
        }

    text = (
        f"✅ *Pembayaran untuk invoice {invoice_number} telah berhasil "
        f"diverifikasi. Pesanan Anda sedang diproses!*"
    )
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": order.telegram_id, "text": text, "parse_mode": "Markdown"},
            timeout=15,
        )
        result = resp.json()
        if result.get("ok"):
            return {"sent": True, "detail": "Notifikasi Telegram terkirim."}
        return {"sent": False, "detail": f"Telegram menolak pesan: {result.get('description', 'tidak diketahui')}"}
    except requests.RequestException as e:
        return {"sent": False, "detail": f"Gagal menghubungi Telegram: {e}"}


# =====================================================================
# ENDPOINT: PAYMENT WEBHOOK — callback dari Payment Gateway (simulasi)
# Sengaja TANPA @admin_required: pemanggilnya adalah gateway, bukan admin.
# Autentikasi dilakukan lewat `secret_key` di dalam payload JSON.
# =====================================================================
PAYMENT_CALLBACK_SECRET = os.getenv("PAYMENT_CALLBACK_SECRET", "my_secret_key_123")


@app.route("/api/payments/callback", methods=["POST"])
def payment_callback():
    """Terima konfirmasi pembayaran dari Payment Gateway.

    Payload yang diharapkan:
        {"invoice_number": "INV-XXXXXXX", "status": "success",
         "secret_key": "my_secret_key_123"}

    - secret_key salah / tidak ada -> 403 Forbidden
    - JSON rusak / bukan object    -> 400 Bad Request
    - status == 'success'          -> mark_order_as_paid (stok ikut dipotong)
    - status lain                  -> DB tidak diubah, tetap 200
                                      (ACK agar gateway berhenti mengulang)
    """
    try:
        # silent=True: JSON rusak menghasilkan None (bukan exception),
        # sehingga balasan tetap berbentuk JSON yang rapi.
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return err("Format JSON tidak valid.", 400)

        secret_key = payload.get("secret_key") or ""
        invoice_number = (payload.get("invoice_number") or "").strip()
        status = (payload.get("status") or "").strip().lower()

        # 1. Validasi keamanan: secret_key harus persis sama
        if secret_key != PAYMENT_CALLBACK_SECRET:
            return err("Forbidden: secret_key tidak valid.", 403)

        if not invoice_number:
            return err("Field 'invoice_number' wajib diisi.", 400)

        # 2. Hanya status 'success' yang memicu pembaruan order + potong stok
        if status == "success":
            result = mark_order_as_paid(invoice_number)
            processed = result.get("status") in ("success", "info")

            # 2b. Notifikasi Telegram ke pembeli — HANYA saat verifikasi baru.
            # status 'info' = callback duplikat (order sudah sukses): jangan
            # kirim ulang pesan agar user tidak spam.
            notification = None
            if result.get("status") == "success":
                notification = _notify_buyer(invoice_number)

            return ok(
                data={
                    "invoice_number": invoice_number,
                    "processed": processed,
                    "order_status": result.get("order_status"),
                    "payment_status": result.get("payment_status"),
                    "notification": notification,
                },
                message=result.get("message", "Callback pembayaran diproses."),
            )

        # 3. Status lain: cukup terima kabar, jangan sentuh database
        return ok(
            data={
                "invoice_number": invoice_number,
                "status": status or None,
                "processed": False,
            },
            message=f"Callback diterima: status '{status or '-'}' tidak memicu pembaruan pesanan.",
        )
    except Exception as e:
        return err(f"Kesalahan server: {e}", 500)


# =====================================================================
# ENDPOINT: CHATS (read-only)
# =====================================================================
@app.route("/api/chats", methods=["GET"])
@admin_required
@api_endpoint
def list_chats():
    db = get_db()
    query = db.query(ChatHistory).options(joinedload(ChatHistory.user))

    telegram_id = (request.args.get("telegram_id") or "").strip()
    if telegram_id:
        query = query.filter(ChatHistory.telegram_id == telegram_id)

    query = query.order_by(ChatHistory.created_at.desc())
    chats, meta = paginate(query, default_per_page=20)
    return ok(data={"items": [serialize_chat(c) for c in chats], "meta": meta})


# =====================================================================
# ENDPOINT: CHATS — tampilan WhatsApp-like (daftar kontak + percakapan)
# =====================================================================
@app.route("/api/chats/users", methods=["GET"])
@admin_required
@api_endpoint
def list_chat_users():
    """Daftar pengguna unik yang pernah chat dengan bot.
    Diurutkan dari pesan terakhir (terbaru di atas) untuk kontak list.
    """
    db = get_db()
    rows = (
        db.query(
            ChatHistory.telegram_id,
            User.full_name,
            User.username,
            User.is_manual_mode,
            func.max(ChatHistory.created_at).label("last_message_at"),
            func.count(ChatHistory.id).label("total_messages"),
        )
        .outerjoin(User, User.telegram_id == ChatHistory.telegram_id)
        .group_by(ChatHistory.telegram_id, User.full_name, User.username, User.is_manual_mode)
        .order_by(func.max(ChatHistory.created_at).desc())
        .all()
    )
    return ok(
        data=[
            {
                "telegram_id": r.telegram_id,
                "full_name": r.full_name,
                "username": r.username,
                "is_manual_mode": bool(r.is_manual_mode),
                "total_messages": r.total_messages,
                "last_message_at": _iso(r.last_message_at),
            }
            for r in rows
        ]
    )


@app.route("/api/chats/<telegram_id>", methods=["GET"])
@admin_required
@api_endpoint
def get_chat_history(telegram_id: str):
    """Seluruh riwayat chat satu pengguna, kronologis (lama -> baru)."""
    db = get_db()
    chats = (
        db.query(ChatHistory)
        .options(joinedload(ChatHistory.user))
        .filter(ChatHistory.telegram_id == telegram_id)
        .order_by(ChatHistory.created_at.asc(), ChatHistory.id.asc())
        .all()
    )
    if not chats:
        return err("Tidak ada riwayat chat untuk pengguna tersebut.", 404)
    return ok(
        data={
            "telegram_id": telegram_id,
            "full_name": chats[0].user.full_name if chats[0].user else None,
            "username": chats[0].user.username if chats[0].user else None,
            "is_manual_mode": bool(chats[0].user.is_manual_mode) if chats[0].user else False,
            "messages": [
                {
                    "id": c.id,
                    "model_name": c.model_name,
                    "input": c.input,
                    "output": c.output,
                    "created_at": _iso(c.created_at),
                }
                for c in chats
            ],
        }
    )


@app.route("/api/chats/users/<agent_id>", methods=["GET"])
@admin_required
@api_endpoint
def list_chat_users_by_agent(agent_id: str):
    """Daftar pengguna unik yang pernah chat dengan SATU agent —
    view dua tahap Admin Panel (pilih agent -> pilih kontak)."""
    return ok(data=get_chatted_users(agent_id))


@app.route("/api/chats/<agent_id>/<telegram_id>", methods=["GET"])
@admin_required
@api_endpoint
def get_agent_user_chat(agent_id: str, telegram_id: str):
    """Riwayat chat SATU user dengan SATU agent (kronologis).
    404 bila kombinasi user/agent tidak memiliki riwayat."""
    data = fetch_agent_chat_history(telegram_id, agent_id)
    if data is None:
        return err("Tidak ada riwayat chat untuk kombinasi pengguna & agent tersebut.", 404)
    return ok(data=data)


@app.route("/api/chats/<telegram_id>/toggle-mode", methods=["POST"])
@admin_required
@api_endpoint
def toggle_manual_mode(telegram_id: str):
    """Human Takeover: bolak-balikkan is_manual_mode milik user.
    True = AI dinonaktifkan untuk user tsb, admin membalas manual.
    """
    db = get_db()
    user = db.query(User).filter_by(telegram_id=telegram_id).first()
    if user is None:
        # Pengguna belum tercatat (belum pernah chat): buat barisnya dulu
        user = User(telegram_id=telegram_id)
        db.add(user)
        db.flush()

    user.is_manual_mode = not user.is_manual_mode
    db.commit()
    status_txt = "diaktifkan — AI berhenti membalas" if user.is_manual_mode else "dinonaktifkan — AI kembali menangani"
    return ok(
        data={"telegram_id": telegram_id, "is_manual_mode": user.is_manual_mode},
        message=f"Manual Mode {status_txt}.",
    )


def _send_manual_reply(db, telegram_id: str, agent_id: str, message: str):
    """Kirim balasan manual admin via bot milik agent tertentu, lalu catat
    ke chat_histories (model_name='Human/Admin', input='[Admin Reply]').

    Token diambil dari agent_configs milik agent_id — tiap agent mengirim
    dari identitas botnya sendiri (bukan lagi satu token global). Melempar
    ValueError untuk validasi gagal; mengembalikan respons Flask (ok/err).
    """
    bot_token = get_agent_telegram_token(agent_id)
    if not bot_token:
        raise ValueError(
            f"Token Telegram '{agent_id}' belum diisi di Admin Panel (Agent Config)."
        )

    # 1. Kirim pesan lewat Telegram Bot API
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": telegram_id, "text": message},
            timeout=15,
        )
        result = resp.json()
    except requests.RequestException as e:
        return err(f"Gagal menghubungi Telegram: {e}", 502)
    if not (result or {}).get("ok"):
        desc = (result or {}).get("description", "tidak diketahui")
        return err(f"Telegram menolak pesan: {desc}", 502)

    # 2. Pastikan user tercatat (jaga FK chat_histories.telegram_id)
    if db.query(User).filter_by(telegram_id=telegram_id).first() is None:
        db.add(User(telegram_id=telegram_id))
        db.flush()

    # 3. Simpan riwayat, tercatat atas agent yang balasannya dikirim
    chat = ChatHistory(
        telegram_id=telegram_id,
        agent_id=agent_id,
        model_name="Human/Admin",
        input="[Admin Reply]",
        output=message,
    )
    db.add(chat)
    db.commit()

    return ok(
        data={
            "id": chat.id,
            "telegram_id": telegram_id,
            "agent_id": agent_id,
            "model_name": "Human/Admin",
            "input": "[Admin Reply]",
            "output": message,
            "created_at": _iso(chat.created_at),
        },
        message="Pesan berhasil dikirim ke pengguna.",
    )


@app.route("/api/chats/reply", methods=["POST"])
@admin_required
@api_endpoint
def reply_chat():
    """Balasan manual per-agent — payload WAJIB memuat agent_id.

    Payload: {"telegram_id": "...", "agent_id": "...", "message": "..."}
    Pesan dikirim dari bot milik agent_id (token diambil dari database),
    sehingga balasan CS terkirim dari bot CS, bukan bot penjualan.
    """
    db = get_db()
    body = request.get_json(silent=True) or {}
    telegram_id = (body.get("telegram_id") or "").strip()
    agent_id = (body.get("agent_id") or "").strip()
    message = (body.get("message") or "").strip()

    if not telegram_id or not agent_id:
        raise ValueError("Field 'telegram_id' dan 'agent_id' wajib diisi.")
    if not message:
        raise ValueError("Pesan tidak boleh kosong.")

    return _send_manual_reply(db, telegram_id, agent_id, message)


@app.route("/api/chats/<telegram_id>/send", methods=["POST"])
@admin_required
@api_endpoint
def send_manual_message(telegram_id: str):
    """Endpoint lama (dipakai frontend saat ini): balasan manual lewat bot
    penjualan (NOTIFY_AGENT_ID). Untuk per-agent, pakai POST /api/chats/reply.
    """
    db = get_db()
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    if not message:
        raise ValueError("Pesan tidak boleh kosong.")
    return _send_manual_reply(db, telegram_id, NOTIFY_AGENT_ID, message)


# =====================================================================
# TELEGRAM WEBHOOK (arsitektur webhook terpusat via Flask)
# Telegram mengirim update ke /webhook/<agent_id>. URL publik berasal
# dari tunnel Ngrok — ganti via env PUBLIC_BASE_URL saat URL berubah.
# =====================================================================
PUBLIC_BASE_URL = os.getenv(
    "PUBLIC_BASE_URL",
    "https://quail-squealing-stage.ngrok-free.dev",
).rstrip("/")


# Pesan offline saat agent dimatikan (identik dengan OFFLINE_MESSAGE bot)
WEBHOOK_OFFLINE_MESSAGE = (
    "Mohon maaf, layanan sedang offline saat ini. "
    "Silakan hubungi kami kembali nanti."
)

# Aturan pendamping prompt — port dari bot.py (pulsa) & bot_cs.py (CS)
PULSA_PRODUCT_RULES = """
ATURAN WAJIB TERKAIT PRODUK:
1. Cocokkan pertanyaan pengguna HANYA dengan elemen array pada DAFTAR PRODUK RESMI di atas.
2. JIKA PRODUK TERSEDIA DI ARRAY:
   - Jelaskan nama produk, nominal harga resmi (Rp), sisa stok, dan deskripsinya secara ramah dan ringkas.
   - Jika 'stock' bernilai 0, beritahu bahwa produk tersebut ada di katalog tetapi saat ini STOK SEDANG HABIS.
3. JIKA PRODUK TIDAK TERDAFTAR DI ARRAY:
   - Tegaskan secara sopan bahwa produk/nominal/provider tersebut TIDAK TERSEDIA di toko saat ini.
   - DILARANG mengarang harga atau mengonfirmasi ketersediaan produk di luar array di atas.
4. JIKA PENGGUNA INGIN MEMESAN/MEMBELI:
   - Segera panggil tool `create_order_for_user` dengan mencantumkan nama produk dan jumlah (qty).
   - Setelah invoice terbuat, sampaikan rincian nomor invoice, total bayar, dan instruksi pembayarannya ke pengguna.
5. ATURAN STOK REAL-TIME (SANGAT PENTING):
   - WAJIB ABAIKAN sisa stok yang pernah kamu sebutkan di riwayat chat sebelumnya.
   - HANYA gunakan angka 'stock' yang tertera pada DAFTAR PRODUK RESMI (ARRAY DATA) TERKINI di atas untuk menjawab ketersediaan detik ini juga.
"""

CS_SERVICE_RULES = """
ATURAN WAJIB CUSTOMER SERVICE:
1. Jawab FAQ HANYA berdasarkan INFORMASI TAMBAHAN di atas. DILARANG mengarang harga atau kebijakan.
2. JIKA PENGGUNA MENANYAKAN STATUS PESANAN:
   - Minta nomor invoice bila belum ada (format: INV-XXXXXXXX).
   - Setelah nomor didapat, panggil tool `check_order_status` dengan invoice tersebut.
   - Sampaikan hasil apa adanya (status pesanan & pembayaran) dengan ramah.
3. Jika pembayaran sudah 'paid' tapi pesanan belum 'success', jelaskan bahwa pesanan sedang
   dalam proses verifikasi dan akan segera diproses.
4. Jika keluhan tidak bisa diselesaikan otomatis, beri tahu bahwa admin manusia akan segera
   mengambil alih percakapan untuk membantu.
5. Bot ini TIDAK membuat pesanan baru. Untuk pembelian, arahkan pengguna ke bot penjualan.
"""

_gemini_client = None


def _get_gemini_client():
    """Singleton client Gemini (lazy: SDK baru dimuat saat webhook dipakai)."""
    global _gemini_client
    if _gemini_client is None:
        from google import genai
        _gemini_client = genai.Client(
            api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        )
    return _gemini_client


def _build_webhook_tools(agent_id: str, telegram_id: str) -> list:
    """Tool Gemini per agent — port dari bot.py (pulsa) & bot_cs.py (CS).
    Agent lain (baru) berjalan tanpa tool (Q&A murni)."""
    tools = []
    if agent_id == "pulsa_agent":
        def create_order_for_user(product_name: str, qty: int = 1, tax_rate: float = 0.0):
            """Buat pesanan baru untuk pengguna ini. Panggil dengan nama produk dan jumlah (qty).
            Nomor invoice, total bayar, dan status pembayaran dikembalikan otomatis."""
            return create_new_order(product_name, qty=qty, tax_rate=tax_rate, telegram_id=telegram_id)

        tools.append(create_order_for_user)
    elif agent_id == "cs_agent":
        tools.append(check_order_status)
    return tools


def _build_system_instruction(base_prompt: str, agent_id: str) -> str:
    """Susun system instruction: prompt agent + konteks RAG + aturan per agent."""
    instruction = (
        f"{base_prompt}\n\n"
        f"INFORMASI TAMBAHAN & PEMBAYARAN:\n{get_all_rag_knowledge()}"
    )
    if agent_id == "pulsa_agent":
        instruction += f"\n\nDAFTAR PRODUK RESMI (ARRAY DATA) TERKINI:\n{get_products_json_string()}"
        instruction += PULSA_PRODUCT_RULES
    elif agent_id == "cs_agent":
        instruction += CS_SERVICE_RULES
    return instruction


def _send_telegram_text(bot_token: str, chat_id: str, text: str) -> bool:
    """Kirim pesan teks via Telegram Bot API. Best-effort, tak melempar exception."""
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=15,
        )
        return bool(resp.json().get("ok"))
    except requests.RequestException as e:
        print(f"[WEBHOOK] Gagal mengirim pesan: {e}")
        return False


def _process_agent_message(agent_id: str, user_id: str, user_text: str) -> None:
    """Otak AI webhook — port alur reply() bot.py: susun prompt & riwayat
    dari database, panggil Gemini, simpan riwayat, kirim balasan ke user."""
    from google.genai import types

    cfg = get_agent_config(agent_id)
    base_prompt = cfg.system_prompt if cfg else "Kamu asisten virtual yang ramah dan membantu."
    temperature = cfg.temperature if cfg else 0.3
    model_name = (getattr(cfg, "model_name", None) or "gemini-2.5-flash")

    bot_token = get_agent_telegram_token(agent_id)
    if not bot_token:
        print(f"[WEBHOOK] {agent_id}: token kosong — balasan tidak bisa dikirim.")
        return

    system_instruction = _build_system_instruction(base_prompt, agent_id)
    tools = _build_webhook_tools(agent_id, user_id)

    # Riwayat 10 giliran terakhir sebagai konteks (lama -> baru)
    history_contents = []
    for chat in get_last_10_history(telegram_id=user_id, agent_id=agent_id):
        history_contents.append(types.Content(role="user", parts=[types.Part.from_text(text=chat.input)]))
        history_contents.append(types.Content(role="model", parts=[types.Part.from_text(text=chat.output)]))

    # Trik injeksi stok real-time (port bot.py) — hanya agent penjualan
    if agent_id == "pulsa_agent":
        outgoing_text = (
            f"[SISTEM HIDDEN CONTEXT - STOK TERKINI: {get_products_json_string()}]\n\n"
            f"Pertanyaan Pengguna: {user_text}"
        )
    else:
        outgoing_text = user_text

    try:
        config_kwargs = {
            "system_instruction": system_instruction,
            "temperature": temperature,
        }
        if tools:
            config_kwargs["tools"] = tools
        chat_session = _get_gemini_client().chats.create(
            model=model_name,
            config=types.GenerateContentConfig(**config_kwargs),
            history=history_contents,
        )
        response = chat_session.send_message(outgoing_text)
        bot_reply = response.text if response.text else "Pesanan berhasil dicatat ke sistem."
    except Exception as e:
        print(f"[WEBHOOK] Gagal memproses AI ({agent_id}): {e}")
        bot_reply = f"Maaf, terjadi kendala pada layanan: {e}"

    save_chat_history(
        telegram_id=user_id,
        agent_id=agent_id,
        model_name=model_name,
        user_input=user_text,
        bot_output=bot_reply,
    )
    _send_telegram_text(bot_token, user_id, bot_reply)


@app.route("/webhook/<agent_id>", methods=["POST"])
def telegram_webhook(agent_id: str):
    """Penerima update Telegram + otak AI (port reply() bot.py ke Flask).

    Alur: ekstrak data -> pra-cek (agent aktif? manual mode?) -> proses
    Gemini -> simpan riwayat -> kirim balasan. SELALU balas 200 agar
    Telegram tidak mengulang update yang sama.
    """
    payload = request.get_json(silent=True) or {}
    message = payload.get("message") or payload.get("edited_message") or {}

    user_text = (message.get("text") or "").strip()
    user = message.get("from") or {}
    user_id = str((message.get("chat") or {}).get("id") or user.get("id") or "")
    full_name = " ".join(filter(None, [user.get("first_name"), user.get("last_name")])) or None
    username = user.get("username")

    print(f"[WEBHOOK:{agent_id}] update_id={payload.get('update_id')} "
          f"dari={full_name or '?'} (chat {user_id or '?'}): {user_text or '(tanpa teks)'}")

    # Bukan pesan teks biasa (stiker, callback button, dsb) -> abaikan
    if not user_id or not user_text:
        return jsonify({"status": "ok"}), 200

    # Pra-cek 1: agent dimatikan superadmin -> balas pesan offline, tanpa AI
    if not is_agent_active(agent_id):
        print(f"[WEBHOOK:{agent_id}] agent non-aktif -> pesan offline.")
        token = get_agent_telegram_token(agent_id)
        if token:
            _send_telegram_text(token, user_id, WEBHOOK_OFFLINE_MESSAGE)
        return jsonify({"status": "ok"}), 200

    # Pra-cek 2: Human Takeover -> AI diam total, admin yang membalas manual
    if is_user_in_manual_mode(user_id):
        print(f"[WEBHOOK:{agent_id}] {user_id} dalam manual mode -> AI diabaikan.")
        return jsonify({"status": "ok"}), 200

    # Pastikan user tercatat (jaga FK chat_histories.telegram_id)
    get_or_create_user(telegram_id=user_id, full_name=full_name, username=username)

    # Otak AI: proses, simpan riwayat, kirim balasan (semua di helper)
    _process_agent_message(agent_id, user_id, user_text)

    return jsonify({"status": "ok"}), 200


def register_telegram_webhook(agent_id: str, bot_token: str) -> bool:
    """Daftarkan URL webhook publik ke Telegram untuk bot milik agent.

    Memanggil setWebhook sehingga update pengguna dikirim Flask ke
    /webhook/<agent_id> (bukan di-polling bot.py lagi). Best-effort:
    mengembalikan True/False dan TIDAK melempar exception — kegagalan
    registrasi tidak boleh menggagalkan penyimpanan konfigurasi.
    """
    if not bot_token:
        print(f"[WEBHOOK] {agent_id}: token kosong, registrasi dilewati.")
        return False

    webhook_url = f"{PUBLIC_BASE_URL}/webhook/{agent_id}"
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{bot_token}/setWebhook",
            json={"url": webhook_url},
            timeout=15,
        )
        result = resp.json()
        if result.get("ok"):
            print(f"[WEBHOOK] Berhasil didaftarkan: {agent_id} -> {webhook_url}")
            return True
        print(f"[WEBHOOK] GAGAL mendaftarkan {agent_id}: "
              f"{result.get('description', 'tidak diketahui')}")
        return False
    except requests.RequestException as e:
        print(f"[WEBHOOK] Gagal menghubungi Telegram untuk {agent_id}: {e}")
        return False


# =====================================================================
# ENDPOINT: AGENTS — daftar ringkas & pembuatan agent baru (superadmin)
# Grid kartu di #agent-config memakai GET; form "Tambah Agent" memakai POST.
# =====================================================================
@app.route("/api/agents", methods=["GET"])
@admin_required
@api_endpoint
def list_agents():
    """Daftar semua agent: ID, nama, status aktif (TANPA token/prompt).

    admin_required (bukan superadmin): dipakai juga pemilih agent di
    Riwayat Chat yang bisa diakses role admin. Data yang tampil tidak
    sensitif; detail berisi token tetap eksklusif superadmin via
    GET /api/agent/config."""
    db = get_db()
    agents = db.query(AgentConfig).order_by(AgentConfig.agent_id).all()
    return ok(
        data=[
            {
                "agent_id": a.agent_id,
                "name": a.name,
                "is_active": bool(a.is_active),
                "model_name": a.model_name,
                "updated_at": _iso(a.updated_at),
            }
            for a in agents
        ]
    )


@app.route("/api/agents", methods=["POST"])
@superadmin_required
@api_endpoint
def create_agent():
    """Buat agent brand-new dengan pengaturan AI default.

    Payload: {"agent_id": "...", "name": "...", "telegram_token": "..."}
    Logika insert didelegasikan ke create_new_agent_config (db_service)
    agar dipakai bersama bot & skrip seeding.
    """
    body = request.get_json(silent=True) or {}
    agent_id = (body.get("agent_id") or "").strip()
    name = (body.get("name") or "").strip()
    telegram_token = (body.get("telegram_token") or "").strip() or None

    if not agent_id:
        raise ValueError("Field 'agent_id' wajib diisi.")
    if len(agent_id) > 50:
        raise ValueError("agent_id maksimal 50 karakter.")

    result = create_new_agent_config(agent_id, name, telegram_token)
    if result.get("status") != "success":
        # 'failed' = validasi/duplikat -> 409/400; 'error' = DB -> 500
        if result.get("status") == "error":
            return err(result.get("message", "Gagal membuat agent."), 500)
        return err(result.get("message", "Gagal membuat agent."), 409)

    db = get_db()
    cfg = db.query(AgentConfig).filter_by(agent_id=agent_id).first()

    # Agent baru yang langsung dibawa token: daftarkan webhook-nya juga
    # (best-effort, sama seperti pada PUT /api/agent/config).
    register_telegram_webhook(agent_id, cfg.telegram_token if cfg else None)

    return ok(
        data=serialize_agent_config(cfg),
        message=result.get("message", "Agent baru berhasil dibuat."),
        code=201,
    )


# =====================================================================
# ENDPOINT: AGENT CONFIG (khusus superadmin — nav-nya disembunyikan dari admin)
# =====================================================================
@app.route("/api/agent/config", methods=["GET"])
@superadmin_required
@api_endpoint
def list_agent_configs():
    """Daftar konfigurasi agent (basis: 1 baris; kembalikan list agar aman)."""
    db = get_db()
    configs = db.query(AgentConfig).order_by(AgentConfig.agent_id).all()
    return ok(data=[serialize_agent_config(c) for c in configs])


@app.route("/api/agent/config", methods=["PUT"])
@superadmin_required
@api_endpoint
def update_agent_config():
    """Ubah konfigurasi agent (model_name, system_prompt, temperature, provider).
    Target ditentukan lewat body: `id` atau `agent_id`.
    Bila keduanya kosong dan tabel hanya berisi 1 baris, baris itulah yang diubah.
    """
    db = get_db()
    body = request.get_json(silent=True) or {}

    if body.get("id") is not None:
        cfg = db.get(AgentConfig, int(body["id"]))
    elif body.get("agent_id"):
        cfg = db.query(AgentConfig).filter_by(agent_id=str(body["agent_id"])).first()
    elif db.query(AgentConfig).count() == 1:
        cfg = db.query(AgentConfig).first()  # satu-satunya konfigurasi yang ada
    else:
        raise ValueError("Sertakan 'id' atau 'agent_id' konfigurasi yang akan diubah.")

    if cfg is None:
        return err("Konfigurasi agent tidak ditemukan.", 404)

    body = request.get_json(silent=True) or {}

    provider = (body.get("provider") or cfg.provider).strip()
    if not provider:
        raise ValueError("Provider tidak boleh kosong.")

    model_name = (body.get("model_name") or cfg.model_name).strip()
    # model_name adalah FK ke models_agent.agent_name -> pastikan terdaftar
    if not db.query(ModelAgent).filter_by(agent_name=model_name).first():
        raise ValueError(f"Model '{model_name}' tidak terdaftar di tabel models_agent.")

    try:
        temperature = float(body.get("temperature", cfg.temperature))
    except (TypeError, ValueError):
        raise ValueError("Temperature harus berupa angka.")
    if not 0 <= temperature <= 2:
        raise ValueError("Temperature harus di antara 0 dan 2.")

    # System prompt: hanya divalidasi bila memang dikirim (dukung update
    # parsial, mis. toggle is_active tanpa mengirim ulang seluruh form).
    if "system_prompt" in body:
        system_prompt = (body.get("system_prompt") or "").strip()
        if not system_prompt:
            raise ValueError("System prompt wajib diisi.")
        cfg.system_prompt = system_prompt

    cfg.provider = provider
    cfg.model_name = model_name
    cfg.temperature = temperature

    # Kolom baru (opsional pada payload): hanya diubah bila dikirim eksplisit
    if "name" in body:
        cfg.name = (body.get("name") or "").strip() or None
    if "telegram_token" in body:
        cfg.telegram_token = (body.get("telegram_token") or "").strip() or None
    if "is_active" in body:
        cfg.is_active = bool(body["is_active"])

    db.commit()

    # Auto-registrasi webhook: begitu token tersimpan, URL publik langsung
    # didaftarkan ke Telegram (best-effort — gagal daftar tak menggagalkan
    # penyimpanan konfigurasi di atas).
    register_telegram_webhook(cfg.agent_id, cfg.telegram_token)

    return ok(data=serialize_agent_config(cfg), message="Konfigurasi agent berhasil disimpan.")


@app.route("/api/agent/models", methods=["GET"])
@superadmin_required
@api_endpoint
def list_agent_models():
    """Daftar nama model dari tabel models_agent (untuk dropdown form)."""
    db = get_db()
    models = db.query(ModelAgent).order_by(ModelAgent.agent_name).all()
    return ok(data=[{"id_agent": m.id_agent, "agent_name": m.agent_name} for m in models])


# =====================================================================
# ENDPOINT: KNOWLEDGE BASE (RAG) — upload PDF -> chunk -> embedding
# Pipeline: baca file ke memori (io.BytesIO) -> catat Document ->
# ekstrak teks (PyPDF2) -> potong jadi chunk (overlap utk konteks) ->
# embedding Gemini -> simpan chunk + vektor ke rag_documents.
# Superadmin-only: mengubah "otak" bot.
# Catatan: PDF diproses SEPENUHNYA in-memory (tanpa file fisik) agar
# aman utk container ephemeral (Docker/Render/Railway).
# =====================================================================
def _chunk_text(text: str, size: int = 1000, overlap: int = 100) -> list:
    """Potong teks jadi chunk ~`size` karakter dengan tumpang-tindih
    `overlap` karakter agar konteks antar-paragraf tidak terputus."""
    text = " ".join(text.split())  # rapikan whitespace hasil ekstraksi PDF
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = end - overlap
    return [c for c in chunks if c]


@app.route("/api/knowledge-base/upload", methods=["POST"])
@superadmin_required
@api_endpoint
def upload_knowledge_base():
    """Terima PDF, proses seluruh pipeline RAG, dan simpan hasilnya.

    Atomik: Document & chunk di-commit SEKALIGUS di akhir — bila ekstraksi
    atau embedding gagal, seluruh perubahan DB di-rollback.
    PDF dibaca langsung ke memori (io.BytesIO): tidak ada file yang
    ditulis ke disk, jadi tidak ada file fisik yang perlu dibersihkan.
    """
    db = get_db()
    file = request.files.get("file")

    # 1. Validasi berkas
    if file is None or not file.filename:
        raise ValueError("File PDF wajib diunggah (field 'file').")
    original_name = file.filename
    if not original_name.lower().endswith(".pdf"):
        raise ValueError("Hanya file PDF yang didukung.")

    # 2. Baca seluruh stream ke memori (pengganti file.save ke disk)
    raw_bytes = file.read()
    pdf_stream = io.BytesIO(raw_bytes)

    # 3. Catat metadata dokumen (flush -> id tersedia utk FK, commit menyusul).
    #    file_path hanya penanda — tidak ada lagi penyimpanan fisik.
    document = Document(
        file_name=original_name,
        size=len(raw_bytes),
        file_path="in-memory",
    )
    db.add(document)
    db.flush()
    document_id = document.id

    try:
        # 4. Ekstrak teks dari seluruh halaman PDF (langsung dari memori)
        reader = PyPDF2.PdfReader(pdf_stream)
        raw_text = "\n".join((page.extract_text() or "") for page in reader.pages)
        if not raw_text.strip():
            raise ValueError(
                "PDF tidak berisi teks yang bisa diekstrak (kemungkinan hasil scan/gambar)."
            )

        # 5. Chunking (±1000 karakter, overlap 100)
        chunks = _chunk_text(raw_text, size=1000, overlap=100)

        # 6. Embedding Gemini — batch: satu panggilan untuk semua chunk.
        # Model: gemini-embedding-001 (text-embedding-004 sudah tak tersedia
        # utk API key ini); output dibuat 768-dim agar cocok Vector(768).
        from google.genai import types
        result = _get_gemini_client().models.embed_content(
            model="gemini-embedding-001",
            contents=chunks,
            config=types.EmbedContentConfig(output_dimensionality=768),
        )
        vectors = [item.values for item in result.embeddings]

        # 7. Simpan chunk + vektor embedding
        for chunk_text, vector in zip(chunks, vectors):
            db.add(RagDocument(
                document_id=document_id,
                chunk_text=chunk_text,
                embedding=vector,
            ))

        db.commit()
    except ValueError:
        # Kesalahan validasi (PDF tanpa teks) -> rapikan lalu 400
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        return err(f"Gagal memproses dokumen: {e}", 500)

    return ok(
        data={
            "document_id": document_id,
            "file_name": document.file_name,
            "size_bytes": document.size,
            "file_path": document.file_path,
            "total_chunks": len(chunks),
        },
        message=f"Dokumen '{document.file_name}' berhasil diproses ({len(chunks)} chunk).",
        code=200,
    )


# =====================================================================
# ENDPOINT: KNOWLEDGE BASE (list & delete dokumen)
# =====================================================================
def _fmt_readable(dt):
    """Ubah datetime jadi string yang mudah dibaca, cth: '13 Sep 2026 14:30'."""
    return dt.strftime("%d %b %Y %H:%M") if dt else None


@app.route("/api/knowledge-base", methods=["GET"])
@admin_required  # read-only: aman untuk semua role admin
@api_endpoint
def list_knowledge_base():
    """Daftar semua dokumen yang pernah diunggah, terbaru dulu."""
    db = get_db()
    documents = db.query(Document).order_by(Document.upload_at.desc()).all()
    return ok(data=[
        {
            "id": d.id,
            "file_name": d.file_name,
            "size": d.size,
            "upload_at": _fmt_readable(d.upload_at),
        }
        for d in documents
    ])


@app.route("/api/knowledge-base/<int:doc_id>", methods=["DELETE"])
@superadmin_required  # konsisten dgn upload: mengubah "otak" bot
@api_endpoint
def delete_knowledge_base(doc_id: int):
    """Hapus dokumen dari database (chunk ikut terhapus via cascade).

    Tidak ada file fisik yang perlu dibersihkan — PDF diproses in-memory.
    """
    db = get_db()
    document = db.get(Document, doc_id)
    if document is None:
        return err("Dokumen tidak ditemukan.", 404)

    # Snapshot data dulu: setelah delete+commit objek expired & tak bisa diakses
    file_name = document.file_name
    total_chunks = len(document.chunks)

    db.delete(document)  # cascade "all, delete-orphan" otomatis menghapus chunk
    db.commit()

    return ok(message=f"Dokumen '{file_name}' beserta {total_chunks} chunk berhasil dihapus.")


# =====================================================================
# ENDPOINT: ADMIN MANAGEMENT (khusus superadmin)
# =====================================================================
def _is_last_superadmin(db, admin_id: int) -> bool:
    """True bila admin tsb adalah SATU-SATUNYA superadmin aktif."""
    others = (
        db.query(Admin)
        .filter(Admin.role == AdminRole.SUPERADMIN, Admin.is_active.is_(True), Admin.id != admin_id)
        .count()
    )
    return others == 0


@app.route("/api/admins", methods=["GET"])
@superadmin_required
@api_endpoint
def list_admins():
    db = get_db()
    admins = db.query(Admin).order_by(Admin.created_at).all()
    return ok(data=[serialize_admin(a) for a in admins])


@app.route("/api/admins", methods=["POST"])
@superadmin_required
@api_endpoint
def create_admin():
    db = get_db()
    body = request.get_json(silent=True) or {}

    username = (body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    full_name = (body.get("full_name") or "").strip()
    role = (body.get("role") or "admin").strip().lower()

    if not username or not full_name:
        raise ValueError("Username dan nama lengkap wajib diisi.")
    if len(password) < 6:
        raise ValueError("Password minimal 6 karakter.")
    if role not in (AdminRole.ADMIN.value, AdminRole.SUPERADMIN.value):
        raise ValueError("Role harus 'admin' atau 'superadmin'.")
    if db.query(Admin).filter_by(username=username).first():
        raise ValueError(f"Username '{username}' sudah digunakan.")

    admin = Admin(
        username=username,
        password_hash=generate_password_hash(password),
        full_name=full_name,
        role=AdminRole(role),
        is_active=bool(body.get("is_active", True)),
    )
    db.add(admin)
    db.commit()
    return ok(data=serialize_admin(admin), message="Admin baru berhasil dibuat.", code=201)


@app.route("/api/admins/<int:admin_id>", methods=["PUT"])
@superadmin_required
@api_endpoint
def update_admin(admin_id: int):
    db = get_db()
    admin = db.get(Admin, admin_id)
    if admin is None:
        return err("Admin tidak ditemukan.", 404)

    body = request.get_json(silent=True) or {}

    if "full_name" in body:
        full_name = (body.get("full_name") or "").strip()
        if not full_name:
            raise ValueError("Nama lengkap tidak boleh kosong.")
        admin.full_name = full_name

    if "role" in body:
        role = (body.get("role") or "").strip().lower()
        if role not in (AdminRole.ADMIN.value, AdminRole.SUPERADMIN.value):
            raise ValueError("Role harus 'admin' atau 'superadmin'.")
        # Cegah menurunkan superadmin terakhir menjadi admin biasa
        if admin.role == AdminRole.SUPERADMIN and role != AdminRole.SUPERADMIN.value:
            if _is_last_superadmin(db, admin.id):
                raise ValueError("Tidak bisa menurunkan role: ini satu-satunya superadmin aktif.")
        admin.role = AdminRole(role)

    if "is_active" in body:
        admin.is_active = bool(body["is_active"])
        # Cegah menonaktifkan diri sendiri / superadmin terakhir
        if not admin.is_active:
            if g.current_admin.id == admin.id:
                raise ValueError("Anda tidak dapat menonaktifkan akun sendiri.")
            if admin.role == AdminRole.SUPERADMIN and _is_last_superadmin(db, admin.id):
                raise ValueError("Tidak bisa menonaktifkan: ini satu-satunya superadmin aktif.")

    password = body.get("password") or ""
    if password:
        if len(password) < 6:
            raise ValueError("Password minimal 6 karakter.")
        admin.password_hash = generate_password_hash(password)

    db.commit()
    return ok(data=serialize_admin(admin), message="Data admin berhasil diperbarui.")


@app.route("/api/admins/<int:admin_id>", methods=["DELETE"])
@superadmin_required
@api_endpoint
def delete_admin(admin_id: int):
    db = get_db()
    admin = db.get(Admin, admin_id)
    if admin is None:
        return err("Admin tidak ditemukan.", 404)
    if g.current_admin.id == admin_id:
        return err("Anda tidak dapat menghapus akun sendiri.", 400)
    if admin.role == AdminRole.SUPERADMIN and _is_last_superadmin(db, admin.id):
        return err("Tidak dapat menghapus: ini satu-satunya superadmin aktif.", 400)

    db.delete(admin)
    db.commit()
    return ok(message="Admin berhasil dihapus.")


# =====================================================================
# SEED SUPERADMIN PERTAMA & ENTRYPOINT
# =====================================================================
def seed_superadmin():
    """Buat superadmin pertama bila tabel admins masih kosong.
    Jalankan:  python app.py --seed
    Kredensial bisa diatur via env SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD.
    """
    db = SessionLocal()
    try:
        if db.query(Admin).count() > 0:
            print("[OK] Tabel admins sudah berisi data, seed dilewati.")
            return
        username = os.getenv("SEED_ADMIN_USERNAME", "superadmin")
        password = os.getenv("SEED_ADMIN_PASSWORD", "superadmin123")
        admin = Admin(
            username=username,
            password_hash=generate_password_hash(password),
            full_name="Super Admin",
            role=AdminRole.SUPERADMIN,
            is_active=True,
        )
        db.add(admin)
        db.commit()
        print(f"[OK] Superadmin dibuat -> username: {username} | password: {password}")
        print("     ! Segera ganti password ini setelah login pertama.")
    finally:
        db.close()


def reset_admin_password(username: str, new_password: str):
    """Reset password admin dengan hash werkzeug yang valid.
    Jalankan:  python app.py --reset-password <username> <password_baru>

    Berguna bila baris admin lama masih berisi placeholder (bukan hash
    werkzeug) sehingga tidak bisa dipakai login.
    """
    if len(new_password) < 6:
        print("[GAGAL] Password minimal 6 karakter.")
        return
    db = SessionLocal()
    try:
        admin = db.query(Admin).filter_by(username=username).first()
        if admin is None:
            print(f"[GAGAL] Admin '{username}' tidak ditemukan.")
            return
        admin.password_hash = generate_password_hash(new_password)
        db.commit()
        print(f"[OK] Password admin '{username}' berhasil direset.")
    finally:
        db.close()


if __name__ == "__main__":
    if "--seed" in sys.argv:
        seed_superadmin()
    elif "--reset-password" in sys.argv:
        idx = sys.argv.index("--reset-password")
        if len(sys.argv) < idx + 3:
            print("Pemakaian: python app.py --reset-password <username> <password_baru>")
        else:
            reset_admin_password(sys.argv[idx + 1], sys.argv[idx + 2])
    else:
        app.run(
            host="127.0.0.1",
            port=int(os.getenv("PORT", "5000")),
            debug=os.getenv("FLASK_DEBUG", "1") == "1",
        )
