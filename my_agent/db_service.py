import json
import uuid
from sqlalchemy import func
from models import (
    SessionLocal,
    AgentConfig,
    ChatHistory,
    Document,
    RagDocument,
    User,
    ModelAgent,
    Product,
    Order,
    OrderItem,
    OrderPayment,
)


def get_or_create_user(telegram_id: str, full_name: str, username: str = None):
    """Mencatat user baru ke tabel users atau mengembalikan data jika sudah ada."""
    session = SessionLocal()
    try:
        user = (
            session.query(User).filter_by(telegram_id=str(telegram_id)).first()
        )
        if not user:
            user = User(
                telegram_id=str(telegram_id),
                full_name=full_name,
                username=username,
            )
            session.add(user)
            session.commit()
            print(f"✓ User baru disimpan: {full_name} ({telegram_id})")
        return user
    except Exception as e:
        session.rollback()
        print(f"✗ Gagal menyimpan user: {e}")
    finally:
        session.close()


def add_agent_model(agent_name: str):
    """Menambahkan model baru ke tabel models_agent."""
    session = SessionLocal()
    try:
        exists = (
            session.query(ModelAgent).filter_by(agent_name=agent_name).first()
        )
        if not exists:
            new_model = ModelAgent(agent_name=agent_name)
            session.add(new_model)
            session.commit()
            return new_model
        return exists
    except Exception as e:
        session.rollback()
        print(f"✗ Gagal menambahkan model: {e}")
    finally:
        session.close()


def get_available_agent_models():
    """Mengambil daftar semua nama model dari tabel models_agent."""
    session = SessionLocal()
    try:
        models = session.query(ModelAgent).all()
        return [m.agent_name for m in models]
    finally:
        session.close()


def seed_pulsa_agent():
    """Mengisi konfigurasi agent pulsa dan knowledge base awal."""
    session = SessionLocal()
    try:
        agent = (
            session.query(AgentConfig).filter_by(agent_id="pulsa_agent").first()
        )
        prompt_pulsa = (
            "Kamu adalah asisten virtual penjual pulsa otomatis yang ramah, cepat, dan akurat. "
            "Tugasmu: memberikan daftar harga pulsa, memvalidasi nomor HP pelanggan (minimal 10-13 digit), "
            "dan memberikan instruksi pembayaran via QRIS/Transfer Bank. "
            "Jawab secara ringkas, jelas, dan gunakan format bullet points jika menampilkan harga."
        )
        if not agent:
            default_agent = AgentConfig(
                agent_id="pulsa_agent",
                name="Bot Pulsa",
                telegram_token=None,  # token diisi superadmin via Admin Panel
                is_active=True,
                provider="google",
                model_name="gemini-2.5-flash",
                system_prompt=prompt_pulsa,
                temperature=0.3,
            )
            session.add(default_agent)
            session.commit()
            print("✓ Agent 'pulsa_agent' berhasil dibuat.")
        else:
            agent.system_prompt = prompt_pulsa
            agent.temperature = 0.3
            # Backfill kolom baru tanpa menimpa pengaturan admin:
            # is_active jangan di-reset True bila superadmin sengaja mematikan.
            if agent.name is None:
                agent.name = "Bot Pulsa"
            if agent.is_active is None:
                agent.is_active = True
            session.commit()

        if session.query(Document).count() == 0:
            doc = Document(
                file_name="daftar_harga_pulsa.txt",
                size=0,
                file_path="uploads/knowledge_base/daftar_harga_pulsa.txt",
            )
            session.add(doc)
            session.flush()

            faq_chunks = [
                "Daftar Harga Telkomsel: 5.000 (Rp6.500), 10.000 (Rp11.500), 20.000 (Rp21.500), 50.000 (Rp51.000), 100.000 (Rp99.500).",
                "Daftar Harga Indosat/XL: 5.000 (Rp6.000), 10.000 (Rp11.000), 25.000 (Rp26.000), 50.000 (Rp50.500), 100.000 (Rp99.000).",
                "Metode Pembayaran: otomatis diterima melalui QRIS (ShopeePay, GoPay, OVO, Dana) dan Virtual Account BCA/BRI/Mandiri.",
            ]
            session.add_all([
                RagDocument(document_id=doc.id, chunk_text=chunk)  # embedding diisi tahap upload/vektorisasi
                for chunk in faq_chunks
            ])
            session.commit()
            print("✓ Knowledge base pulsa (documents + rag_documents) berhasil ditambahkan.")
    finally:
        session.close()


def get_agent_config(agent_id: str):
    session = SessionLocal()
    try:
        return session.query(AgentConfig).filter_by(agent_id=agent_id).first()
    finally:
        session.close()


def save_chat_history(
    telegram_id: str,
    agent_id: str,
    user_input: str,
    bot_output: str,
    model_name: str = None,
):
    session = SessionLocal()
    try:
        history = ChatHistory(
            telegram_id=str(telegram_id),
            agent_id=agent_id,
            model_name=model_name,
            input=user_input,
            output=bot_output,
        )
        session.add(history)
        session.commit()
    except Exception as e:
        session.rollback()
        print(f"✗ Gagal simpan riwayat chat: {e}")
    finally:
        session.close()


def get_last_10_history(telegram_id: str, agent_id: str):
    session = SessionLocal()
    try:
        records = (
            session.query(ChatHistory)
            .filter_by(telegram_id=str(telegram_id), agent_id=agent_id)
            .order_by(ChatHistory.created_at.desc())
            .limit(10)
            .all()
        )
        return records[::-1]
    finally:
        session.close()


def get_chatted_users(agent_id: str):
    """Daftar pengguna unik yang pernah chat dengan SATU agent tertentu.

    Dipakai Admin Panel (view dua tahap: pilih agent -> pilih user).
    Diurutkan dari pesan terakhir (terbaru di atas). Mengembalikan list
    of dict agar aman dibaca setelah session ditutup.
    """
    session = SessionLocal()
    try:
        rows = (
            session.query(
                ChatHistory.telegram_id,
                User.full_name,
                User.username,
                User.is_manual_mode,
                func.max(ChatHistory.created_at).label("last_message_at"),
                func.count(ChatHistory.id).label("total_messages"),
            )
            .outerjoin(User, User.telegram_id == ChatHistory.telegram_id)
            .filter(ChatHistory.agent_id == agent_id)
            .group_by(
                ChatHistory.telegram_id,
                User.full_name,
                User.username,
                User.is_manual_mode,
            )
            .order_by(func.max(ChatHistory.created_at).desc())
            .all()
        )
        return [
            {
                "telegram_id": r.telegram_id,
                "full_name": r.full_name,
                "username": r.username,
                "is_manual_mode": bool(r.is_manual_mode),
                "total_messages": r.total_messages,
                "last_message_at": r.last_message_at.isoformat() if r.last_message_at else None,
            }
            for r in rows
        ]
    finally:
        session.close()


def get_chat_history(telegram_id: str, agent_id: str):
    """Seluruh riwayat chat SATU user dengan SATU agent, kronologis.

    Mengembalikan dict (profil user + daftar pesan) atau None bila
    kombinasi user/agent tidak memiliki riwayat.
    """
    session = SessionLocal()
    try:
        user = session.query(User).filter_by(telegram_id=str(telegram_id)).first()
        chats = (
            session.query(ChatHistory)
            .filter(
                ChatHistory.telegram_id == str(telegram_id),
                ChatHistory.agent_id == agent_id,
            )
            .order_by(ChatHistory.created_at.asc(), ChatHistory.id.asc())
            .all()
        )
        if not chats:
            return None
        return {
            "telegram_id": str(telegram_id),
            "agent_id": agent_id,
            "full_name": user.full_name if user else None,
            "username": user.username if user else None,
            "is_manual_mode": bool(user.is_manual_mode) if user else False,
            "messages": [
                {
                    "id": c.id,
                    "model_name": c.model_name,
                    "input": c.input,
                    "output": c.output,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                }
                for c in chats
            ],
        }
    finally:
        session.close()


def get_all_rag_knowledge():
    """Mengambil seluruh materi knowledge base dari chunks semua dokumen.

    Format per baris: "- [nama_file] teks_chunk" — nama file asal disertakan
    agar AI tahu sumber informasinya.
    """
    session = SessionLocal()
    try:
        rows = (
            session.query(Document.file_name, RagDocument.chunk_text)
            .join(RagDocument, RagDocument.document_id == Document.id)
            .order_by(Document.id.asc(), RagDocument.id.asc())
            .all()
        )
        return "\n".join(f"- [{name}] {chunk}" for name, chunk in rows)
    finally:
        session.close()


def get_products_as_array():
    """Mengambil semua baris dari tabel products secara urut (id ASC)."""
    session = SessionLocal()
    try:
        products = session.query(Product).order_by(Product.id.asc()).all()
        products_array = []
        for p in products:
            products_array.append({
                "id": p.id,
                "name": p.name,
                "price": int(p.price),
                "stock": p.qty,
                "description": p.description or "",
            })
        return products_array
    finally:
        session.close()


def get_products_json_string():
    """Mengubah array produk menjadi format JSON string rapi untuk dimasukkan ke prompt bot."""
    products_list = get_products_as_array()
    return json.dumps(products_list, indent=2, ensure_ascii=False)


def create_new_order(
    product_name: str, qty: int = 1, tax_rate: float = 0.0, telegram_id: str = None
):
    """Membuat pesanan baru dengan mencatat total_items ke orders dan orders_items.

    telegram_id bersifat opsional: diisi otomatis oleh bot (lewat wrapper
    create_order_for_user) agar pesanan terikat ke user pemiliknya —
    dipakai webhook pembayaran untuk mengirim notifikasi Telegram.
    """
    session = SessionLocal()
    try:
        # 1. Cari produk berdasarkan nama
        product = (
            session.query(Product)
            .filter(Product.name.ilike(f"%{product_name}%"))
            .first()
        )
        if not product:
            return {
                "status": "failed",
                "message": f"Produk '{product_name}' tidak ditemukan di katalog.",
            }

        if product.qty < qty:
            return {
                "status": "failed",
                "message": f"Stok untuk '{product.name}' tidak mencukupi (sisa: {product.qty}).",
            }

        # 2. Hitung nominal
        sub_amount = float(product.price) * qty
        tax = sub_amount * tax_rate
        total_amount = sub_amount + tax
        invoice_no = f"INV-{uuid.uuid4().hex[:8].upper()}"

        # 3. Simpan ke tabel orders (sertakan total_items)
        new_order = Order(
            invoice_number=invoice_no,
            status="pending",
            sub_amount=sub_amount,
            tax=tax,
            total_amount=total_amount,
            total_items=qty,
            telegram_id=telegram_id,
        )
        session.add(new_order)
        session.flush()

        # 4. Simpan ke tabel orders_items (sertakan total_items)
        order_item = OrderItem(
            order_id=new_order.id,
            product_id=product.id,
            qty=qty,
            total_items=qty,
        )
        session.add(order_item)

        # 5. Kurangi stok produk
        # product.qty -= qty

        # 6. Simpan ke tabel order_payment (default: unpaid)
        payment = OrderPayment(order_id=new_order.id, status="unpaid")
        session.add(payment)

        session.commit()
        return {
            "status": "success",
            "invoice_number": invoice_no,
            "product_name": product.name,
            "qty": qty,
            "total_amount": total_amount,
            "payment_status": "unpaid",
        }
    except Exception as e:
        session.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        session.close()


def mark_order_as_paid(invoice_number: str):
    """Mengubah status order menjadi success, order_payment menjadi paid, dan mengurangi stok."""
    session = SessionLocal()
    try:
        order = (
            session.query(Order)
            .filter_by(invoice_number=invoice_number.strip())
            .first()
        )
        if not order:
            return {
                "status": "failed",
                "message": f"Nomor invoice '{invoice_number}' tidak ditemukan.",
            }

        # PENGAMAN: Mencegah pengurangan ganda jika sudah pernah diverifikasi
        if order.status == "success":
            return {
                "status": "info",
                "message": f"Invoice {invoice_number} sudah diverifikasi sebelumnya.",
            }

        order.status = "success"

        if order.payment:
            order.payment.status = "paid"
        else:
            payment = OrderPayment(order_id=order.id, status="paid")
            session.add(payment)

        # LOGIKA BARU: Kurangi stok produk HANYA saat diverifikasi
        for item in order.items:
            product = session.query(Product).filter_by(id=item.product_id).first()
            if product:
                product.qty -= item.qty

        session.commit()
        return {
            "status": "success",
            "invoice_number": order.invoice_number,
            "order_status": "success",
            "payment_status": "paid",
            "message": f"Pembayaran invoice {order.invoice_number} berhasil diverifikasi dan stok telah dikurangi.",
        }
    except Exception as e:
        session.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        session.close()

def seed_cs_agent():
    """Pastikan konfigurasi agent Customer Service (cs_agent) tersedia.
    Wajib ada sebelum bot_cs menyimpan riwayat: chat_histories.agent_id
    adalah FK ke agent_configs.agent_id.
    """
    session = SessionLocal()
    try:
        agent = session.query(AgentConfig).filter_by(agent_id="cs_agent").first()
        if agent:
            # Data lama: backfill kolom baru tanpa menimpa pengaturan admin
            # (jangan reset is_active True bila superadmin sengaja mematikan)
            if agent.name is None:
                agent.name = "Bot Customer Service"
            if agent.is_active is None:
                agent.is_active = True
            session.commit()
            print("[OK] Agent 'cs_agent' sudah terdaftar, seed dilewati.")
            return
        prompt_cs = (
            "Kamu adalah agen Customer Service (CS) toko pulsa otomatis yang ramah, sabar, dan empatik. "
            "Tugasmu: menjawab FAQ (harga, cara pembelian, metode pembayaran), membantu pengecekan status "
            "pesanan berdasarkan nomor invoice, dan menangani keluhan pelanggan dengan tenang. "
            "Jika keluhan tidak bisa diselesaikan otomatis, beri tahu pelanggan bahwa admin manusia akan "
            "segera mengambil alih percakapan. Jawab ringkas, sopan, dan gunakan Bahasa Indonesia."
        )
        session.add(AgentConfig(
            agent_id="cs_agent",
            name="Bot Customer Service",
            telegram_token=None,  # token diisi superadmin via Admin Panel
            is_active=True,
            provider="google",
            model_name="gemini-2.5-flash",
            system_prompt=prompt_cs,
            temperature=0.3,
        ))
        session.commit()
        print("[OK] Agent 'cs_agent' berhasil dibuat.")
    finally:
        session.close()


def create_new_agent_config(agent_id: str, name: str, telegram_token: str = None):
    """Sisipkan agent brand-new dengan pengaturan AI default.

    Dipakai endpoint POST /api/agents (Admin Panel) untuk menambah agent
    tanpa menyentuh kode. agent_id harus unik; model default otomatis
    didaftarkan ke models_agent agar FK model_name valid.
    """
    session = SessionLocal()
    try:
        agent_id = (agent_id or "").strip()
        if not agent_id:
            return {"status": "failed", "message": "agent_id wajib diisi."}
        if session.query(AgentConfig).filter_by(agent_id=agent_id).first():
            return {
                "status": "failed",
                "message": f"Agent '{agent_id}' sudah terdaftar di database.",
            }

        # Pastikan model default terdaftar (FK models_agent.agent_name)
        default_model = "gemini-2.5-flash"
        if not (
            session.query(ModelAgent)
            .filter_by(agent_name=default_model)
            .first()
        ):
            session.add(ModelAgent(agent_name=default_model))
            session.flush()

        session.add(AgentConfig(
            agent_id=agent_id,
            name=(name or agent_id).strip(),
            telegram_token=(telegram_token or "").strip() or None,
            is_active=True,
            provider="google",
            model_name=default_model,
            system_prompt=(
                "Kamu adalah asisten virtual yang ramah dan membantu. "
                "Jawab pertanyaan pengguna secara ringkas dan jelas "
                "menggunakan Bahasa Indonesia."
            ),
            temperature=0.3,
        ))
        session.commit()
        print(f"✓ Agent '{agent_id}' berhasil dibuat.")
        return {
            "status": "success",
            "agent_id": agent_id,
            "message": f"Agent '{agent_id}' berhasil dibuat dengan pengaturan default.",
        }
    except Exception as e:
        session.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        session.close()


def check_order_status(invoice_number: str):
    """Tool bot CS: cek status pesanan + pembayaran berdasarkan nomor invoice.
    Dipakai untuk menangani pertanyaan 'pesanan saya bagaimana?' / keluhan."""
    session = SessionLocal()
    try:
        order = (
            session.query(Order)
            .filter_by(invoice_number=invoice_number.strip())
            .first()
        )
        if not order:
            return {
                "status": "failed",
                "message": f"Nomor invoice '{invoice_number}' tidak ditemukan.",
            }

        payment_status = order.payment.status if order.payment else "unpaid"
        items = [
            f"{i.qty}x {i.product.name}" if i.product else f"{i.qty}x produk #{i.product_id}"
            for i in order.items
        ]
        return {
            "status": "success",
            "invoice_number": order.invoice_number,
            "order_status": order.status,
            "payment_status": payment_status,
            "total_amount": float(order.total_amount),
            "items": items,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "message": (
                f"Order {order.invoice_number}: status pesanan '{order.status}', "
                f"status pembayaran '{payment_status}'."
            ),
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        session.close()


def is_user_in_manual_mode(telegram_id: str) -> bool:
    """True bila user sedang dalam mode manual (Human Takeover).
    Dipakai bot untuk memutuskan apakah pesan perlu dijawab AI atau diabaikan.
    """
    session = SessionLocal()
    try:
        user = session.query(User).filter_by(telegram_id=str(telegram_id)).first()
        return bool(user and user.is_manual_mode)
    except Exception as e:
        print(f"✗ Gagal cek mode manual: {e}")
        return False
    finally:
        session.close()


def get_agent_telegram_token(agent_id: str):
    """Ambil token Telegram milik agent langsung dari database.

    Menggantikan sumber token dari file .env: superadmin mengisi token
    lewat Admin Panel (agent_configs.telegram_token). Mengembalikan None
    bila agent tidak ada atau token belum diisi/kosong.
    """
    session = SessionLocal()
    try:
        agent = session.query(AgentConfig).filter_by(agent_id=agent_id).first()
        if agent is None or not agent.telegram_token:
            return None
        return agent.telegram_token.strip() or None
    finally:
        session.close()


def is_agent_active(agent_id: str) -> bool:
    """True bila agent terdaftar dan berstatus aktif (agent_configs.is_active).

    Dipakai bot pada SETIAP pesan: bila False, bot membalas pesan sopan
    'layanan offline' tanpa memanggil AI. Baris agent yang hilang dianggap
    non-aktif; error database sengaja fail-open (return True) mengikuti
    pola is_user_in_manual_mode — bila DB memang bermasalah, panggilan AI
    berikutnya akan gagal dengan pesan kendala standar.
    """
    session = SessionLocal()
    try:
        agent = session.query(AgentConfig).filter_by(agent_id=agent_id).first()
        return bool(agent and agent.is_active)
    except Exception as e:
        print(f"✗ Gagal cek status aktif agent: {e}")
        return True
    finally:
        session.close()


if __name__ == "__main__":
    seed_pulsa_agent()


