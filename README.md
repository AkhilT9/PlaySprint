# FacePay: pay with a glance, not a PIN

FacePay replaces the UPI PIN with **on-device face verification and a liveness check**.
Look at your phone, turn your head slightly (left or right, picked at random), and you've paid.

> Hackathon prototype. It uses a demo wallet (₹10,000 for each new user), with no real money and no real bank or NPCI connection.

## Features

| | |
|---|---|
| 🙂 **Pay with Face** | Face-only payments up to ₹2,000. No PIN. |
| 🔐 **Step-up security** | Above ₹2,000, you need your face **and** the backup PIN. |
| 🛡️ **Anti-spoof liveness** | The server picks a random head-turn direction for each payment. A printed photo can't pass. |
| 🔁 **Face-swap detection** | Face samples from before and after the challenge must belong to the same person. |
| 🔢 **PIN fallback** | 3 failed face matches: the app falls back to the PIN. 5 wrong PINs lock the account for 5 minutes. |
| 👥 **One face, one account** | The same face can't be enrolled on two accounts. |
| 💰 **Check balance with Face** | Replaces "enter UPI PIN to check balance". |
| ⌗ **Scan & Pay** | Scans standard `upi://pay?pa=…` QR codes. |
| 🏪 **Merchant face terminal** | Like "Smile to Pay": the customer carries nothing. The terminal finds them among all users (1:N) and they confirm with the last 4 digits of their phone. |
| 🔒 **Privacy** | Face AI runs in the browser. Only a 128-number face signature is sent, never a photo. |

## Live demo (GitHub Pages)

**https://akhilt9.github.io/PlaySprint/**

Every push to `main` rebuilds the site with GitHub Actions (`.github/workflows/deploy.yml`).
The Pages build runs in *standalone mode*: the API runs inside the browser and data is stored in
that browser only (open the merchant terminal in another tab of the same browser).

## Deploy with a real server (Render, free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/AkhilT9/PlaySprint)

Render gives you an `https://….onrender.com` link, so the camera works on any phone.
Free tier notes: the app sleeps after 15 min idle (first load then takes ~50 s), and demo data resets on restart.

## Run it (2 commands)

```bash
npm install
npm run dev
```

Open **http://localhost:5173** on a laptop with a webcam.

### On your phone (best for the demo)

The browser only allows camera access over HTTPS, so use one of these:

**Option 1: same Wi-Fi**
```bash
npm run dev:phone
```
Open `https://<your-laptop-ip>:5173` on the phone and accept the certificate warning.

**Option 2: public URL**
```bash
npm run build
npm start                                          # serves app + API on :3000
npx cloudflared tunnel --url http://localhost:3000  # gives you an https:// link
```

### Reset demo data
```bash
npm run reset   # then restart the server
```

## Demo script (about 3 minutes)

1. **The problem:** "Every UPI payment means typing a 4–6 digit PIN, often in public where people can watch."
2. **Sign up** on a phone: name, number, backup PIN, then the face scan (a small head turn).
3. **Pay ₹250 to Rahul.** Tap Pay, look, do the challenge, paid. Point out the receipt: *Verified by Face · 99% match*.
4. **Pay ₹3,000.** Face, then PIN, to show the step-up security.
5. **Spoof attempt:** hold up a printed photo. It never passes liveness. Then have a teammate try: "Face didn't match", and after 3 tries it falls back to the PIN.
6. **Merchant terminal** (menu → Merchant terminal, on a laptop): enter ₹150, the customer looks at the camera, gets recognised, confirms the last 4 phone digits, paid. "No phone needed."

Demo contacts: `rahul@facepay`, `priya@facepay`, `aman@facepay`, `campuscafe@facepay`.

## How it works

```
 Phone (browser)                                   FacePay server
 ───────────────                                   ──────────────
 camera → TinyFaceDetector → 68 landmarks
        → liveness (head turn vs. your own straight pose)
        → 128-d FaceNet embedding ×3  ──────────►  /pay/intent issues a random challenge
                                                   /pay/confirm checks:
                                                     ✓ challenge matches the intent
                                                     ✓ all samples are the same face (< 0.5)
                                                     ✓ distance to enrolled template ≤ 0.5
                                                     ✓ amount > ₹2,000 → PIN required too
                                                   ledger transfer → receipt
```

* **Frontend:** React and Vite, `@vladmandic/face-api` (TensorFlow.js, WebGL), `jsqr`, `qrcode`
* **Backend:** Node and Express, a JSON-file ledger, scrypt-hashed PINs, HMAC-signed session tokens
* **Matching:** Euclidean distance on 128-d embeddings. 1:1 threshold is 0.5. 1:N (terminal) threshold is 0.45, and the best match must beat the runner-up by 0.06.

## Path to production

* NPCI allows on-device biometric (fingerprint or face) authentication for UPI as an alternative to the PIN. A real launch would add FacePay to a UPI app (TPAP) through a partner bank / PSP SDK.
* Swap browser liveness for certified passive liveness (ISO 30107-3 PAD) and store templates in the phone's secure hardware (Android Keystore / Secure Enclave).
* Move the ledger to Postgres, add device binding, rate limiting and fraud-risk scoring.
