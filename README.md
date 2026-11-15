# IronLog — personal workout tracker

A Strong-style gym tracker with **unlimited templates**. It's a web app (PWA) that you add to your iPhone's
Home Screen: it opens full-screen with no Safari bar, works offline, and keeps all data on your phone.
You don't need a Mac or an Apple developer account.

## Files
| File | What it is |
|---|---|
| `index.html` | Page shell |
| `app.js` | All app logic (templates, workouts, history, stats) |
| `exercises.js` | Built-in exercise library — add your own lines here |
| `styles.css` | Look & feel (clean light iOS style) |
| `sw.js` | Offline support. **Bump `VERSION` after every change** |
| `manifest.json`, `icons/` | Home-screen name and icon |

## 1. Test on your PC
```
cd C:\Users\basel\OneDrive\Desktop\gym-tracker
python dev-server.py
```
Open http://localhost:8080 in Chrome. Press F12, then Ctrl+Shift+M, and pick an iPhone size.

## 2. Quick test on your iPhone (same Wi-Fi, temporary)
1. Run the server above, then find your PC's IP with `ipconfig` (IPv4 Address, e.g. 192.168.1.23).
2. On the iPhone, open Safari and go to `http://192.168.1.23:8080`. Allow Python through Windows Firewall if it asks.
3. This is only for trying it out. Offline mode needs HTTPS, and data saved at this address
   won't carry over to the real address in step 3.

## 3. Install it on your iPhone for real (free, permanent)
Host the folder on a free HTTPS site. The easiest is **GitHub Pages**:
1. Create a GitHub repo (e.g. `ironlog`) and upload every file in this folder (keep the `icons` folder).
2. In the repo, go to Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
3. After about 1 minute it's live at `https://<your-username>.github.io/ironlog/`.
4. On the iPhone, open that link **in Safari**, tap Share → **Add to Home Screen** → Add.
5. Launch it from the Home Screen icon (not from Safari). Your data lives inside the Home Screen app.

Alternative: drag the folder onto https://app.netlify.com/drop.

## Updating the app later
Edit the files, change `VERSION` in `sw.js` (e.g. `ironlog-v2`), and upload again.
Open the app on your phone twice: the first launch downloads the update, the second shows it.

## Back up your data
Settings → **Back up data (JSON)** → save to iCloud Drive / Files. Restore it with **Restore from backup**.
Deleting the Home Screen app deletes its data, so back up first.

## Known limits vs a native app
- The rest timer beeps only while the app is open on screen. iOS won't let web apps sound alarms in the background.
  The timer keeps correct time when you come back.
- iPhones don't support vibration for web apps.
- No Apple Watch or Apple Health integration.
