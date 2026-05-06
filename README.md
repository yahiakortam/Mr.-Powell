# Mr. Powell Bot

A Discord bot for the **Made New** server, themed around a strict, funny elementary music teacher named Mr. Powell.

---

## Commands

| Command | Description |
|---|---|
| `/findthebell` | Guessing game — find where Mr. Powell hid the bell |
| `/discipline @user` | Disciplines a selected user with a random message |
| `/welcome` | Posts the official class welcome message |
| `/level [@user]` | Gives a user a random music-class level |
| `/banaga` | You know what you did |

The bot also automatically sends a welcome message when a new member joins the server.

---

## Discord Setup

### Step 1 — Create a Discord Application

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** and give it a name (e.g. "Mr. Powell")
3. Go to the **Bot** tab on the left sidebar
4. Click **Add Bot** (if prompted)
5. Under the bot's username, click **Reset Token** and copy the token — you will need this later

### Step 2 — Enable Server Members Intent

Still on the **Bot** tab:

1. Scroll down to **Privileged Gateway Intents**
2. Turn on **Server Members Intent**
3. Click **Save Changes**

> This is required for the bot to send automatic welcome messages when new members join. Without it, the `guildMemberAdd` event will not fire and welcome messages will not work.

### Step 3 — Get the Welcome Channel ID

1. Open Discord and go to **User Settings** → **Advanced**
2. Turn on **Developer Mode**
3. Go to your server, right-click the channel where welcome messages should appear
4. Click **Copy Channel ID**

You will paste this into Render's environment variables in the next section.

### Step 4 — Invite the Bot to Your Server

1. In the Discord Developer Portal, go to your application
2. Click **OAuth2** in the left sidebar, then **URL Generator**
3. Under **Scopes**, check:
   - `bot`
   - `applications.commands`
4. Under **Bot Permissions**, check:
   - `Send Messages`
   - `Use Slash Commands`
   - `Read Message History`
5. Copy the generated URL at the bottom, open it in your browser, and authorize the bot to your server

---

## Deploying to Render

Render hosts the bot so it stays online without running on your laptop.

### Step 1 — Push Your Code to GitHub

Make sure your project is pushed to GitHub. The `.env` file should **not** be included — it is blocked by `.gitignore`. Only push:

- `index.js`
- `package.json`
- `.env.example`
- `.gitignore`
- `README.md`

### Step 2 — Create a Render Account

Go to [https://render.com](https://render.com) and sign up for a free account.

### Step 3 — Create a New Web Service

1. From your Render dashboard, click **New** → **Web Service**
2. Click **Connect a repository** and connect your GitHub account
3. Select the `Mr.-Powell` repository

### Step 4 — Configure the Service

Fill in the following settings:

| Setting | Value |
|---|---|
| **Name** | mr-powell-bot |
| **Environment** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |

Leave everything else as the default.

### Step 5 — Add Environment Variables

Before deploying, click **Advanced** and add the following environment variables:

| Key | Value |
|---|---|
| `TOKEN` | Your real Discord bot token |
| `WELCOME_CHANNEL_ID` | Your real welcome channel ID |

> Do not put your real token anywhere in your code or on GitHub. Only add it here in Render's environment variable settings.

### Step 6 — Deploy

Click **Create Web Service**. Render will pull your code from GitHub, run `npm install`, and start the bot with `npm start`.

Watch the deploy log. When you see this, the bot is online:

```
Mr. Powell has entered the music room as Mr. Powell#1234.
Registering slash commands globally...
Slash commands registered. Class is now in session.
Web server listening on port 10000.
```

### Step 7 — Keep the Bot Awake (Important)

Render's free plan puts services to sleep after 15 minutes of inactivity. To prevent this, set up a free uptime pinger.

**Option A — UptimeRobot (recommended)**

1. Go to [https://uptimerobot.com](https://uptimerobot.com) and create a free account
2. Click **Add New Monitor**
3. Set type to **HTTP(s)**
4. Set the URL to your Render service URL:
   ```
   https://your-service-name.onrender.com/
   ```
5. Set the check interval to **5 minutes**
6. Save the monitor

**Option B — cron-job.org**

1. Go to [https://cron-job.org](https://cron-job.org) and create a free account
2. Click **Create cronjob**
3. Set the URL to your Render service URL:
   ```
   https://your-service-name.onrender.com/
   ```
4. Set the schedule to every **5–10 minutes**
5. Save the job

The bot has a health check endpoint at `/` that responds with `Mr. Powell is awake.` — this is what the pinger hits to keep the service running.

---

## File Structure

```
MrPowellBot/
├── index.js         # Main bot file — commands, events, and web server
├── package.json     # Project dependencies and start script
├── .env             # Your secret tokens — never commit this file
├── .env.example     # Template showing which variables are required
├── .gitignore       # Keeps .env and node_modules off GitHub
└── README.md        # This file
```

---

## Troubleshooting

**Bot token is missing / bot won't start**

Check that `TOKEN` is set in Render's environment variables. Go to your Render service → **Environment** tab and verify the value is there. If you update it, redeploy the service.

**Slash commands do not show up in Discord**

Global slash commands can take up to one hour to appear after the first deployment. This is a Discord limitation. Check the Render logs to confirm you see `Slash commands registered.` — if you do, just wait.

**Welcome messages are not sending**

Two things to check:
1. `WELCOME_CHANNEL_ID` is set correctly in Render's environment variables
2. **Server Members Intent** is enabled in the Discord Developer Portal → Your App → Bot → Privileged Gateway Intents

**Bot shows as offline after deployment**

Check the Render logs for any error. Common causes:
- `TOKEN` is wrong or missing in environment variables
- `npm install` failed — check the build log for errors
- The service crashed on startup — look for a red error line in the logs

**Render logs show dependency errors**

Make sure `package.json` includes all three dependencies:

```json
"dependencies": {
  "discord.js": "^14.14.1",
  "dotenv": "^16.4.5",
  "express": "^4.19.2"
}
```

Re-deploy after fixing.

**Bot keeps going to sleep even with a pinger**

Make sure the pinger is hitting the correct URL and is set to every 5 minutes or less. Check UptimeRobot or cron-job.org to confirm pings are going out successfully. Render shows incoming requests in the logs — you should see entries every few minutes.

**.env was accidentally pushed to GitHub**

1. Delete the `.env` file from GitHub immediately by removing it from the repo:
   ```bash
   git rm --cached .env
   git commit -m "Remove .env from tracking"
   git push
   ```
2. Go to the Discord Developer Portal and **reset your bot token** — the old one is now compromised
3. Update the new token in Render's environment variables

---

## Final Checklist

Before considering the deployment complete, confirm each of the following:

- [ ] `package.json` has `"start": "node index.js"` in scripts
- [ ] `.gitignore` includes `.env` and `node_modules`
- [ ] `.env.example` exists with placeholder values
- [ ] No real token or channel ID is anywhere in the code
- [ ] Project is pushed to GitHub
- [ ] Render environment variables are set (`TOKEN` and `WELCOME_CHANNEL_ID`)
- [ ] Bot has been invited to the Discord server
- [ ] Server Members Intent is enabled in the Discord Developer Portal
- [ ] Render logs show `Mr. Powell has entered the music room`
- [ ] Render logs show `Slash commands registered`
- [ ] UptimeRobot or cron-job.org is pinging the service every 5 minutes

---

## Adding Real XP and Level Tracking Later

The `/level` command currently assigns random levels. The code is structured so you can add real tracking without rewriting anything:

1. Install a database package (e.g. `better-sqlite3` for a simple local database)
2. In `handleLevel()`, replace the `Math.random()` pick with a lookup using `targetUser.id`
3. Add XP by listening to message events and updating the database per user

The level titles and numbers in the `levels` array are already in order and ready to use.
