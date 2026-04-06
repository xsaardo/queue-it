# Setting Up QueueIt with Your Own Spotify App

Spotify restricts apps in development mode to 25 users. To use QueueIt beyond that limit, you need to create your own Spotify app and plug in your own client ID. This takes about 5 minutes.

---

## Step 1 — Clone the repo

```bash
git clone https://github.com/your-username/queue-it.git
cd queue-it
```

No build step required. This is a plain browser extension.

---

## Step 2 — Find your extension ID

Load the extension into Chrome so you can get its ID:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** and select the `queue-it/` folder
4. Copy the extension ID shown under the extension name — it looks like `abcdefghijklmnopabcdefghijklmnop`

> **Tip:** The `key` field in `manifest.json` locks the extension ID so it stays the same every time you load it, on any machine. Leave that field as-is.

---

## Step 3 — Create a Spotify app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and log in
2. Click **Create app**
3. Fill in the form:
   - **App name**: anything (e.g. `QueueIt`)
   - **App description**: anything
   - **Redirect URI**: `https://YOUR_EXTENSION_ID.chromiumapp.org/`  
     Replace `YOUR_EXTENSION_ID` with the ID you copied in Step 2
   - **Which API/SDKs are you planning to use?**: check **Web API**
4. Agree to the terms and click **Save**
5. On the app page, click **Settings** and copy your **Client ID**

---

## Step 4 — Update the client ID

Open `background.js` and replace the client ID on line 3:

```js
const CLIENT_ID = 'your_client_id_here';
```

---

## Step 5 — Reload the extension

Back in `chrome://extensions/`, click the refresh icon on the QueueIt card. The extension will now authenticate through your own Spotify app.

---

## Notes

- **Development mode limit**: By default, Spotify apps are in development mode and limited to 25 users. If you're sharing this with more people, each user needs to follow these steps with their own Spotify account — or you can apply for a [Spotify quota extension](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
- **Scopes**: The extension only requests `user-modify-playback-state` — just enough to add songs to your queue or playlist. It does not read your listening history or profile data.
- **Token storage**: Tokens are stored locally in `chrome.storage.local` and never sent anywhere other than Spotify's API.
