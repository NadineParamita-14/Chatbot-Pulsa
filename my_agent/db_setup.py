import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker
from pgvector.sqlalchemy import Vector

# 1. Muat kredensial dari .env
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

# 2. Definisikan Tabel
class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String, nullable=False)
    # Contoh vektor dimensi 3 untuk simulasi sederhana
    embedding = Column(Vector(3))

# 3. Buat Tabel di PostgreSQL
Base.metadata.create_all(engine)
print("✓ Tabel 'documents' berhasil dibuat!")

# 4. Tes Simpan Data Vektor
session = SessionLocal()
try:
    # Hapus data uji lama jika ada
    session.query(Document).delete()

    doc1 = Document(title="Lowongan Data Scientist", embedding=[0.9, 0.1, 0.1])
    doc2 = Document(title="Lowongan Web Developer", embedding=[0.1, 0.8, 0.2])
    session.add_all([doc1, doc2])
    session.commit()
    print("✓ Berhasil menyimpan data contoh!")

    # 5. Tes Pencarian Kemiripan (L2 / Cosine Distance)
    query_vector = [0.85, 0.15, 0.05]  # Query yang mirip doc1
    result = session.query(Document).order_by(Document.embedding.l2_distance(query_vector)).first()
    print(f"✓ Hasil pencarian terdekat: '{result.title}'")

except Exception as e:
    print("✗ Error saat operasi database:", e)
    session.rollback()
finally:
    session.close()