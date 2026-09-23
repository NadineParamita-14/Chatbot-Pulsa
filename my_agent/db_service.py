import json
import uuid
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
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
    CHANNEL_TELEGRAM,
    CHANNEL_WHATSAPP,
)


# =====================================================================
# IDENTITAS MULTI-CHANNEL (Telegram + WhatsApp via WAHA)
# Satu user = satu baris di tabel users, diidentifikasi lewat kombinasi
# (channel, platform_id). platform_id adalah ID routing utama pengirim:
#   - telegram : chat ID Telegram (telegram_id ikut terisi nilainya)
#   - whatsapp : nomor WA tanpa '@c.us' (atau LID tanpa '@lid')
# =====================================================================
def parse_waha_sender(raw: str) -> dict:
    """Pecah sender ID WhatsApp dari payload WAHA menjadi kolom identitas.

    Contoh:
      '6281234567890@c.us'   -> {'channel': 'whatsapp',
                                 'platform_id': '6281234567890',
                                 'whatsapp_lid': None}
      '998345678901234@lid'  -> {'channel': 'whatsapp',
                                 'platform_id': '998345678901234',
                                 'whatsapp_lid': '998345678901234'}

    Akhiran '@c.us' (nomor telepon) dan '@lid' (LID internal WA) dibuang;
    string tanpa akhiran dianggap nomor telepon polos.
    """
    raw = (raw or "").strip()
    if raw.lower().endswith("@lid"):
        lid = raw[:-len("@lid")]
        return {
            "channel": CHANNEL_WHATSAPP,
            "platform_id": lid,
            "whatsapp_lid": lid or None,
        }
    if raw.lower().endswith("@c.us"):
        raw = raw[: -len("@c.us")]
    return {
        "channel": CHANNEL_WHATSAPP,
        "platform_id": raw,
        "whatsapp_lid": None,
    }


def get_user_by_route(channel: str, platform_id: str):
    """Cari user berdasar kombinasi channel + platform_id (routing utama)."""
    session = SessionLocal()
    try:
        return (
            session.query(User)
            .filter_by(channel=channel, platform_id=str(platform_id))
            .first()
        )
    finally:
        session.close()


def get_or_create_user(
    telegram_id: str = None,
    full_name: str = None,
    username: str = None,
    channel: str = CHANNEL_TELEGRAM,
    platform_id: str = None,
    whatsapp_lid: str = None,
):
    """Catat user baru atau ambil yang sudah ada berdasar channel + platform_id.

    Kompatibel dengan pemanggil lama: get_or_create_user(telegram_id=..., ...)
    otomatis dipetakan ke channel 'telegram' dengan platform_id = telegram_id.
    Untuk WhatsApp, panggil dengan channel='whatsapp', platform_id=nomor WA,
    dan whatsapp_lid bila tersedia (lihat parse_waha_sender).
    """
    if platform_id is None:
        platform_id = telegram_id  # jalur pemanggil lama (Telegram)
    platform_id = str(platform_id).strip() if platform_id is not None else None
    if not platform_id:
        print("✗ Gagal menyimpan user: platform_id kosong")
        return None
    channel = (channel or CHANNEL_TELEGRAM).strip().lower()

    # Telegram: chat ID sekaligus menjadi telegram_id-nya
    if channel == CHANNEL_TELEGRAM and telegram_id is None:
        telegram_id = platform_id
    if telegram_id is not None:
        telegram_id = str(telegram_id)
    if whatsapp_lid is not None:
        whatsapp_lid = str(whatsapp_lid)

    session = SessionLocal()
    try:
        user = (
            session.query(User)
            .filter_by(channel=channel, platform_id=platform_id)
            .first()
        )
        if user is None and channel == CHANNEL_WHATSAPP and whatsapp_lid:
            # Identitas ganda WhatsApp: pesan dari kontak yang sama bisa datang
            # sebagai '@c.us' (nomor telepon) atau '@lid'. Cari juga lewat lid
            # agar tetap satu baris user; platform_id lama dipertahankan.
            user = (
                session.query(User)
                .filter_by(whatsapp_lid=whatsapp_lid)
                .first()
            )
        if user is None:
            user = User(
                channel=channel,
                platform_id=platform_id,
                telegram_id=telegram_id,
                whatsapp_lid=whatsapp_lid,
                full_name=full_name,
                username=username,
            )
            session.add(user)
            session.commit()
            session.refresh(user)  # muat ulang atribut agar aman dibaca
            # setelah session ditutup (expire_on_commit)
            print(f"✓ User baru disimpan: {full_name or '(tanpa nama)'} "
                  f"({channel}:{platform_id})")
        return user
    except IntegrityError:
        # INSERT kena unique constraint. Dua penyebab umum:
        #   1. Baris lama pra-migrasi: telegram_id terisi tapi platform_id
        #      masih NULL, sehingga pencarian (channel, platform_id) meleset.
        #   2. Balapan dua request serentak membuat user yang sama.
        # Solusi: adopsi baris existing lewat kunci alternatif, selaraskan
        # identitas routingnya, lalu pakai — data lama tidak pernah dibuang.
        session.rollback()
        try:
            user = None
            if channel == CHANNEL_TELEGRAM:
                user = (
                    session.query(User)
                    .filter(User.telegram_id == str(platform_id))
                    .first()
                )
            elif whatsapp_lid:
                user = (
                    session.query(User)
                    .filter(User.whatsapp_lid == str(whatsapp_lid))
                    .first()
                )
            if user is None:
                print(f"✗ Gagal menyimpan user ({channel}:{platform_id}): "
                      f"bentrok unique constraint tanpa baris yg bisa diadopsi.")
                return None
            user.channel = channel
            if user.platform_id is None or channel == CHANNEL_TELEGRAM:
                user.platform_id = platform_id
            if channel == CHANNEL_TELEGRAM and user.telegram_id is None:
                user.telegram_id = telegram_id
            if whatsapp_lid is not None:
                user.whatsapp_lid = whatsapp_lid
            session.commit()
            session.refresh(user)
            print(f"✓ User existing diadopsi & diselaraskan: "
                  f"{full_name or '(tanpa nama)'} ({channel}:{platform_id})")
            return user
        except Exception as e:
            session.rollback()
            print(f"✗ Gagal adopsi user existing ({channel}:{platform_id}): {e}")
            return None
    except Exception as e:
        session.rollback()
        print(f"✗ Gagal menyimpan user: {e}")
        return None
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
    """Mengisi konfigurasi agent pulsa dan knowledge base awal.

    Idempoten: baris agent yang sudah ada TIDAK ditimpa (system_prompt,
    temperature, token, is_active milik editan superadmin via Admin Panel).
    Hanya kolom lama yang masih NULL yang di-backfill.
    """
    session = SessionLocal()
    try:
        agent = (
            session.query(AgentConfig).filter_by(agent_id="pulsa_agent").first()
        )
        # Prompt multimodal CS — port dari instruksi terbaru PROMPT.md
        # (analisis visual bukti transfer/QRIS/PLN + aturan tag [GAMBAR: x]
        # diinjeksi terpisah oleh app.py / agent.py).
        prompt_pulsa = (
            "YOU ARE A MULTIMODAL CUSTOMER SERVICE AGENT FOR A DIGITAL TRANSACTION & TOP-UP (PULSA) SERVICE.\n"
            "Your primary task is to serve customers in a friendly, empathetic, and solution-oriented manner. "
            "When a user sends an image or document, you MUST thoroughly analyze its visual content and text, "
            "and respond based on the guidelines below.\n\n"
            "VISUAL ANALYSIS AND ACTION GUIDELINES:\n\n"
            "1. SCENARIO: SUCCESSFUL TRANSFER / PAYMENT\n"
            "   - Condition: If the image contains text like \"Success\", \"Berhasil\", \"Transaksi Sukses\", "
            "along with a nominal amount and date.\n"
            "   - Action: Confirm the receipt of the payment by explicitly mentioning the nominal amount read "
            "from the image. Inform the customer that their order (pulsa/token/etc.) is currently being processed "
            "by the system and politely ask them to wait a moment.\n\n"
            "2. SCENARIO: FAILED TRANSFER / PAYMENT\n"
            "   - Condition: If the image shows a warning like \"Failed\", \"Gagal\", \"Ditolak\" (Declined), "
            "\"Pending\", \"Insufficient Balance\", or features a red warning sign/text.\n"
            "   - Action: Apologize for the inconvenience using an empathetic tone. Explain the specific reason "
            "for the failure based on the text read from the screen. Suggest a concrete solution (e.g., try again "
            "in 15 minutes, ensure sufficient balance, or change the payment method).\n\n"
            "3. SCENARIO: QRIS ISSUES\n"
            "   - Condition: If the image is an expired QRIS code (\"Expired\") or a cropped/cut-off QR code.\n"
            "   - Action: Explain that the QRIS code has a strict time limit. Guide the customer to create a new "
            "order in the system to generate a new QRIS code, or ask them to retake and send a full, uncropped "
            "photo of the QRIS if it was cut off.\n\n"
            "4. SCENARIO: WRONG DESTINATION NUMBER (TYPO)\n"
            "   - Condition: If the customer complains that their credit (pulsa) hasn't arrived, and sends a proof "
            "of order screenshot.\n"
            "   - Action: Extract and state the destination number shown in the image. Ask the customer to verify "
            "if the number is correct. Politely explain that if the provider's status is already \"Success\" but "
            "the customer made a typo, the transaction cannot be canceled or refunded according to company policy.\n\n"
            "5. SCENARIO: PLN TOKEN ISSUES (METER ERROR)\n"
            "   - Condition: If the image shows a physical electricity meter screen displaying \"GAGAL\" (Failed), "
            "\"REJECT\", or \"PERIKSA\" (Check).\n"
            "   - Action: Calm the customer down. Explain possible causes (e.g., incorrect number input, "
            "over-limit meter, or PLN system update). Provide guidance on how to re-enter the numbers slowly, "
            "or suggest contacting PLN 123 if the meter is blocked (shows \"PERIKSA\").\n\n"
            "6. SCENARIO: PRODUCT INQUIRY FROM BROCHURE/CATALOG\n"
            "   - Condition: If the image is a promo poster, brochure, or a screenshot of a price list.\n"
            "   - Action: Identify the specific product inquired about. Provide information on price, "
            "availability, or relevant promo details, then guide the customer on how to proceed with the order.\n\n"
            "7. SCENARIO: BLURRY / IRRELEVANT IMAGES (EDGE CASE)\n"
            "   - Condition: If the image is extremely blurry, cropped so important text is unreadable, "
            "or completely irrelevant (e.g., selfies, landscapes).\n"
            "   - Action: Politely inform the user that the system cannot read the image clearly. Ask the customer "
            "to resend a clearer, better-lit, and focused photo of the receipt or screen.\n\n"
            "TONE & STYLE GUIDELINES:\n"
            "- Always use the greeting \"Kak\".\n"
            "- Maintain a professional, fast-responding, and non-defensive attitude at all times, especially "
            "when handling complaints.\n"
            "- DO NOT HALLUCINATE. If the text in the image is unreadable, be honest and ask the user to provide "
            "a new image."
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
            # Baris sudah ada -> jangan timpa pengaturan superadmin.
            # Backfill hanya kolom lama yang masih NULL (samakan dengan
            # seed_cs_agent): is_active jangan di-reset True bila superadmin
            # sengaja mematikan agent.
            if agent.name is None:
                agent.name = "Bot Pulsa"
            if agent.is_active is None:
                agent.is_active = True
            session.commit()
            print("[OK] Agent 'pulsa_agent' sudah terdaftar, seed dilewati.")

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
    user_id: int,
    agent_id: str,
    user_input: str,
    bot_output: str,
    model_name: str = None,
):
    """Catat satu giliran percakapan milik user (users.id)."""
    session = SessionLocal()
    try:
        history = ChatHistory(
            user_id=user_id,
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


def get_last_10_history(user_id: int, agent_id: str):
    """10 giliran terakhir satu user dengan satu agent (lama -> baru)."""
    session = SessionLocal()
    try:
        records = (
            session.query(ChatHistory)
            .filter_by(user_id=user_id, agent_id=agent_id)
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
    Diurutkan dari pesan terakhir (terbaru di atas). Identitas yang
    dikembalikan adalah user_id (users.id) plus channel/platform_id —
    bukan lagi telegram_id — agar mendukung multi-channel.
    """
    session = SessionLocal()
    try:
        rows = (
            session.query(
                ChatHistory.user_id,
                User.channel,
                User.platform_id,
                User.telegram_id,
                User.whatsapp_lid,
                User.full_name,
                User.username,
                User.is_manual_mode,
                func.max(ChatHistory.created_at).label("last_message_at"),
                func.count(ChatHistory.id).label("total_messages"),
            )
            .join(User, User.id == ChatHistory.user_id)
            .filter(ChatHistory.agent_id == agent_id)
            .group_by(
                ChatHistory.user_id,
                User.channel,
                User.platform_id,
                User.telegram_id,
                User.whatsapp_lid,
                User.full_name,
                User.username,
                User.is_manual_mode,
            )
            .order_by(func.max(ChatHistory.created_at).desc())
            .all()
        )
        return [
            {
                "user_id": r.user_id,
                "channel": r.channel,
                "platform_id": r.platform_id,
                "telegram_id": r.telegram_id,
                "whatsapp_lid": r.whatsapp_lid,
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


def get_chat_history(user_id: int, agent_id: str):
    """Seluruh riwayat chat SATU user dengan SATU agent, kronologis.

    Mengembalikan dict (profil user + daftar pesan) atau None bila
    kombinasi user/agent tidak memiliki riwayat.
    """
    session = SessionLocal()
    try:
        user = session.get(User, user_id)
        chats = (
            session.query(ChatHistory)
            .filter(
                ChatHistory.user_id == user_id,
                ChatHistory.agent_id == agent_id,
            )
            .order_by(ChatHistory.created_at.asc(), ChatHistory.id.asc())
            .all()
        )
        if not chats:
            return None
        return {
            "user_id": user_id,
            "agent_id": agent_id,
            "channel": user.channel if user else None,
            "platform_id": user.platform_id if user else None,
            "telegram_id": user.telegram_id if user else None,
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
    product_name: str, qty: int = 1, tax_rate: float = 0.0, user_id: int = None
):
    """Membuat pesanan baru dengan mencatat total_items ke orders dan orders_items.

    user_id bersifat opsional: diisi otomatis oleh bot (lewat wrapper
    create_order_for_user) agar pesanan terikat ke user pemiliknya —
    dipakai webhook pembayaran untuk mengirim notifikasi sesuai channel.
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
            user_id=user_id,
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


# Aturan deteksi bahasa toxic (fitur 3-Strike Rule). Marker dipakai untuk
# cek kehadiran aturan agar tidak pernah terduplikasi di system prompt.
TOXIC_RULE_MARKER = "ATURAN MUTLAK"

TOXIC_RULE_TEXT = (
    "ATURAN MUTLAK: Jika pesan pengguna mengandung kata-kata kasar, makian, "
    "atau hinaan (contoh: bodoh, goblok, dll), kamu DILARANG memberikan sapaan "
    "atau menawarkan bantuan. Kamu WAJIB merespons HANYA dengan output JSON "
    'persis seperti ini: {"intent": "toxic"}.'
)


def ensure_toxic_rule_in_prompts():
    """Pastikan ATURAN MUTLAK deteksi toxic ada di system prompt SEMUA agent.

    Dipanggil sekali saat aplikasi start (lihat app.py): setiap baris di
    agent_configs yang system_prompt-nya belum memuat marker "ATURAN MUTLAK"
    otomatis ditambahkan aturan tersebut (pemisah double newline). Commit
    hanya dilakukan bila memang ada perubahan — idempoten dan aman dipanggil
    berulang (termasuk oleh reloader Flask debug / multi-worker gunicorn).
    """
    session = SessionLocal()
    updated = 0
    try:
        agents = session.query(AgentConfig).all()
        for agent in agents:
            prompt = agent.system_prompt or ""
            if TOXIC_RULE_MARKER in prompt:
                continue
            if prompt.strip():
                agent.system_prompt = f"{prompt.rstrip()}\n\n{TOXIC_RULE_TEXT}"
            else:
                agent.system_prompt = TOXIC_RULE_TEXT
            updated += 1
        if updated:
            session.commit()
            print(f"[OK] Aturan toxic ditambahkan ke {updated} system prompt agent.")
        else:
            print("[OK] Semua system prompt sudah memuat aturan toxic — dilewati.")
    except Exception as e:
        session.rollback()
        print(f"✗ Gagal memasang aturan toxic ke system prompt: {e}")
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


def is_user_in_manual_mode(platform_id: str, channel: str = CHANNEL_TELEGRAM) -> bool:
    """True bila user (channel + platform_id) sedang dalam mode manual (Human
    Takeover). Dipakai bot/webhook untuk memutuskan apakah pesan perlu
    dijawab AI atau diabaikan. Pemanggil Telegram lama tetap kompatibel:
    platform_id = chat ID (channel default 'telegram').
    """
    session = SessionLocal()
    try:
        user = (
            session.query(User)
            .filter_by(channel=channel, platform_id=str(platform_id))
            .first()
        )
        return bool(user and user.is_manual_mode)
    except Exception as e:
        print(f"✗ Gagal cek mode manual: {e}")
        return False
    finally:
        session.close()


def is_user_blocked(platform_id: str, channel: str = CHANNEL_TELEGRAM) -> bool:
    """True bila user telah diblokir permanen (3-Strike Rule bahasa toxic).

    Dipakai webhook sebagai gatekeeper paling awal: user yang diblokir
    diabaikan total (tanpa balasan, tanpa AI). Error database sengaja
    fail-open (return False) mengikuti pola is_user_in_manual_mode —
    proses bot jangan berhenti hanya karena pemeriksaan blokir gagal.
    """
    session = SessionLocal()
    try:
        user = (
            session.query(User)
            .filter_by(channel=channel, platform_id=str(platform_id))
            .first()
        )
        return bool(user and user.is_blocked)
    except Exception as e:
        print(f"✗ Gagal cek status blokir user: {e}")
        return False
    finally:
        session.close()


def set_user_blocked(
    platform_id: str, blocked: bool = True, channel: str = CHANNEL_TELEGRAM
) -> bool:
    """Set status blokir permanen user (3-Strike Rule) di tabel users.
    Baris user belum ada -> dibuat dulu. Mengembalikan True bila sukses."""
    session = SessionLocal()
    try:
        user = (
            session.query(User)
            .filter_by(channel=channel, platform_id=str(platform_id))
            .first()
        )
        if user is None:
            user = User(
                channel=channel,
                platform_id=str(platform_id),
                telegram_id=str(platform_id) if channel == CHANNEL_TELEGRAM else None,
                is_blocked=blocked,
            )
            session.add(user)
        else:
            user.is_blocked = blocked
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"✗ Gagal mengubah status blokir user: {e}")
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


