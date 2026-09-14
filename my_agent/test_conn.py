import os
import psycopg2
import redis
from dotenv import load_dotenv

# Muat variabel dari .env
load_dotenv()

# 1. Tes Koneksi Redis
try:
    r = redis.Redis(
        host=os.getenv("REDIS_HOST"),
        port=int(os.getenv("REDIS_PORT")),
        password=os.getenv("REDIS_PASSWORD"),
        decode_responses=True
    )
    r.set("status", "Redis terhubung dengan sukses!")
    print("✓ Redis:", r.get("status"))
except Exception as e:
    print("✗ Redis Error:", e)

# 2. Tes Koneksi pgvector (PostgreSQL)
try:
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )
    cur = conn.cursor()
    # Cek apakah extension vector aktif
    cur.execute("SELECT extname FROM pg_extension WHERE extname = 'vector';")
    ext = cur.fetchone()
    if ext:
        print("✓ pgvector: Terhubung dan ekstensi 'vector' aktif!")
    else:
        print("! PostgreSQL terhubung, tapi ekstensi 'vector' belum dibuat.")
    cur.close()
    conn.close()
except Exception as e:
    print("✗ PostgreSQL Error:", e)