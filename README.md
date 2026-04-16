# Minigame — Deployment Guide

## Project structure

```
insuresim/
├── server.js          ← Node.js backend (DeepSeek API proxy)
├── package.json
├── .env.example       ← Copy to .env, add your API key
├── .gitignore
└── public/
    └── index.html     ← Frontend
```

---

## Step 1 — Get a DeepSeek API key

1. Go to https://platform.deepseek.com
2. Sign up → API Keys → Create Key
3. Copy the key (starts with `sk-...`)

DeepSeek is accessible from mainland China.

---

## Step 2 — Run locally first

```bash
cd insuresim
cp .env.example .env
# Edit .env — paste your DeepSeek API key

npm install
npm start
# Open http://localhost:3000
```

---

## Step 3 — Deploy to Railway (5 min, free tier)

### Push to GitHub
```bash
git init && git add . && git commit -m "init"
# Create repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/insuresim.git
git push -u origin main
```

### Deploy
1. railway.app → New Project → Deploy from GitHub repo
2. Select your repo — Railway auto-detects Node.js
3. Variables tab → add: `DEEPSEEK_API_KEY` = your key
4. Get your public URL instantly

---

## How multiple sessions work

The server is **completely stateless**. Conversation history lives in each browser tab's memory and is sent with every request. Two people using the app simultaneously = two independent streams. No interference, no shared state. Scales automatically.

---

## Security checklist

- ✅ API key in environment variable only — never in code
- ✅ `.env` excluded from git via `.gitignore`
- ✅ All AI calls go through the server, never from the browser
- ✅ Rate limiting: 60 req/min per IP
- ✅ Input sanitised before API call
- ✅ Errors logged server-side, generic messages returned to client
- ✅ `max_tokens: 300` caps cost per turn

---

## Cost estimate

DeepSeek-V3 is significantly cheaper than most alternatives. A full 3-stage session costs roughly $0.0005–0.001. A demo for 100 people costs under $0.10.
