Blink — Super simple setup (for humans + golden retrievers)

1) One-time installs (do this first)
   A. Install Node LTS: go to https://nodejs.org and install (choose Windows installer).
   B. Open PowerShell (press Windows key, type PowerShell, press Enter).

2) Prepare files
   A. Make a folder named Blink on your Desktop (or Downloads).
   B. Put these files into that folder:
      - package.json
      - App.js
      - firebase.config.js.template  (we will edit this next)
      - firestore.rules
      - functions.index.js  (optional)

3) Firebase (copy-paste only)
   A. Open https://console.firebase.google.com
   B. Create a new project — name it "Blink" (or whatever).
   C. Click Add App -> Web App -> Register App.
   D. Firebase shows a config object (the code with apiKey, etc). COPY that object.
   E. In your Blink folder: rename firebase.config.js.template => firebase.config.js
   F. Open firebase.config.js in Sublime, paste the object into the file replacing the placeholders.
      (Make sure it looks like: export const firebaseConfig = { apiKey: "...", authDomain: "...", ... };

4) Firebase quick toggles (one click)
   A. In Firebase Console -> Authentication -> Sign-in method -> enable "Anonymous".
   B. In Firebase Console -> Firestore Database -> Create database -> Start in production mode.
   C. (Optional but recommended) Enable Firestore TTL on field "expiresAt".

5) Run the app (3 commands)
   A. Open PowerShell.
   B. Type (example path — change to your folder):
      cd "%USERPROFILE%\Desktop\Blink"
   C. Run:
      npm install
      npm start
   D. A browser window opens (Expo). Install Expo Go on your phone (App Store / Play Store).
   E. Scan the QR code from Expo with your phone (Expo Go app). App opens.

6) Test with 2 devices
   - On device A: tap Show My Code -> QR appears.
   - On device B: tap Scan a Code -> scan QR -> chat opens.
   - Use Send to send messages. Use End Chat to delete session.

If any error appears, copy the exact error text and paste it here. I'll fix it step by step.
