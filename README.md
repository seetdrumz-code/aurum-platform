# ◈ AURUM — Crypto Investment Platform

A full-stack, real-time crypto investment platform built with React, Firebase, and deployed to Netlify.

---

## ✨ Features

| Feature | Tech |
|---|---|
| Real-time prices | Binance WebSocket + CoinGecko fallback |
| Authentication | Firebase Auth (Email + Google OAuth) |
| Portfolio & Alerts | Firestore real-time sync |
| Trade history | Firestore with CSV export |
| AI Advisor | Claude API (Anthropic) |
| Fear & Greed Index | alternative.me API |
| Sound alerts | Tone.js |
| Financial math | MathJS (Sharpe, volatility, drawdown) |
| Correlation matrix | Lodash |
| Hosting | Netlify (CDN + SPA routing) |

---

## 🚀 Deploy in 15 Minutes

### Step 1 — Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/aurum-platform.git
cd aurum-platform
npm install
```

---

### Step 2 — Create Firebase Project

1. Go to **[console.firebase.google.com](https://console.firebase.google.com)**
2. Click **"Add project"** → name it `aurum-platform` → Continue
3. Disable Google Analytics (optional) → **Create project**

#### Enable Authentication
1. Left sidebar → **Build → Authentication → Get started**
2. **Sign-in method** tab → Enable **Email/Password**
3. Enable **Google** → add your support email → Save

#### Enable Firestore
1. Left sidebar → **Build → Firestore Database → Create database**
2. Choose **Start in production mode** → pick a region → Done
3. Go to **Rules** tab and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /{subcollection=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
    match /portfolios/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
4. Click **Publish**

#### Get Your Config Keys
1. Left sidebar → **Project Settings** (gear icon) → **General**
2. Scroll to **"Your apps"** → click **</>** (Web)
3. Register app as `aurum-web` → **Register app**
4. Copy the `firebaseConfig` object — you need these values for `.env`

---

### Step 3 — Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in your Firebase values:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=aurum-platform.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=aurum-platform
VITE_FIREBASE_STORAGE_BUCKET=aurum-platform.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
```

---

### Step 4 — Test Locally

```bash
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** — you should see the login screen.

---

### Step 5 — Deploy to Netlify

#### Option A: Netlify CLI (fastest)

```bash
npm install -g netlify-cli
netlify login
netlify init
# Choose: "Create & configure a new site"
# Build command: npm run build
# Publish dir:   dist
netlify env:set VITE_FIREBASE_API_KEY "your-key"
netlify env:set VITE_FIREBASE_AUTH_DOMAIN "your-domain"
netlify env:set VITE_FIREBASE_PROJECT_ID "your-project"
netlify env:set VITE_FIREBASE_STORAGE_BUCKET "your-bucket"
netlify env:set VITE_FIREBASE_MESSAGING_SENDER_ID "your-sender-id"
netlify env:set VITE_FIREBASE_APP_ID "your-app-id"
netlify deploy --prod
```

#### Option B: GitHub → Netlify (recommended for CI/CD)

1. Push to GitHub:
```bash
git add .
git commit -m "initial commit"
git push origin main
```

2. Go to **[app.netlify.com](https://app.netlify.com)** → **Add new site → Import from Git**
3. Connect GitHub → select your repo
4. Build settings (auto-detected from `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Click **"Environment variables"** → add all 6 `VITE_FIREBASE_*` vars
6. Click **Deploy site** 🚀

---

### Step 6 — Add Authorized Domain in Firebase

After deploying, add your Netlify URL to Firebase:

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Click **Add domain** → paste `your-site.netlify.app`
3. If you have a custom domain, add that too

---

## 📁 Project Structure

```
aurum-platform/
├── index.html                 # Entry HTML with splash screen
├── netlify.toml               # Netlify build + redirect config
├── vite.config.js             # Vite bundler config
├── package.json
├── .env.example               # Copy to .env and fill in values
└── src/
    ├── main.jsx               # React root + global CSS
    ├── AppRouter.jsx          # Auth gating + routing
    ├── Platform.jsx           # Full 11-page platform (~2800 lines)
    ├── firebase.js            # Firebase init + all Firestore helpers
    ├── context/
    │   └── AuthContext.jsx    # Auth state + sign in/up/out/google
    └── components/
        └── AuthScreen.jsx     # Login / Register / Forgot Password UI
```

---

## 🛠 Local Development

```bash
npm run dev      # Start dev server (localhost:5173)
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
```

---

## 🔒 Security Notes

- Never commit your `.env` file (it's in `.gitignore`)
- Firestore rules restrict each user to only their own data
- All env vars prefixed `VITE_` are public (bundled into JS) — this is fine for Firebase web config
- For the Claude API key (AI Advisor), consider a Netlify serverless function proxy in production

---

## 📦 Dependencies

| Package | Use |
|---|---|
| `firebase` | Auth + Firestore |
| `recharts` | All charts |
| `tone` | Price alert sounds |
| `papaparse` | CSV export |
| `lodash` | Correlation matrix |
| `mathjs` | Sharpe ratio, volatility |
| `react-router-dom` | Client-side routing |
| `date-fns` | Date formatting |
