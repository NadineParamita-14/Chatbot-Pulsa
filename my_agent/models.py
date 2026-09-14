import enum
import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, Float, DateTime, ForeignKey, Numeric, Enum, Boolean
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from pgvector.sqlalchemy import Vector

# Muat file .env dari folder my_agent
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ==========================================
# 1. TABEL MASTER: models_agent
# ==========================================
class ModelAgent(Base):
    __tablename__ = "models_agent"

    id_agent = Column(Integer, primary_key=True, autoincrement=True)
    agent_name = Column(String(100), unique=True, nullable=False, index=True)

    configs = relationship("AgentConfig", back_populates="model_ref")

# ==========================================
# 2. TABEL: Users / Customers
# ==========================================
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(String(50), unique=True, nullable=False, index=True)
    full_name = Column(String(100), nullable=True)
    username = Column(String(100), nullable=True)

    # Mode manual (Human Takeover): True = AI dinonaktifkan untuk user ini
    # dan admin membalas langsung dari Admin Panel.
    is_manual_mode = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    histories = relationship("ChatHistory", back_populates="user")


# ==========================================
# 3. TABEL: Agent Config 
# ==========================================
class AgentConfig(Base):
    __tablename__ = "agent_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_id = Column(String(50), unique=True, nullable=False, index=True)

    # Nama tampilan agent (mis. "Bot Pulsa") — dipakai grid kartu di Admin Panel
    name = Column(String(100), nullable=True)

    # Token bot Telegram agent kini disimpan di database (tidak lagi di .env).
    # Nullable: agent Q&A murni boleh tanpa bot Telegram.
    telegram_token = Column(String(255), nullable=True)

    # Toggle aktif/nonaktif: False = bot agent ini tidak merespons user.
    is_active = Column(Boolean, default=True, nullable=False)

    provider = Column(String(50), default="google", nullable=False)
    
    # Terhubung ke kolom agent_name di tabel models_agent
    model_name = Column(String(100), ForeignKey("models_agent.agent_name"), default="gemini-2.5-flash", nullable=False)
    
    system_prompt = Column(Text, nullable=False)
    temperature = Column(Float, default=0.3, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    model_ref = relationship("ModelAgent", back_populates="configs")
    histories = relationship("ChatHistory", back_populates="agent")


# ==========================================
# 4. Tabel RAG (Knowledge Base / Embeddings)
# Dokumen sumber (file) + potongan teks (chunk) + vektor embedding.
# Menghapus Document otomatis menghapus seluruh chunk-nya
# (ORM cascade + ondelete=CASCADE di level database).
# ==========================================
class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_name = Column(String(255), nullable=False)   # cth: "SOP.pdf"
    size = Column(Integer, default=0, nullable=False)  # ukuran file (bytes)
    upload_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    file_path = Column(String(500), nullable=True)     # cth: uploads/knowledge_base/SOP.pdf

    chunks = relationship(
        "RagDocument",
        back_populates="document",
        cascade="all, delete-orphan",
    )


class RagDocument(Base):
    __tablename__ = "rag_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(
        Integer,
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_text = Column(Text, nullable=False)  # potongan paragraf dokumen

    # pgvector sudah terkonfigurasi di proyek (ekstensi aktif di init_db),
    # jadi embedding memakai Vector, bukan JSON/ARRAY.
    embedding = Column(Vector(768), nullable=True)

    document = relationship("Document", back_populates="chunks")


# ==========================================
# 5. Tabel Historis (Chat History)
# ==========================================
class ChatHistory(Base):
    __tablename__ = "chat_histories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(String(50), ForeignKey("users.telegram_id"), nullable=False, index=True)
    agent_id = Column(String(50), ForeignKey("agent_configs.agent_id"), nullable=False)
    
    # Kolom baru: model yang digunakan saat chat ini terjadi
    model_name = Column(String(100), nullable=True)

    input = Column(Text, nullable=False)
    output = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="histories")
    agent = relationship("AgentConfig", back_populates="histories")


def init_db():
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    print("✓ Tabel users, agent_configs, rag_documents, dan chat_histories berhasil dibuat!")


# ==========================================
# 6. Tabel Products
# ==========================================
class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(150), nullable=False)
    qty = Column(Integer, default=0, nullable=False)
    price = Column(Numeric(12, 2), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

# ==========================================
# 7. TABEL: Orders
# ==========================================
class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_number = Column(String(100), unique=True, nullable=False, index=True)
    status = Column(
        Enum("pending", "success", "failed", name="order_status_enum"),
        default="pending",
        nullable=False
    )
    sub_amount = Column(Numeric(12, 2), nullable=False)
    tax = Column(Numeric(12, 2), default=0.00, nullable=False)
    total_amount = Column(Numeric(12, 2), nullable=False)
    
    # Kolom akumulasi total item keseluruhan
    total_items = Column(Integer, default=1, nullable=False)

    # Pemilik pesanan: telegram_id user yang memesan (nullable agar data
    # lama tetap valid). Dipakai webhook pembayaran untuk mengirim
    # notifikasi Telegram ke pembeli.
    telegram_id = Column(String(50), ForeignKey("users.telegram_id"), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    payment = relationship("OrderPayment", back_populates="order", uselist=False, cascade="all, delete-orphan")


# ==========================================
# 8. TABEL: Orders Items
# ==========================================
class OrderItem(Base):
    __tablename__ = "orders_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    qty = Column(Integer, default=1, nullable=False)
    
    # Kolom total item
    total_items = Column(Integer, default=1, nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    order = relationship("Order", back_populates="items")
    product = relationship("Product")

# ==========================================
# 9. TABEL: Order Payment 
# ==========================================
class OrderPayment(Base):
    __tablename__ = "order_payment"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), unique=True, nullable=False)
    
    # DIUBAH: Menggunakan Enum PostgreSQL ('paid', 'unpaid')
    status = Column(
        Enum("paid", "unpaid", name="payment_status_enum"),
        default="unpaid",
        nullable=False
    )

    order = relationship("Order", back_populates="payment")

# ==========================================
# KONSTANTA RBAC (Python Enum / Const) 
# ==========================================
class AdminRole(str, enum.Enum):
    SUPERADMIN = "superadmin"
    ADMIN = "admin"

# ==========================================
# 10. TABEL: Admins (RBAC Superadmin & Admin)
# ==========================================
class Admin(Base):
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)

    role = Column(
        SQLEnum(AdminRole, name="admin_role_enum", values_callable=lambda obj: [e.value for e in obj]),
        default=AdminRole.ADMIN.value,
        nullable=False
    )

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

def init_db():
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        # Migrasi ringan: create_all TIDAK menambah kolom baru pada tabel yang
        # sudah ada, jadi kolom agent_configs tambahan dibuat manual (idempoten).
        conn.execute(text("""
            ALTER TABLE agent_configs
                ADD COLUMN IF NOT EXISTS name VARCHAR(100),
                ADD COLUMN IF NOT EXISTS telegram_token VARCHAR(255),
                ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
        """))
        # Migrasi RAG: skema documents/rag_documents yang lama (rag_documents
        # bergaya title/content, documents bergaya db_setup title/embedding)
        # digantikan struktur baru — buang sisa tabel lama bila masih ada.
        for table, legacy_col in (("rag_documents", "content"), ("documents", "title")):
            exists = conn.execute(text(
                "SELECT 1 FROM information_schema.tables WHERE table_name = :t"
            ), {"t": table}).scalar()
            if exists:
                has_legacy = conn.execute(text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :t AND column_name = :c"
                ), {"t": table, "c": legacy_col}).scalar()
                if has_legacy:
                    conn.execute(text(f'DROP TABLE {table} CASCADE'))
                    print(f"[MIGRASI] Tabel lama '{table}' (skema legacy) dihapus.")
        conn.commit()
    Base.metadata.create_all(bind=engine)
    print("✓ Seluruh tabel berhasil disinkronkan ke database!")

if __name__ == "__main__":
    init_db()