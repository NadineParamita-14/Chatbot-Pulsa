Saya sedang membangun sistem Admin Panel menggunakan Flask (Python) dan Single Page Application (SPA) berbasis Vanilla JS (HTML/CSS/JS murni tanpa framework seperti React/Vue). 

Sistem ini terhubung ke database PostgreSQL yang sudah memiliki skema tabel dan model SQLAlchemy yang telah berjalan sebelumnya.

Tolong buatkan struktur proyek, backend REST API menggunakan Flask, dan frontend SPA Vanilla JS yang bersih dan responsif.

---

### 1. Konteks Database & Arsitektur Saat Ini
Tabel yang sudah ada di database (`vectordb`) dan model SQLAlchemy:
1. `admins`: `id`, `username`, `password_hash`, `full_name`, `role` (ENUM: 'superadmin', 'admin'), `is_active`, timestamps.
2. `products`: `id`, `name`, `qty`, `price`, `description`, timestamps.
3. `orders`: `id`, `invoice_number`, `status` (ENUM: 'pending', 'success', 'failed'), `sub_amount`, `tax`, `total_amount`, `total_items`, timestamps.
4. `orders_items`: `id`, `order_id`, `product_id`, `qty`, `total_items`, timestamps.
5. `order_payment`: `id`, `order_id`, `status` (ENUM: 'paid', 'unpaid').
6. `agent_configs`: Konfigurasi agent (`agent_id`, `model_name`, `system_prompt`, `temperature`).
7. `models_agent`: Daftar model AI yang tersedia (`id_agent`, `agent_name`).
8. `chat_histories`: Riwayat interaksi bot (`telegram_id`, `agent_id`, `model_name`, `input`, `output`, timestamps).

---

### 2. Kebutuhan Backend (Flask REST API)
- Gunakan JWT (JSON Web Token) atau session cookie yang aman untuk autentikasi admin.
- Terapkan middleware/decorator RBAC:
  - `@admin_required`: Bisa diakses oleh `admin` dan `superadmin`.
  - `@superadmin_required`: Hanya bisa diakses oleh `superadmin`.
- Endpoint yang dibutuhkan:
  1. **Auth:** `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
  2. **Dashboard Overview:** `GET /api/dashboard/stats` (Total pendapatan, total order pending/success, total stok produk, total chat hari ini).
  3. **Manajemen Produk (CRUD):** 
     - `GET /api/products`
     - `POST /api/products` (Superadmin)
     - `PUT /api/products/<id>` (Superadmin)
     - `DELETE /api/products/<id>` (Superadmin)
  4. **Manajemen Transaksi & Pembayaran:**
     - `GET /api/orders` (Filter status, search invoice, pagination sederhana)
     - `GET /api/orders/<id>` (Detail order beserta order_items dan payment)
     - `PATCH /api/orders/<id>/verify-payment` (Ubah status payment jadi 'paid' dan order jadi 'success')
  5. **Konfigurasi AI Agent (Khusus Superadmin):**
     - `GET /api/agent/config`
     - `PUT /api/agent/config` (Ubah model_name, system_prompt, temperature)
     - `GET /api/agent/models` (Daftar opsi model dari `models_agent`)
  6. **Monitoring Chat Bot:**
     - `GET /api/chats` (Melihat riwayat input-output pengguna dan model_name yang digunakan)
  7. **Manajemen Admin (Khusus Superadmin):**
     - `GET /api/admins`
     - `POST /api/admins` (Buat akun admin baru)

---

### 3. Kebutuhan Frontend (Single Page Application - Vanilla JS)
- Letakkan di folder template Flask standar (`templates/index.html` dan `static/js/app.js`, `static/css/style.css`).
- Menggunakan konsep client-side routing sederhana (hash-based `#dashboard`, `#products`, `#orders`, `#agent-config`, `#chats`, `#admin-management`) tanpa reload halaman penuh.
- State management sederhana di Vanilla JS:
  - Simpan token di localStorage/sessionStorage.
  - Redirect ke view `#login` jika belum login atau token kedaluwarsa.
  - Sembunyikan menu navigasi (Agent Config & Admin Management) jika role pengguna adalah `admin` (bukan `superadmin`).
- Tampilan UI:
  - Layout Dashboard profesional (Sidebar navigasi di kiri, Topbar profil & logout, Main content di kanan).
  - Boleh gunakan framework CSS ringan (seperti Tailwind CSS via CDN atau CSS modern modular).
  - Tampilkan tabel yang rapi dengan badge status (misal: badge hijau untuk 'paid'/'success', kuning untuk 'pending'/'unpaid').
  - Modal pop-up untuk form tambah/edit produk dan konfirmasi verifikasi pembayaran.

---

### Output yang Diharapkan:
1. Struktur folder proyek Flask.
2. File `app.py` atau blueprint API lengkap beserta dekorator RBAC-nya.
3. File `templates/index.html` (struktur layout SPA & kontainer tampilan dinamis).
4. File `static/js/app.js` (logika fetch API, render komponen DOM, client-side routing `#`, dan auth check).
5. File `static/css/style.css` (styling pendukung).

# Revisi tampilan chat history
# Role & Context
Act as a Senior Full-Stack Developer. We are continuing the development of the Flask + Vanilla JS SPA Admin Panel. 
Currently, the "Riwayat Chat" (#chats) view displays data as a flat HTML table (Time, Telegram ID, Name, Input, Output). 

# Objective
I want to completely redesign the `#chats` view to look and function like WhatsApp Web. 
It should have a 2-pane layout:
1. **Left Pane (Contact List):** Displays a list of unique users who have interacted with the bot.
2. **Right Pane (Chat Window):** Displays the conversation history (bubbles) for the selected user.

# 1. Backend API Updates (Flask - app.py)
Please update or add new endpoints to support this UI:
- `GET /api/chats/users`: Returns a list of unique users from the `chat_histories` table (including their `telegram_id`, `full_name`, and the timestamp of their last message to sort by recent).
- `GET /api/chats/<telegram_id>`: Returns the complete chat history for a specific user, ordered chronologically.

# 2. Frontend Updates (HTML & Tailwind CSS)
Modify the `#chats` container in `templates/index.html`:
- Create a CSS Grid or Flexbox layout (e.g., `grid-cols-3` or `grid-cols-4`).
- **Left Sidebar:** A scrollable list of users. Highlight the currently active user.
- **Right Area:** 
  - A header showing the selected user's name and Telegram ID.
  - A scrollable chat area with a background color/pattern typical of chat apps.
  - **User Messages (Input):** Chat bubbles aligned to the right, styled with a distinct color (e.g., light green).
  - **Bot Messages (Output):** Chat bubbles aligned to the left, styled with a different color (e.g., white/light gray), including a small text indicating the `model_name` used.
- Add an empty state for the Right Area ("Select a user to view chat history") when no user is clicked yet.

# 3. JavaScript Updates (app.js / api.js)
- Update the fetch logic to hit the new endpoints.
- Create a function to render the user list on the left.
- Create an `onclick` event for each user that fetches and renders their chat bubbles on the right.
- Ensure the chat container automatically scrolls to the bottom when a conversation is loaded.

Please provide the specific code changes needed for `app.py`, `templates/index.html`, and `static/js/app.js`. Keep the Vanilla JS clean and ensure the Tailwind classes are responsive.

# Tambahan fitur Riwayat Chat
# Role & Context
Act as a Senior Full-Stack Developer & Telegram Bot Expert. We are adding a "Human Takeover / Manual Mode" feature to our Flask SPA Admin Panel and Telegram Bot. 

I have already added a new column `is_manual_mode` (BOOLEAN, default FALSE) to the `users` table in my PostgreSQL database.

# Objective
Implement the UI and logic for admins to take over the chat from the AI bot, disable the AI for that specific user, and send messages directly from the Admin Panel to the user's Telegram.

# 1. Update SQLAlchemy Models (`my_agent/models.py`)
- Add `is_manual_mode = Column(Boolean, default=False, nullable=False)` to the `User` class.

# 2. Backend API Updates (Flask - `app.py` or your routing file)
Please add the following endpoints. (Assume `TELEGRAM_BOT_TOKEN` is loaded from `.env`):
- `POST /api/chats/<telegram_id>/toggle-mode`: Toggles the `is_manual_mode` status for the user in the database and returns the new status.
- `POST /api/chats/<telegram_id>/send`: 
  1. Accepts JSON payload `{ "message": "..." }`.
  2. Sends the message to the user via Telegram Bot API (`https://api.telegram.org/bot<TOKEN>/sendMessage`).
  3. Saves the sent message to the `chat_histories` table (set `model_name` to "Human/Admin" and `input` as something like "[Admin Reply]").

# 3. Frontend Updates (HTML & Tailwind CSS in `templates/index.html`)
Update the Right Pane of the `#chats` view:
- **Header:** Add a Toggle Switch (checkbox styled as a toggle) in the top-right corner labeled "Manual Mode".
- **Bottom Area:** Add a chat input area containing a text input field and a "Send" button.
- **UI States:** 
  - If Manual Mode is OFF: The input field and send button must be `disabled`, greyed out, and show a placeholder "AI is currently handling this chat. Turn on Manual Mode to reply."
  - If Manual Mode is ON: Enable the input field and button.

# 4. JavaScript Updates (`static/js/app.js`)
- When a user is clicked from the left pane, fetch their current `is_manual_mode` status (you might need to update the `GET /api/chats/<telegram_id>` endpoint to return this status alongside the chat history) and update the toggle UI and input field state accordingly.
- Add an event listener to the Toggle Switch to call `POST /api/chats/<telegram_id>/toggle-mode` and dynamically lock/unlock the input field.
- Add an event listener to the Send button. When clicked, call `POST /api/chats/<telegram_id>/send`, clear the input field, and immediately append the new chat bubble to the UI (scroll to bottom).

# 5. Telegram Bot Update (`my_agent/bot.py`)
Update the message handler logic. Before sending the user's message to the Gemini AI:
1. Query the database for the user's `is_manual_mode` status.
2. If `is_manual_mode == True`: Do NOT call Gemini. Just ignore the message (or maybe just save the user's input to history, but the bot should remain silent).
3. If `is_manual_mode == False`: Proceed with the normal AI response generation.

Please write out the exact code modifications required for each file. Ensure the Tailwind UI looks modern and matches the WhatsApp Web vibe. 

# revisi letak bubble chat 
# Role & Context
Act as a Senior Full-Stack Developer. We need to tweak the UX of the `#chats` view in our Vanilla JS SPA. 
Currently, the chat rendering logic aligns the user's `input` to the right (green bubble) and the bot/admin `output` to the left (white bubble). 

# Objective
Since this is an **Admin Panel**, we need to reverse the perspective so it behaves like a standard messaging app from the admin's point of view.

# Frontend Update Requirement (`static/js/app.js`)
Please find the function that renders the chat history bubbles and swap the logic:
1. **User's Message (`chat.input`)**: Must be rendered on the **LEFT** side (white/light gray bubble). This represents incoming messages from the customer.
2. **AI / Admin's Message (`chat.output`)**: Must be rendered on the **RIGHT** side (green bubble). This represents outgoing messages from our system/CS. Include the `model_name` indicator in this bubble as well.

Please rewrite the specific JavaScript rendering function (e.g., `renderChatHistory` or whatever it is named) to apply this swap using Tailwind CSS classes (`justify-end`, `justify-start`, `bg-green-100`, `bg-white`, etc.). Ensure the alignment, colors, and timestamps are correctly applied to the reversed perspective.

# revisi jumlah stok 
# Role & Context
Act as a Senior Full-Stack Developer. We need to refine the inventory and payment verification logic in our Flask + Vanilla JS Admin Panel.

# Objective
Implement a "Deduct Stock on Payment" architecture. Stock should only decrease when an order is explicitly verified as 'paid' by the admin, NOT when the order is initially created by the bot.

# 1. Backend Updates (`my_agent/db_service.py` & `app.py`)
- In `create_new_order()`: Remove or comment out the code that deducts `product.qty`. The stock must remain unchanged when an order is created (status 'pending').
- In `mark_order_as_paid(invoice_number)`: Add logic to deduct the stock. Iterate through `order.items`, fetch the associated `Product`, and subtract `item.qty` from `product.qty`. Add a safety check to ensure stock isn't deducted twice if the order is already 'success'.
- Ensure the endpoint `PATCH /api/orders/<invoice_number>/verify-payment` (or similar) correctly calls this updated `mark_order_as_paid` function.

# 2. Frontend Updates (`static/js/app.js` & `templates/index.html`)
- Modify the Order Detail Modal rendering logic:
  - If the order `status` is `'pending'` and payment is `'unpaid'`, dynamically render a "Verifikasi Pembayaran" (Verify Payment) button inside the modal (e.g., next to the "Tutup" button).
  - If the order is already `'success'` and `'paid'`, hide or remove this verification button so the admin cannot click it twice.
- Attach an event listener to the "Verifikasi Pembayaran" button that:
  1. Calls the `PATCH` endpoint to verify the payment.
  2. Shows a success alert/toast indicating "Pembayaran diverifikasi & stok dikurangi".
  3. Automatically re-fetches the order list and updates the modal UI to reflect the new 'success' status without requiring a hard page reload.

# payment
# Role & Context
Act as a Senior Backend Developer. We need to implement a Payment Webhook/Callback API in our Flask application (`app.py`) to simulate receiving payment confirmations from a Payment Gateway.

# Objective
1. Create a new POST endpoint that accepts JSON payloads containing payment statuses.
2. Automatically trigger the `mark_order_as_paid()` function from `db_service.py` to update the database and deduct stock if the payment is successful.
3. Provide a step-by-step guide on how I can test this new endpoint using Postman.

# Part 1: Backend Implementation (`app.py`)
Please add the following logic to `app.py`:
- **Route:** `@app.route('/api/payments/callback', methods=['POST'])`
- **Expected Payload:**
  ```json
  {
    "invoice_number": "INV-XXXXXXX",
    "status": "success",
    "secret_key": "my_secret_key_123"
  }

# Role & Context
Act as a Senior Backend Developer. We successfully created the `/api/payments/callback` webhook in `app.py` and tested it with Postman. The database updates correctly. 

# Objective
We need to integrate a notification system. When the webhook successfully verifies a payment, the Flask app should automatically send a Telegram message to the user acknowledging the payment.

# Instructions for Claude
1. **Analyze Database Relationship:** Check if our current `Order` or `create_new_order` function saves the `telegram_id` (or user relationship) when an order is created.
2. **Update Schema/Function (If Needed):** If `telegram_id` is NOT currently linked to an `Order`, please modify `models.py` and `db_service.py` (`create_new_order`) so that every order is tied to a specific user's Telegram ID.
3. **Update Webhook in `app.py`:** 
   - Import the necessary Telegram Bot functions (e.g., using `python-telegram-bot` or simple `requests`).
   - Modify the `/api/payments/callback` route so that after `mark_order_as_paid` executes successfully, it fetches the `telegram_id` for that invoice.
   - Send a message to that user: "✅ *Pembayaran untuk invoice {invoice_number} telah berhasil diverifikasi. Pesanan Anda sedang diproses!*" (Parse mode: Markdown).
4. **Provide the Code:** Show me exactly what files to update and the code to insert.

# Role & Context
Act as a Senior Frontend Developer. We need to refactor the `#agent-config` view in our Flask + Vanilla JS + Tailwind CSS Admin Panel. 

# Current State
Currently, the Agent Config menu directly displays a static configuration form (Provider, Temperature, Model, System Prompt) for a single agent.

# Objective
We want to transform this into a dynamic "Two-View" system to support multiple agents (`pulsa_agent` and `cs_agent`).

# UI/UX Requirements
1. **View 1 (Agent List - Default):** 
   - Create a container displaying a grid of cards for the available agents. 
   - For now, visually prepare two cards: 
     - 🤖 **Bot Pulsa** (ID: `pulsa_agent`)
     - 🎧 **Bot Customer Service** (ID: `cs_agent`)
   - Each card should be clickable.

2. **View 2 (Agent Form - Detail):**
   - When a card is clicked, hide "View 1" and display "View 2" (the existing configuration form).
   - Add a prominent "⬅ Kembali" (Back) button at the top of the form.
   - When the "Kembali" button is clicked, hide the form and show the Agent List again.

3. **Vanilla JS Logic:**
   - Write the JavaScript logic (for `app.js` or equivalent) to handle this state switching. Use Tailwind's `hidden` class to toggle visibility between the list container and the form container.
   - Prepare a `currentSelectedAgent` variable in JS so that later, we can fetch the correct data for the selected agent.

# Output
Please provide:
1. The updated HTML structure for the `#agent-config` section.
2. The Vanilla JS code to handle the navigation between the list and the form.

# Role & Context
Act as a Senior Python Developer. I have generated a new Telegram Bot token from BotFather for our Customer Service (CS) bot and saved it in my `.env` file as `TELEGRAM_CS_BOT_TOKEN`.

# Objective
Create a new Python script named `bot_cs.py` (inside the `my_agent` folder) based on our existing `bot.py`, but specifically configured for the CS Agent.

# Instructions for Claude
1. **Analyze `bot.py`:** Read the logic of the current `my_agent/bot.py`.
2. **Create `bot_cs.py`:** Duplicate the logic into a new file named `bot_cs.py`.
3. **Modify Variables:**
   - Change the token variable to load the new CS token: `TELEGRAM_TOKEN = os.getenv("TELEGRAM_CS_BOT_TOKEN")`.
   - Change the agent identifier: `CURRENT_AGENT_ID = "cs_agent"`.
4. **Adjust Logic (Optional but recommended):**
   - The CS Bot's main job is answering FAQs and handling complaints based on the `rag_knowledge` and its specific `system_prompt` from the database. 
   - You can keep the `create_new_order` tool if you think a CS bot might occasionally help someone buy, or remove the tool dependency if you want to keep the CS bot strictly for Q&A. Use your best architectural judgment for a Customer Service AI.
5. **Output:** Provide the complete code for `bot_cs.py` or apply it directly to the workspace.

# Role & Context
Act as a Senior Backend Developer. We are upgrading our dynamic Agent Configuration system in our Flask app. We want to stop using hardcoded Telegram tokens in `.env` and move them to the database, alongside an active/inactive toggle. We also need an API to add completely new agents.

# Objective
Update the SQLAlchemy models, database services, and Flask API routes to support `telegram_token` and `is_active` fields for the agents.

# Instructions for Claude

1. **Update `models.py`:**
   - Modify the `agent_configs` table (or equivalent model) to include two new columns:
     - `telegram_token` (String, nullable=True)
     - `is_active` (Boolean, default=True)

2. **Update `db_service.py`:**
   - Modify the database seeding function (where `pulsa_agent` and `cs_agent` are initialized) to include these two new fields. Set `is_active=True` by default. You can leave the tokens empty or put placeholder strings for now.
   - Create a new function (e.g., `create_new_agent_config(agent_id, name, telegram_token)`) to insert a brand new agent into the database with default AI settings.

3. **Update `app.py` (API Routes):**
   - **GET & PUT Config:** Update the existing `/api/agent_config/<agent_id>` endpoints so that they include `telegram_token` and `is_active` in both the returned JSON and the accepted JSON payload.
   - **POST New Agent:** Create a new endpoint `POST /api/agents` that accepts JSON `{ "agent_id": "...", "name": "...", "telegram_token": "..." }` and calls the `create_new_agent_config` function.
   - **GET All Agents:** Ensure there is an endpoint (e.g., `GET /api/agents`) that returns a list of all agents (including their ID, name, and `is_active` status) for the frontend grid view.

# Output
Please provide the exact code modifications for `models.py`, `db_service.py`, and `app.py`. Apply the changes directly to the workspace if possible.

# Role & Context
Act as a Senior Frontend Developer. The backend API has been successfully updated to handle `telegram_token` and `is_active` fields, including a new `POST /api/agents` endpoint to create completely new agents. 

# Objective
Update the `#agent-config` UI (HTML and Vanilla JS) to support these new features.

# Instructions for Claude

1. **Update View 1 (Agent List):**
   - **Status Badges:** In the agent card rendering logic, add a status badge. If `is_active` is true, show a green "🟢 Aktif" badge. If false, show a red/gray "🔴 Non-Aktif" badge.
   - **Add Button:** Add a prominent "+ Tambah Agent" button at the top right of the agent list container.

2. **Create "Add Agent" Modal:**
   - Create a hidden modal (popup) in the HTML for creating a new agent.
   - It should have input fields for: `agent_id` (lowercase, no spaces), `name` (Agent Display Name), and `telegram_token`.
   - Add "Batal" (Cancel) and "Simpan" (Save) buttons.
   - **JS Logic:** When "Simpan" is clicked, send a `POST` request to `/api/agents`. On success, close the modal and refresh the Agent List (View 1).

3. **Update View 2 (Detail Form):**
   - **Toggle Switch:** Add a checkbox or toggle UI for the `is_active` status.
   - **Token Input with Eye Icon:** Add an input field for `telegram_token`. Make its type `password` by default. Next to it, add a button with an eye icon (👁️).
   - **JS Logic (Eye Icon):** Write the Vanilla JS logic so that clicking the eye icon toggles the token input type between `password` and `text`.
   - **JS Logic (Save):** Ensure the `is_active` and `telegram_token` values are included in the payload when updating the agent via `PUT` or `POST` to `/api/agent_config/<agent_id>`.

# Output
Provide the necessary HTML additions and the updated Vanilla JS code to handle the modal, the password visibility toggle, and the API payload updates.

# Role & Context
Act as a Senior Python Developer. The backend and frontend for our dynamic Agent Config are 100% complete. The `agent_configs` table in PostgreSQL now reliably holds `telegram_token` and `is_active` for each `agent_id`. 

# Objective
Refactor `my_agent/bot.py` so it completely stops using the `.env` file for the Telegram token. Instead, it must fetch its token and actively check its status directly from the database.

# Instructions for Claude

1. **Fetch Token on Startup:** 
   - Modify the initialization section of `bot.py`. Use the `CURRENT_AGENT_ID` (e.g., "pulsa_agent") to query the database and retrieve the `telegram_token`.
   - If the token is missing or empty in the database, print a clear error message to the terminal and exit the script gracefully.

2. **Dynamic Active Status Check (Per Message):**
   - Inside the main message handler (e.g., `handle_message`), query the database to check the current `is_active` status for `CURRENT_AGENT_ID` *before* processing the user's input.
   - If `is_active` is `False`, the bot should immediately reply to the user with a polite message (e.g., "Mohon maaf, layanan sedang offline saat ini. Silakan hubungi kami kembali nanti.") and NOT call the Gemini model.

3. **Database Session Management:** 
   - Ensure that the database queries inside the message handlers open and close sessions properly (using context managers or standard SQLAlchemy session practices) to avoid locking issues during long-polling.

# Output
Provide the updated code for `bot.py`. Also, briefly explain how the user can apply this exact same logic to `bot_cs.py` or a newly created `bot_retensi.py` simply by changing the `CURRENT_AGENT_ID` variable.

# Role & Context
Act as a Senior Backend Developer. Excellent job on updating `bot.py`. However, we caught one remaining leak: the `_notify_buyer` function (likely in `app.py` or wherever the webhook notification logic resides) still uses `os.getenv("TELEGRAM_BOT_TOKEN")`. 

# Objective
Refactor the Telegram notification logic in the webhook so it strictly fetches the token from the database instead of the `.env` file.

# Instructions for Claude

1. **Locate Notification Logic:** Find the `_notify_buyer` function (or equivalent) that sends the "Pembayaran berhasil" message to the user via `requests.post` to the Telegram API.
2. **Database Token Fetch:** 
   - Modify the function to query the `agent_configs` table for the `pulsa_agent` (since the Pulsa bot handles the transactions).
   - Extract the `telegram_token` from the query result.
3. **Failsafe:** If the `pulsa_agent` config is missing or its token is empty, gracefully handle the error (e.g., log it) and abort the notification so it doesn't crash the webhook response.
4. **Remove .env dependency:** Completely remove `os.getenv("TELEGRAM_BOT_TOKEN")` from this function.

# Output
Provide the corrected code snippet for the `_notify_buyer` function.

# Role & Context
Act as a Senior Frontend Developer. The "Add Agent" modal UI looks great, but there is a missing functionality in the Vanilla JS logic. Currently, the modal does not close when the user clicks the "Batal" (Cancel) button, nor does it close when the user clicks on the dark background overlay outside the modal.

# Objective
Update the JavaScript file (e.g., `app.js`) to include the proper event listeners to hide the modal.

# Instructions for Claude
1. **Cancel Button Logic:** Add a click event listener to the "Batal" button that adds the Tailwind `hidden` class back to the modal container.
2. **Backdrop Click Logic:** Add a click event listener to the modal container (the dark overlay) so that if the user clicks exactly on the overlay (and not inside the white modal content box), it also adds the `hidden` class to close the modal.
3. **Form Reset (Optional but recommended):** When closing the modal, it's best practice to clear the input fields (Agent ID, Name, Token) so it's fresh for the next time it's opened.

# Output
Provide the exact Vanilla JS code snippet that needs to be added or modified. Briefly explain where this snippet should be placed.

# Role & Context
Act as a Senior Backend Developer. We are upgrading the "Chat History" feature in our Flask Admin Panel. Currently, it likely loads all chats globally. We want to implement a Two-View system where the admin selects an Agent first, and then views the chats specific to that Agent.

# Objective
Refactor the database queries and API endpoints for chat histories to strictly filter and operate based on a provided `agent_id`.

# Instructions for Claude

1. **Update `db_service.py`:**
   - Modify the function that retrieves the list of users who have interacted with the bots (e.g., `get_chatted_users()` or similar). It must now accept an `agent_id` parameter and return only users who have a chat history with that specific `agent_id`.
   - Modify the function that retrieves the chat history for a specific user (e.g., `get_chat_history(telegram_id)`). It must now accept both `telegram_id` and `agent_id` to fetch only the conversation between that user and that specific agent.

2. **Update `app.py` (API Routes):**
   - Update the route fetching the user list to include the agent ID, for example: `GET /api/chats/users/<agent_id>`.
   - Update the route fetching the specific chat messages to include the agent ID, for example: `GET /api/chats/<agent_id>/<user_id>`.
   - **Crucial - Manual Reply:** Update the endpoint for sending manual replies (e.g., `POST /api/chats/reply` or similar). The JSON payload MUST now accept `agent_id`. Ensure the logic fetches the specific `telegram_token` for that `agent_id` from the database to send the Telegram message via `requests.post`.

# Output
Provide the exact code modifications for `db_service.py` and `app.py` to support these `agent_id` filters.

# Role & Context
Act as a Senior Frontend Developer. The backend API for the Chat History feature has been successfully updated to filter by `agent_id` (`/api/chats/users/<agent_id>`, `/api/chats/<agent_id>/<user_id>`, and manual reply POST). Now, we need to update the `#chats` UI to implement the "Two-View" system.

# Objective
Refactor the HTML and Vanilla JS for the Chat History section to require the admin to select an Agent first before viewing the WhatsApp-style chat interface.

# Instructions for Claude

1. **HTML Layout (Two-View System):**
   - **View 1 (Agent Selection):** Create a container inside `#chats` that displays a grid of agent cards (similar to the Agent Config view). 
   - **View 2 (Chat Interface):** Wrap the existing chat interface (sidebar with user list + chat room) in a container. Add a "⬅ Kembali ke Daftar Agent" button at the top of this view.
   - Use Tailwind's `hidden` class to toggle between View 1 and View 2. By default, View 1 should be visible and View 2 hidden.

2. **JavaScript Logic (`app.js`):**
   - **Load Agents:** When the `#chats` section is opened, fetch the list of agents from `/api/agents` and render the cards in View 1.
   - **Select Agent:** When an agent card is clicked:
     - Store the selected `agent_id` in a global/scope variable (e.g., `currentChatAgentId`).
     - Hide View 1 and show View 2.
     - Fetch the user list for the left sidebar using the new endpoint: `GET /api/chats/users/${currentChatAgentId}`.
   - **Back Button:** When clicked, hide View 2, show View 1, clear the `currentChatAgentId`, and clear the chat room UI.
   - **Load Specific Chat:** When clicking a user in the sidebar, fetch messages using `GET /api/chats/${currentChatAgentId}/${telegram_id}`.
   - **Manual Reply (Human Takeover):** Update the event listener for the chat input form. Ensure the JSON payload sent to the reply API includes `"agent_id": currentChatAgentId` alongside the message text and `telegram_id`.

# Output
Provide the exact HTML modifications (for `index.html` or equivalent) and the updated Vanilla JS logic for the chat module.

# Role & Context
Act as a Senior UI/UX Designer and Frontend Engineer. We are upgrading our Admin Panel's UI to look like a premium, modern SaaS application. We will strictly use existing tools (Tailwind CSS and Vanilla JS) to keep it lightweight. Do NOT change any backend API logic or existing JS functionality.

# Objective (Stage 1: Global Theme & Layout)
Refactor the global layout structure, color palette, and generic component styles (cards, buttons) in the `index.html` file to achieve a "Modern Fintech" look.

# Instructions for Claude

1. **Global Color Palette & Background:**
   - Change the main body background to a very soft gray (e.g., `bg-slate-50` or `bg-gray-50`).
   - Use a sleek, modern dark color for the Sidebar (e.g., `bg-slate-900`).

2. **Sidebar Modernization:**
   - Make the active menu item stand out elegantly (e.g., a soft `bg-indigo-600` or `bg-white/10` with rounded corners `rounded-lg`).
   - Add subtle hover effects (`hover:bg-slate-800`, `transition-colors`) for inactive menu items.

3. **Card & Container Styles (The "Floating" Effect):**
   - Locate the main content containers/cards (like the ones wrapping the forms, tables, and Agent Config).
   - Remove hard borders (`border`, `border-gray-200`).
   - Add soft shadows (`shadow-sm` or `shadow-md`).
   - Increase the border radius to make them friendlier (`rounded-xl` or `rounded-2xl`).
   - Ensure the card backgrounds are clean white (`bg-white`).

4. **Primary Buttons Modernization:**
   - Change primary action buttons (like "Simpan Perubahan", "Tambah Agent") to a modern Indigo or Emerald color (e.g., `bg-indigo-600 hover:bg-indigo-700`).
   - Make them slightly more pill-shaped (`rounded-lg` or `rounded-full` if appropriate) with a subtle shadow (`shadow-sm`, `hover:shadow-md`), and ensure a smooth `transition-all`.

5. **Top Navigation / Header:**
   - Ensure the header where the Superadmin profile is located looks clean, perhaps with a subtle bottom border or soft shadow, blending smoothly with the main background.

# Output
Provide the updated HTML structure (specifically focusing on the `<body>`, sidebar, header, and generic card/button classes). Explain briefly what Tailwind classes you changed to achieve this Modern SaaS look.

# Role & Context
Act as a Senior UI/UX Designer and Frontend Engineer. Stage 1 (Global Theme) was successfully implemented. Now we move to Stage 2. We will strictly use existing tools (Tailwind CSS and Vanilla JS) to keep it lightweight. Do NOT change any backend API logic.

# Objective (Stage 2: Dashboard, Tables & Icons)
Upgrade the visual hierarchy of the Dashboard statistics, Table aesthetics, and Navigation icons to match a premium SaaS application.

# Instructions for Claude

1. **Table Aesthetics (Data Grids):**
   - **Headers (`<thead>`):** Make the table headers more subtle. Use `bg-slate-50` or `bg-slate-100`, with text styled as `text-xs font-semibold text-slate-500 uppercase tracking-wider`.
   - **Rows (`<tbody> <tr>`):** Add a hover effect to rows (e.g., `hover:bg-slate-50 transition-colors`) so users can easily track the data across columns. Add a subtle bottom border `border-b border-slate-100` between rows.

2. **Modern Status Badges (Pills):**
   - Locate the status indicators in the tables (e.g., "success", "paid", "active", "pending", "failed").
   - Transform these plain text statuses into modern pill badges.
   - Example for Success: `<span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Success</span>`.
   - Apply appropriate color variants for other statuses (e.g., amber for pending, rose for failed).

3. **Dashboard Stat Cards Enrichment:**
   - Add a subtle background icon to the right side of the stat cards (using a large size like `w-12 h-12` and low opacity like `text-slate-200` or `opacity-10`) to break the empty space.
   - Add a dummy trend indicator below the main number (e.g., a small text like `<span class="text-emerald-500 text-sm font-medium">↑ 12%</span> <span class="text-slate-400 text-sm">dari bulan lalu</span>`).

4. **Navigation Icons Polish:**
   - Ensure all SVG icons in the Sidebar have a consistent and premium look (e.g., `w-5 h-5` with `stroke-width="1.5"` or `2`).
   - Add a subtle animation on the parent link hover (e.g., `group-hover:scale-110 transition-transform` on the SVG).

# Output
Provide the updated HTML structure (specifically focusing on a sample Table structure, the Dashboard stat cards, and the Badge classes). Explain briefly what Tailwind classes were used.

# Role & Context
Act as a Senior UI/UX Designer and Frontend Engineer. We want to switch our Admin Panel's color palette to a bright, modern "Fresh Ocean" theme (Cyan & Teal). We will strictly use Tailwind CSS classes to keep it lightweight. Do NOT change any backend API logic, structural divs, or JS functionality.

# Objective
Refactor the Sidebar background, active/hover states, and primary button colors in `index.html` to match the new bright theme.

# Instructions for Claude

1. **Sidebar Background:**
   - Find the main Sidebar container (currently likely `bg-slate-900` or similar dark color).
   - Replace it with a bright gradient: `bg-gradient-to-b from-cyan-500 to-teal-500`.
   - Ensure the text and icons inside the sidebar remain white (`text-white`).

2. **Sidebar Menu Items (Active & Hover):**
   - **Active Item:** Change the background of the currently active menu item to a transparent white glass effect: `bg-white/20`. Keep the text/icon white and fully opaque.
   - **Inactive Hover:** Change the hover state for inactive items to `hover:bg-white/10`. 

3. **Primary Action Buttons & Accents:**
   - Locate all primary buttons (e.g., "Simpan Perubahan", "Tambah Agent", "Tambah Produk").
   - Replace their current background colors (like `bg-indigo-600`) with Teal: `bg-teal-500 hover:bg-teal-600`.
   - If there are any text accents using the old color (e.g., `text-indigo-600`), update them to `text-teal-600`.

4. **Logo/Brand Name Area:**
   - Ensure the "BOT PULSA" title at the top of the sidebar looks crisp against the new cyan gradient (e.g., keep it `text-white` with `font-bold` and maybe add a subtle text shadow if needed, or just leave it as is if it looks good).

# Output
Provide the updated HTML structure (focusing specifically on the `<aside>` / sidebar classes and the `<button>` classes). Briefly explain which classes were swapped.

# Role & Context
Act as a Senior Backend Developer. We are migrating our Telegram bots from long-polling to a Centralized Webhook architecture via Flask. I have successfully set up Ngrok. My public base URL is `https://quail-squealing-stage.ngrok-free.dev`.

# Objective
Update `app.py` to receive incoming webhooks and automatically register this webhook URL with Telegram whenever an agent's config is saved in the Admin Panel.

# Instructions for Claude

1. **Webhook Receiver Route:** 
   - Create a new route `@app.route('/webhook/<agent_id>', methods=['POST'])`. 
   - For this initial step, just parse the incoming JSON from Telegram, `print()` it to the console (so we can verify the connection), and return `{"status": "ok"}`, 200. (We will add the Gemini AI logic later).

2. **Auto-Registration Helper:** 
   - Create a function `register_telegram_webhook(agent_id, bot_token)` that uses the `requests` library to call: 
     `https://api.telegram.org/bot<bot_token>/setWebhook?url=https://quail-squealing-stage.ngrok-free.dev/webhook/<agent_id>`
   - Add a brief print statement checking if the registration was successful.

3. **Trigger Registration:** 
   - Locate the existing API endpoint in `app.py` where the Admin Panel saves or updates an agent's configuration.
   - Immediately after saving the new `telegram_token` to the database, trigger the `register_telegram_webhook` function.

# Output
Provide the exact Python code modifications needed for `app.py`. Do NOT alter the frontend yet.

# Role & Context
Act as a Senior Backend Developer. Our Flask Webhook (`/webhook/<agent_id>`) is successfully receiving Telegram messages. Now we need to execute the final step: migrating the "AI Brain" into this webhook route so the bot actually processes the message and replies.

# Objective
Update the `/webhook/<agent_id>` route in `app.py` to process incoming messages using the Gemini API, send the reply back via Telegram API, and save the chat history, essentially porting the logic from the old polling bot.

# Instructions for Claude

1. **Extract Data:** Parse the incoming Telegram JSON payload to extract `user_id` (chat id), `full_name`, `username`, and `user_text`.
2. **Pre-checks:** 
   - Check if the agent is active (`is_agent_active`). If not, optionally send an offline message via Telegram API and return 200 OK.
   - Check if `is_user_in_manual_mode(user_id)` is true. If yes, return 200 OK immediately without calling the AI (to allow the admin to chat manually).
3. **AI Processing:**
   - Fetch the agent's config (prompt, temperature, model) and its specific `telegram_token` from the database.
   - Fetch the last 10 chat histories for context.
   - Construct the prompt and call the Gemini API (reusing the tool logic like `check_order_status` if needed).
4. **Send Reply:** 
   - Once Gemini generates the `bot_reply`, use the `requests` library to send a POST request to `https://api.telegram.org/bot<AGENT_TOKEN>/sendMessage` with the `chat_id` and `text`.
5. **Save History:** Save the conversation using `save_chat_history()`.
6. **Return 200:** Ensure the Flask route ultimately returns a 200 OK response so Telegram doesn't retry sending the same message.

# Output
Provide the completely updated code for the `/webhook/<agent_id>` route in `app.py`. Do not alter the frontend.

# Role & Context
Act as a Senior UI/UX Designer and Frontend Engineer. We are fine-tuning the UI of the "Agent Config" detail view in our Tailwind-based Admin Panel. We strictly use Tailwind CSS classes.

# Objective
Make the Agent Config edit form utilize the full available width of the main content area, removing the narrow container constraints, so long text (specifically the System Prompt) doesn't require unnecessary scrolling.

# Instructions for Claude

1. **Expand Form Container:**
   - Locate the HTML container/card wrapping the Agent Config edit form.
   - Remove any restrictive max-width classes (such as `max-w-2xl`, `max-w-3xl`, `max-w-4xl`, or fixed widths like `w-1/2`).
   - Add `w-full` so the card expands to fill the available space of the main container, while respecting the parent's padding.

2. **Optimize Textarea (System Prompt):**
   - Ensure the `<textarea>` for the System Prompt has `w-full` applied.
   - Increase its default `rows` attribute to a larger number (e.g., `rows="10"` or `rows="12"`) so it displays much more text vertically before needing a scrollbar.

3. **Layout Polish:**
   - Keep the grid layout for the inputs (Name, Provider, Temperature, Model) as they are, but since they will now be wider, ensure they look proportionate (e.g., `grid-cols-1 md:grid-cols-2 gap-6`).

# Output
Provide the updated HTML structure for the Agent Config detail view, focusing on the specific container and textarea classes.

# Role & Context
Act as a Senior Backend Developer. We are building a new RAG (Retrieval-Augmented Generation) Knowledge Base feature for our Flask admin panel using PostgreSQL. I have dropped the old conflicting tables.

# Objective (Stage 1: Database Models)
Create two new SQLAlchemy models in `models.py` to handle the RAG file metadata and their corresponding vector embeddings. Ensure strict relational integrity with CASCADE DELETE.

# Instructions for Claude

1. **Create `Document` Model (Table: `documents`):**
   - `id`: Primary Key (Integer)
   - `file_name`: String (e.g., "SOP.pdf")
   - `size`: Integer (file size in bytes or KB)
   - `upload_at`: DateTime (default: current UTC time)
   - `updated_at`: DateTime (default: current UTC time, onupdate: current UTC time)
   - `file_path`: String (the local physical path, e.g., `uploads/knowledge_base/...`)
   - **Relationship:** Establish a relationship to `RagDocument` with `cascade="all, delete-orphan"`.

2. **Create `RagDocument` Model (Table: `rag_documents`):**
   - `id`: Primary Key (Integer)
   - `document_id`: Foreign Key linking to `documents.id` (with `ondelete="CASCADE"`)
   - `chunk_text`: Text (to store the extracted paragraph/chunk from the document)
   - `embedding`: Use SQLAlchemy's `JSON`, `JSONB`, or `ARRAY(Float)` to store the vector embeddings (array of floats) generated by the AI model. (Assume standard PostgreSQL without pgvector for now, unless pgvector is already configured, then use `Vector`).

# Output
Provide the exact Python code to append/update in `models.py`. Keep it clean and follow standard SQLAlchemy conventions.

# Role & Context
Act as a Senior AI Backend Engineer. The `Document` and `RagDocument` models are ready in our Flask app. We now need the core RAG backend logic to process PDF uploads, extract text, chunk it, and generate vector embeddings using the Google Gemini API.

# Objective
Create a new Flask route `POST /api/knowledge-base/upload` in `app.py` that handles the entire pipeline (Upload -> Save -> Extract -> Chunk -> Embed -> DB Insert).

# Instructions for Claude

1. **Imports & Setup:**
   - Ensure you import `os`, `PyPDF2` (for PDF extraction), and `google.generativeai` as `genai` (assuming it's already configured in the app).
   - Ensure the upload directory exists dynamically: `os.makedirs('uploads/knowledge_base', exist_ok=True)`.

2. **Endpoint `POST /api/knowledge-base/upload`:**
   - Receive the file from `request.files['file']`. Validate that it is a PDF.
   - Save the file to the local directory `uploads/knowledge_base/`.
   - Create and commit the initial `Document` record (with file name, size, and file path) to get the `document_id`.

3. **Text Extraction & Chunking:**
   - Read the saved PDF using `PyPDF2`. Extract text from all pages.
   - Implement a simple chunking logic: Split the extracted text into chunks of roughly 1000 characters with a small overlap (e.g., 100 characters) to maintain context between paragraphs.

4. **Embedding Generation:**
   - Loop through the text chunks.
   - For each chunk, call the Gemini Embedding API (e.g., `genai.embed_content` using the model `models/text-embedding-004` or your currently configured embedding model).

5. **Save to Database:**
   - For each chunk and its resulting embedding vector, create a `RagDocument` record linking to the `document_id`.
   - Commit all records to the database.

6. **Error Handling:**
   - Wrap the logic in a `try-except` block. If extraction or embedding fails, execute a `db.session.rollback()` and remove the physical file if it was created.
   - Return a JSON response (`200 OK` on success, `500` or `400` on errors).

# Output
Provide only the Python code needed for `app.py` (the endpoint and any helper functions). Assume the database models are already imported. Keep the code clean and well-commented.

# Role & Context
Act as a Senior AI Backend Engineer. The upload and RAG extraction pipeline in `app.py` is working perfectly. We now need to prepare the REST API endpoints to support the Knowledge Base frontend UI. 

# Objective
Create two new Flask routes in `app.py`:
1. `GET /api/knowledge-base`: To fetch a list of all uploaded documents.
2. `DELETE /api/knowledge-base/<int:doc_id>`: To safely delete a document from the database and remove its physical file.

# Instructions for Claude

1. **GET Endpoint (`/api/knowledge-base`):**
   - Query all records from the `Document` model, ordered by `upload_at` descending.
   - Return a JSON array containing objects with: `id`, `file_name`, `size`, and `upload_at` (formatted as a readable string).

2. **DELETE Endpoint (`/api/knowledge-base/<int:doc_id>`):**
   - Fetch the `Document` by its `id`. If it doesn't exist, return a 404 JSON response.
   - Store the `file_path` in a variable.
   - Delete the document from the database using `db.session.delete(document)` and commit. (Rely on the existing SQLAlchemy cascade rule to automatically clear the associated `RagDocument` chunks).
   - Use `os.remove()` to delete the physical file from the local file system. Wrap this file deletion in a `try-except OSError` block to prevent the app from crashing if the physical file is already missing.
   - Return a 200 OK JSON response confirming deletion.

# Output
Provide only the Python code for these two specific endpoints to be appended in `app.py`. Do not modify existing routes. Keep it clean and well-commented.

# Role & Context
Act as a Senior Frontend Engineer. Our backend for the Knowledge Base (RAG) is fully complete. We are building the UI in our existing `index.html` using strictly **Tailwind CSS** for styling and **Vanilla JavaScript** for logic. The theme is "Fresh Ocean" (Cyan/Teal).

# Objective
Create the "Knowledge Base" section in the Admin Panel. It should feature a 2-column layout: a document list on the left and an upload form on the right. Write the necessary Vanilla JS to handle fetching, uploading, and deleting documents.

# Instructions for Claude

1. **HTML Structure (Tailwind CSS):**
   - Create a new section/container for "Knowledge Base" (assume it can be toggled via the sidebar menu).
   - Use a grid layout (`grid-cols-1 lg:grid-cols-2` with `gap-6`).
   - **Left Column (Document List):** A clean table or list view showing `file_name`, `size`, and `upload_at`. Include a red/rose "Delete" button (trash icon) for each row. Show an empty state message if no documents exist.
   - **Right Column (Upload Area):** A form with a file input (accepting `.pdf`). Style it nicely, perhaps like a dashed dropzone. Include an "Upload File" submit button (`bg-teal-500`).
   - **Loading State:** Add a hidden spinner or loading text in the upload area that will be shown during the embedding process (which takes a few seconds).

2. **Vanilla JavaScript Logic:**
   - **State Management:** Define variables to hold the DOM elements (upload form, file input, document table body, loading spinner).
   - **`fetchDocuments()`:** Fetch `GET /api/knowledge-base`. Iterate through the JSON response and dynamically generate the HTML rows for the table.
   - **`deleteDocument(id)`:** Triggered by the delete button. Ask for `confirm("Yakin ingin menghapus dokumen ini?")`. If yes, call `DELETE /api/knowledge-base/<id>`. On success, call `fetchDocuments()` to refresh the list.
   - **`uploadDocument(event)`:** Attach to the form's `onsubmit`. 
     - Prevent default submission.
     - Show the loading spinner and disable the upload button.
     - Use `FormData` to append the selected file.
     - Call `POST /api/knowledge-base/upload` using `fetch()`.
     - On success/error, alert the user, hide the spinner, re-enable the button, reset the form, and call `fetchDocuments()` to refresh the table.

3. **Integration:**
   - Ensure the new JS functions are neatly organized (e.g., inside a `const KnowledgeBase = { ... }` object or as clean standalone functions) so they don't clutter your existing Vanilla JS code.

# Output
Provide the HTML snippet for the 2-column UI and the exact Vanilla JS code block to append to the `<script>` section in `index.html`. Do not rewrite the entire file, just the new additions.

# Role & Context
Act as a Senior DevOps and Backend Engineer. We are preparing our Flask + RAG application for deployment using Docker. We are discarding physical file storage in favor of in-memory processing to avoid data loss on ephemeral cloud containers (like Render or Railway).

# Objective
1. Refactor the `POST /api/knowledge-base/upload` route in `app.py` to process uploaded PDFs entirely in-memory using `io.BytesIO`.
2. Create a production-ready `Dockerfile`.
3. Create a `.dockerignore` file.

# Instructions for Claude

1. **Refactor In-Memory PDF Processing (`app.py`)**:
   - Import `io`.
   - Update the upload endpoint: Instead of `file.save(...)`, read the file stream directly into memory (`pdf_stream = io.BytesIO(file.read())`) and pass it to `PyPDF2.PdfReader(pdf_stream)`.
   - Keep the chunking, embedding (Gemini API), and database insertion logic exactly the same.
   - Remove any `os.makedirs('uploads/...')` and `os.remove(...)` logic from the upload and delete endpoints.
   - For the `Document` model's `file_path` field during insert, just use a placeholder like `"in-memory"`.

2. **Create `Dockerfile`**:
   - Use a lightweight Python base image (e.g., `python:3.10-slim`).
   - Set the working directory to `/app`.
   - Copy `requirements.txt` and run `pip install --no-cache-dir -r requirements.txt`. (Remind me to add `gunicorn` to my requirements if it's not there).
   - Copy the rest of the application code.
   - Expose port `5000`.
   - Use `gunicorn` as the production WSGI server to run the Flask app. Command: `CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]`

3. **Create `.dockerignore`**:
   - Exclude `.git`, `__pycache__`, `venv`, `env`, `.env`, `session.db`, `uploads/`, `*.sqlite3`, `.vscode/`, and any other unnecessary local development files.

# Output
Provide:
1. The updated python code for the `upload` and `delete` routes in `app.py`.
2. The exact contents for the new `Dockerfile`.
3. The exact contents for the new `.dockerignore`.

# Role & Context
Act as a Senior Python Backend Developer. We are upgrading our Flask + Telegram + Gemini (RAG) bot to support 2-way image processing (Multimodal). 
The bot must be able to:
1. Receive images from users, download them from Telegram, and pass them to the Gemini 1.5 model.
2. Send predefined local images to the user based on the LLM's decision using a regex tagging system in the output.

# Instructions

### 1. Handling User Incoming Images (Webhook in `app.py` or `bot.py`)
- Update the Telegram webhook route.
- If the incoming message contains a `photo` (an array of photo sizes), grab the highest resolution photo (the last element).
- Extract the `file_id`.
- Use the Telegram API `getFile` endpoint to get the `file_path`.
- Download the image bytes using `https://api.telegram.org/file/bot<TOKEN>/<file_path>`.
- Pass these image bytes (along with any text `caption` or prompt) to the AI Agent.

### 2. Upgrading the AI Agent to Multimodal (`agent.py`)
- Import `PIL.Image` and `io`.
- Modify the AI generation function to accept an optional `image_bytes` parameter.
- If `image_bytes` is provided, convert it to a PIL Image using `Image.open(io.BytesIO(image_bytes))` and pass both the text prompt and the image object to the Gemini model.
- **CRITICAL - Update the System Prompt:** Inject this exact instruction into the Gemini System Prompt:
  """
  Kamu memiliki akses ke gambar lokal yang bisa dikirimkan ke pengguna. Jika relevan, tambahkan tag eksak di akhir jawabanmu:
  1. Jika pengguna menanyakan daftar harga, pricelist, harga token, atau harga paket data, tambahkan tag: [GAMBAR: daftar_harga.jpg]
  2. Jika pengguna menanyakan promo, diskon, atau penawaran spesial, tambahkan tag: [GAMBAR: promo_pulsa.jpg]
  Jangan pernah mengarang nama gambar selain dua nama di atas.
  """

### 3. Parsing and Sending Images (The "Postman" Logic)
- Before sending the final AI response back to Telegram via the `sendMessage` function, parse the text.
- Use RegEx (e.g., `import re`) to find the pattern `\[GAMBAR:\s*(.+?)\]`.
- If found:
  1. Extract the filename.
  2. Remove the tag entirely from the text string so the user doesn't see it.
  3. Send the cleaned text to the user using Telegram's `sendMessage`.
  4. Send the physical image from the local directory `static/bot_images/<filename>` using Telegram's `sendPhoto` endpoint with `multipart/form-data`.
- If not found, simply send the text normally.

# Output Requirement
Provide the completely updated python code blocks for:
1. The Telegram webhook/receiving logic.
2. The sending function containing the Regex parser and `sendPhoto` logic.
3. The AI Agent function supporting multimodal inputs and the updated system prompt.
Remind me to add any new dependencies (like Pillow or requests) to my requirements.