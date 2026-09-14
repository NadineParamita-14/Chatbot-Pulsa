# =====================================================================
# Dockerfile — Admin Panel API (Flask) production image
# ---------------------------------------------------------------------
# Build : docker build -t internlinkit .
# Run   : docker run --env-file .env -p 5000:5000 internlinkit
# ---------------------------------------------------------------------
# PDF diproses in-memory (tanpa folder uploads/), dan token/kredensial
# TIDAK di-bake ke image — semuanya diinjeksi lewat --env-file saat run.
# =====================================================================
FROM python:3.10-slim

# Jangan tulis .pyc ke image; log Python langsung flush ke docker logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependensi dulu (layer terpisah agar cache build efektif:
# kode berubah -> pip install tidak diulang selama requirements.txt tetap)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Salin sisa kode aplikasi
COPY . .

EXPOSE 5000

# Production WSGI server
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
