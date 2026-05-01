# Zee

A personal, local-first AI chat interface built for Termux on Android.

## Setup Instructions (Termux)

1. **Install Prerequisites**:
   Ensure you have Node.js and tmux installed.
   ```bash
   pkg install nodejs tmux
   ```

2. **Copy Files**:
   Copy this entire `zee-app` folder to your Termux home directory (`~/zee-app`).

3. **Install Dependencies**:
   ```bash
   cd ~/zee-app
   npm install
   ```

4. **Configure Environment**:
   Copy `.env.example` to `.env` and fill in the values:
   ```bash
   cp .env.example .env
   nano .env
   ```
   - Ensure `OWNER_EMAIL` matches your email.
   - Set a secure `SESSION_SECRET` (generate one with `openssl rand -hex 32`).
   - If you want magic links emailed, set `RESEND_API_KEY`. Otherwise, leave blank to copy the link from the logs.
   - Verify `LLAMA_BASE_URL` and `LLAMA_API_KEY` are correct for your local llama.cpp instance.

5. **Start the App**:
   ```bash
   chmod +x start.sh
   ./start.sh
   ```
   The app will run in a detached tmux session on port 3000.

6. **View Logs (if not using Resend for magic links)**:
   ```bash
   cat ~/zee-app.log
   ```

## Cloudflare Tunnel Reroute

Since the app proxies requests to `llama.cpp`, you need to expose this Node app instead of `llama.cpp` directly.

1. Go to **Cloudflare One** → **Networks** → **Connectors** → **phoneapi** (or your tunnel name).
2. Go to **Published application routes**.
3. Edit the existing `api.projekts.pk` route.
4. Change the **Service URL** from `localhost:8080` to `localhost:3000`.
5. Save the configuration.

Now, `https://api.projekts.pk` will serve the Zee app.
