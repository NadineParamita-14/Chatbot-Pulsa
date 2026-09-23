"""
=====================================================================
 Bot Customer Service (CS) — Telegram
---------------------------------------------------------------------
 Duplikat dari bot.py dengan konfigurasi khusus CS Agent:
 - Token  : diambil dari DATABASE (agent_configs.telegram_token untuk
            agent_id "cs_agent") — diisi lewat Admin Panel, bukan .env
 - Agent  : cs_agent (system_prompt & temperature dari agent_configs)
 - Tool   : check_order_status (FAQ + lacak pesanan/keluhan).
            Pembuatan pesanan tetap tugas bot penjualan (bot.py).
 Jalankan:  python bot_cs.py
=====================================================================
"""

import os
import sys
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
    check_order_status,
    seed_cs_agent,
    is_user_in_manual_mode
)

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

GEMINI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

client = genai.Client(api_key=GEMINI_KEY)
CURRENT_AGENT_ID = "cs_agent"

# Balasan bila agent dimatikan superadmin lewat Admin Panel (is_active=False)
OFFLINE_MESSAGE = (
    "Mohon maaf, layanan sedang offline saat ini. "
    "Silakan hubungi kami kembali nanti."
)

# Prompt cadangan bila cs_agent belum ada di tabel agent_configs
FALLBACK_PROMPT = (
    "Kamu adalah customer service toko pulsa otomatis yang ramah dan membantu. "
    "Fokusmu: menjawab FAQ, mengecek status pesanan, dan menangani keluhan."
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    get_or_create_user(
        telegram_id=str(user.id),
        full_name=user.full_name,
        username=user.username
    )

    welcome_text = (
        f"Halo {user.first_name}! Saya Customer Service Toko Pulsa Otomatis.\n\n"
        "Saya bisa membantu Anda untuk:\n"
        "• Menjawab FAQ (harga, cara beli, metode pembayaran)\n"
        "• Mengecek status pesanan lewat nomor invoice\n"
        "• Menangani keluhan/complaint\n\n"
        "Ketik pertanyaan Anda, misalnya: *'Pesanan INV-1A2B3C4D saya bagaimana?'*"
    )
    await update.message.reply_text(welcome_text, parse_mode="Markdown")

async def reply(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    user_id = str(user.id)
    user_text = update.message.text

    # 1. Pastikan user tercatat di tabel users
    app_user = get_or_create_user(
        telegram_id=user_id,
        full_name=user.full_name,
        username=user.username
    )
    if app_user is None:
        return  # gagal mencatat user (mis. DB bermasalah) -> hentikan

    # 1.5 Human Takeover: saat admin mengambil alih percakapan (manual mode),
    # bot harus diam — pesan tidak diproses AI dan tidak dibalas otomatis.
    if is_user_in_manual_mode(user_id):
        return

    # 1.6 Status aktif agent: superadmin bisa mematikan bot dari Admin Panel
    # (agent_configs.is_active). Bila non-aktif, balas pesan sopan TANPA
    # memanggil Gemini. Dicek tiap pesan agar toggle langsung berlaku.
    if not is_agent_active(CURRENT_AGENT_ID):
        await update.message.reply_text(OFFLINE_MESSAGE)
        return

    # 2. Ambil konfigurasi model dan prompt CS dari DB
    agent_config = get_agent_config(CURRENT_AGENT_ID)
    base_prompt = agent_config.system_prompt if agent_config else FALLBACK_PROMPT
    temperature = agent_config.temperature if agent_config else 0.3
    selected_model = getattr(agent_config, "model_name", "gemini-2.5-flash") or "gemini-2.5-flash"

    # 3. Ambil knowledge base FAQ (harga, pembayaran, dsb)
    rag_knowledge = get_all_rag_knowledge()

    # 4. Susun instruksi khas Customer Service
    full_system_instruction = f"""{base_prompt}

INFORMASI TAMBAHAN & PEMBAYARAN (SUMBER FAQ RESMI):
{rag_knowledge}

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

    # 5. Susun riwayat chat
    past_chats = get_last_10_history(user_id=app_user.id, agent_id=CURRENT_AGENT_ID)
    history_contents = []
    for chat in past_chats:
        history_contents.append(types.Content(role="user", parts=[types.Part.from_text(text=chat.input)]))
        history_contents.append(types.Content(role="model", parts=[types.Part.from_text(text=chat.output)]))

    # 6. Panggil Gemini via chat session agar tool otomatis tereksekusi
    try:
        chat_session = client.chats.create(
            model=selected_model,
            config=types.GenerateContentConfig(
                system_instruction=full_system_instruction,
                temperature=temperature,
                tools=[check_order_status]
            ),
            history=history_contents
        )
        response = chat_session.send_message(user_text)
        bot_reply = response.text if response.text else "Mohon maaf, silakan coba ulangi pertanyaan Anda."
    except Exception as e:
        bot_reply = f"Maaf, terjadi kendala pada layanan: {e}"

    # 7. Simpan riwayat chat beserta model yang aktif
    save_chat_history(
        user_id=app_user.id,
        agent_id=CURRENT_AGENT_ID,
        model_name=selected_model,
        user_input=user_text,
        bot_output=bot_reply
    )

    await update.message.reply_text(bot_reply)

def main():
    # Token diambil dari database (agent_configs.telegram_token) sesuai
    # CURRENT_AGENT_ID. Bila belum diisi, hentikan bot dengan pesan jelas.
    telegram_token = get_agent_telegram_token(CURRENT_AGENT_ID)
    if not telegram_token:
        print(f"[GAGAL] Token Telegram untuk agent '{CURRENT_AGENT_ID}' belum diisi di database.")
        print("        Isi lewat Admin Panel: menu Agent Config -> pilih agent -> kolom 'Telegram Token' -> Simpan.")
        sys.exit(1)

    # Pastikan cs_agent terdaftar (chat_histories.agent_id adalah FK ke sana)
    seed_cs_agent()

    print(f"Bot Customer Service sedang aktif... (agent: {CURRENT_AGENT_ID}, Ctrl+C untuk stop)")
    app = ApplicationBuilder().token(telegram_token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, reply))
    app.run_polling()

if __name__ == "__main__":
    main()
