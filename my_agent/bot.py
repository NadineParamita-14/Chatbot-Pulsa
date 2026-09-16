import os
import sys
import re
from pathlib import Path
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes
from google import genai
from google.genai import types

sys.path.append(str(Path(__file__).resolve().parent))
from db_service import (
    get_agent_config,
    get_agent_telegram_token,
    is_agent_active,
    save_chat_history,
    get_last_10_history,
    get_all_rag_knowledge,
    get_or_create_user,
    get_products_json_string,
    create_new_order,
    is_user_in_manual_mode
)

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

# Token Telegram TIDAK lagi dibaca dari .env — diambil dari tabel
# agent_configs (kolom telegram_token) saat bot dijalankan, sehingga
# superadmin bisa menggantinya dari Admin Panel tanpa menyentuh kode.
GEMINI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

client = genai.Client(api_key=GEMINI_KEY)
CURRENT_AGENT_ID = "pulsa_agent"

# Balasan bila agent dimatikan superadmin lewat Admin Panel (is_active=False)
OFFLINE_MESSAGE = (
    "Mohon maaf, layanan sedang offline saat ini. "
    "Silakan hubungi kami kembali nanti."
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    get_or_create_user(
        telegram_id=str(user.id),
        full_name=user.full_name,
        username=user.username
    )

    welcome_text = (
        f"Halo {user.first_name}! Selamat datang di Toko Pulsa Otomatis.\n\n"
        "Saya bisa membantu Anda untuk:\n"
        "• Cek daftar harga & provider\n"
        "• Beli pulsa reguler / paket data\n"
        "• Pembuatan invoice pesanan & pembayaran\n\n"
        "Ketik kebutuhan Anda, misalnya: *'Mau beli pulsa Telkomsel 10rb'* atau *'Cek harga'*"
    )
    await update.message.reply_text(welcome_text, parse_mode="Markdown")

async def reply(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    user_id = str(user.id)
    
    # Menangkap teks (baik dari pesan biasa maupun caption gambar)
    user_text = update.message.text or update.message.caption or ""

    get_or_create_user(
        telegram_id=user_id,
        full_name=user.full_name,
        username=user.username
    )

    if is_user_in_manual_mode(user_id):
        return

    if not is_agent_active(CURRENT_AGENT_ID):
        await update.message.reply_text(OFFLINE_MESSAGE)
        return

    agent_config = get_agent_config(CURRENT_AGENT_ID)
    base_prompt = agent_config.system_prompt if agent_config else "Kamu asisten penjual pulsa otomatis."
    temperature = agent_config.temperature if agent_config else 0.3
    selected_model = getattr(agent_config, "model_name", "gemini-2.5-flash") or "gemini-2.5-flash"

    products_array_json = get_products_json_string()
    rag_knowledge = get_all_rag_knowledge()

    # --- SUNTIKAN ATURAN GAMBAR ---
    full_system_instruction = f"""{base_prompt}

DAFTAR PRODUK RESMI (ARRAY DATA) TERKINI:
{products_array_json}

INFORMASI TAMBAHAN & PEMBAYARAN:
{rag_knowledge}

ATURAN MUTLAK TENTANG GAMBAR (INSTRUKSI TERTINGGI):
Abaikan ketiadaan data promo di database-mu. Kamu memiliki akses langsung ke gambar promo lokal. 
1. JIKA PENGGUNA BERTANYA PROMO/DISKON: KAMU WAJIB membalas dengan kalimat "Tentu, ini dia promo spesial dari kami!" lalu KAMU WAJIB menuliskan tag [GAMBAR: promo_pulsa.jpg] di bagian paling akhir.
2. JIKA PENGGUNA BERTANYA DAFTAR HARGA/PRICELIST: KAMU WAJIB membalas "Berikut adalah daftar harga kami:" dan tambahkan tag [GAMBAR: daftar_harga.jpg] di akhir teks.

ATURAN WAJIB TERKAIT PRODUK:
1. Cocokkan pertanyaan pengguna HANYA dengan elemen array pada DAFTAR PRODUK RESMI di atas.
2. JIKA PRODUK TERSEDIA DI ARRAY: Jelaskan nama produk, nominal, sisa stok, dan deskripsinya.
3. JIKA PENGGUNA INGIN MEMESAN: Panggil tool `create_order_for_user`.
4. ABAIKAN sisa stok yang pernah kamu sebutkan di riwayat chat sebelumnya, gunakan data TERKINI.
"""

    past_chats = get_last_10_history(telegram_id=user_id, agent_id=CURRENT_AGENT_ID)
    history_contents = []
    for chat in past_chats:
        history_contents.append(types.Content(role="user", parts=[types.Part.from_text(text=chat.input)]))
        history_contents.append(types.Content(role="model", parts=[types.Part.from_text(text=chat.output)]))

    def create_order_for_user(product_name: str, qty: int = 1, tax_rate: float = 0.0):
        return create_new_order(product_name, qty=qty, tax_rate=tax_rate, telegram_id=user_id)

    # --- LOGIKA PENERIMA GAMBAR DARI USER ---
    photo_part = None
    if update.message.photo:
        photo_file = await update.message.photo[-1].get_file()
        photo_bytes = await photo_file.download_as_bytearray()
        photo_part = types.Part.from_bytes(data=photo_bytes, mime_type="image/jpeg")

    try:
        chat_session = client.chats.create(
            model=selected_model,
            config=types.GenerateContentConfig(
                system_instruction=full_system_instruction,
                temperature=temperature,
                tools=[create_order_for_user]
            ),
            history=history_contents
        )
        
        injected_prompt = (
            f"[SISTEM HIDDEN CONTEXT - STOK TERKINI: {products_array_json}]\n\n"
            f"Pertanyaan Pengguna: {user_text}"
        )
        
        # Jika user kirim foto, suapkan foto beserta teks ke Gemini
        if photo_part:
            response = chat_session.send_message([photo_part, injected_prompt])
        else:
            response = chat_session.send_message(injected_prompt)
            
        bot_reply = response.text if response.text else "Pesanan berhasil dicatat ke sistem."
    except Exception as e:
        bot_reply = f"Maaf, terjadi kendala pada layanan: {e}"

    save_chat_history(
        telegram_id=user_id,
        agent_id=CURRENT_AGENT_ID,
        model_name=selected_model,
        user_input=user_text,
        bot_output=bot_reply
    )

    # --- LOGIKA "TUKANG POS" (MENGIRIM GAMBAR) ---
    match = re.search(r'\[GAMBAR:\s*(.+?)\]', bot_reply)
    if match:
        filename = match.group(1).strip()
        # Bersihkan tag dari teks balasan
        clean_text = re.sub(r'\[GAMBAR:\s*(.+?)\]', '', bot_reply).strip()
        
        # Arahkan ke folder static/bot_images (Mundur 1 folder dari my_agent)
        image_path = Path(__file__).resolve().parent.parent / "static" / "bot_images" / filename
        
        if clean_text:
            await update.message.reply_text(clean_text)
            
        if image_path.exists():
            with open(image_path, 'rb') as photo:
                await update.message.reply_photo(photo=photo)
        else:
            await update.message.reply_text(f"(Sistem Error: Gambar {filename} tidak ditemukan di server)")
    else:
        # Jika tidak ada tag gambar, kirim teks biasa
        await update.message.reply_text(bot_reply)

def main():
    # Token diambil dari database (agent_configs.telegram_token) sesuai
    # CURRENT_AGENT_ID. Bila belum diisi, hentikan bot dengan pesan jelas —
    # superadmin mengisinya lewat Admin Panel: Agent Config -> pilih agent.
    telegram_token = get_agent_telegram_token(CURRENT_AGENT_ID)
    if not telegram_token:
        print(f"[GAGAL] Token Telegram untuk agent '{CURRENT_AGENT_ID}' belum diisi di database.")
        print("        Isi lewat Admin Panel: menu Agent Config -> pilih agent -> kolom 'Telegram Token' -> Simpan.")
        sys.exit(1)

    print(f"Bot Pulsa Otomatis sedang aktif... (agent: {CURRENT_AGENT_ID}, Ctrl+C untuk stop)")
    app = ApplicationBuilder().token(telegram_token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler((filters.TEXT | filters.PHOTO) & ~filters.COMMAND, reply))
    app.run_polling()

if __name__ == "__main__":
    main()