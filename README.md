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

## Setup Instructions

### Step 1 — Create a Discord Application

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** and give it a name (e.g. "Mr. Powell")
3. Go to the **Bot** tab on the left sidebar
4. Click **Add Bot** (if prompted)
5. Under the bot's username, click **Reset Token** and copy the token — you will need this in a moment

### Step 2 — Enable Server Members Intent

Still on the **Bot** tab:

1. Scroll down to **Privileged Gateway Intents**
2. Turn on **Server Members Intent**
3. Click **Save Changes**

> This is required for the bot to detect when new members join and send automatic welcome messages. Without it, the `guildMemberAdd` event will not fire.

### Step 3 — Set Up Your .env File

In the project folder, create a file named `.env` (copy from `.env.example`):

```
TOKEN=your_bot_token_here
WELCOME_CHANNEL_ID=your_welcome_channel_id_here
```

Paste the bot token you copied in Step 1 after `TOKEN=`.

### Step 4 — Get the Welcome Channel ID

To get the channel ID:

1. Open Discord and go to **User Settings** (the gear icon near your username)
2. Go to **Advanced** and turn on **Developer Mode**
3. Close settings and go to your server
4. Right-click the channel where you want welcome messages to appear
5. Click **Copy Channel ID**
6. Paste it into your `.env` file after `WELCOME_CHANNEL_ID=`

### Step 5 — Invite the Bot to Your Server

1. In the Discord Developer Portal, go to your application
2. Click **OAuth2** in the left sidebar, then **URL Generator**
3. Under **Scopes**, check:
   - `bot`
   - `applications.commands`
4. Under **Bot Permissions**, check:
   - `Send Messages`
   - `Use Slash Commands`
   - `Read Message History`
5. Copy the generated URL at the bottom and open it in your browser
6. Select your server and click **Authorize**

### Step 6 — Install Dependencies and Run

In your terminal, navigate to the project folder and run:

```bash
npm install
```

Then start the bot:

```bash
node index.js
```

You should see:

```
Mr. Powell has entered the music room as Mr. Powell#1234.
Registering slash commands globally...
Slash commands registered. Class is now in session.
```

> **Note:** Global slash commands can take up to one hour to appear in Discord after the first run. This is a Discord limitation — the commands are registered, they just take time to propagate.

---

## File Structure

```
MrPowellBot/
├── index.js         # Main bot file — all commands and events
├── package.json     # Project dependencies
├── .env             # Your secret tokens (never share or commit this)
├── .env.example     # Template showing which variables are required
└── README.md        # This file
```

---

## Adding Real XP and Level Tracking Later

The `/level` command currently assigns random levels. The code is structured so you can add real tracking without rewriting anything:

1. Install a database package (e.g. `better-sqlite3` for a simple local database)
2. In `handleLevel()`, replace the `Math.random()` pick with a lookup using `targetUser.id`
3. Add XP by listening to message events and updating the database per user

The level titles and numbers in the `levels` array are already in order and ready to use.
