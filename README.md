# Chaos Room

A small, mobile-friendly party game for 2–4 people. One player creates a room, shares the four-character code, and hosts five quick rounds. Room state and scoring live on the server so connected players stay in sync.

## Run it on your computer

You need Node.js 18 or newer. Download the LTS release from [nodejs.org](https://nodejs.org/) if it is not already installed.

1. Open Terminal (macOS) or PowerShell (Windows).
2. Move into this project folder. For this workspace, run:

   ```sh
   cd "/Users/ebenezer/Documents/Codex/2026-10-16/help-me-build-a-complete-multiplayer"
   ```

3. Install the project packages:

   ```sh
   npm install
   ```

4. Start the game:

   ```sh
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000). To play two seats on one computer, open a private/incognito window as the second player so each browser has separate saved identity.
6. Stop the server with **Ctrl+C** in the terminal.

## How reconnection works

The browser saves a private room token on that device. Refreshing the page or reconnecting within two minutes restores the same player, score, and match seat. If the server process restarts, active rooms are lost; this first version keeps rooms in memory and does not use a paid database. The room disappears after all players disconnect, and disconnected seats are released after two minutes.

## Publish on Render

The included `render.yaml` configures a Node web service with a health check. Render supports the WebSocket connection used by this game. Free web services may sleep while idle and take a little time to wake when someone first visits. Availability and free-tier limits can change; check Render's current [free service notes](https://render.com/docs/free) before publishing.

### A. Put this project on GitHub

1. Sign in to [GitHub](https://github.com/) or create an account.
2. Create a new **empty** repository named `chaos-room`. Do not add a README, license, or `.gitignore` there; these files are already in this folder.
3. In a terminal opened in this project folder, run:

   ```sh
   git init
   git add .
   git commit -m "Build Chaos Room multiplayer game"
   git branch -M main
   git remote add origin https://github.com/YOUR-GITHUB-NAME/chaos-room.git
   git push -u origin main
   ```

   Replace `YOUR-GITHUB-NAME` with your GitHub username. GitHub may ask you to sign in in a browser or configure its recommended authentication method. These commands publish the project source to the GitHub repository you created.

### B. Create the Render service

1. Sign in to [Render](https://render.com/) and connect your GitHub account when asked.
2. From the Render dashboard, choose **New + → Blueprint** (sometimes labeled **Blueprint Instance**).
3. Select your `chaos-room` repository. Render reads `render.yaml` and shows the planned web service.
4. Review the service settings, choose the Free plan if Render asks, and click **Apply**. This creates a public service and may ask you to approve access to the GitHub repository.
5. Wait for the first deploy to finish successfully. In Render's service page, open **Logs** if the deploy fails.
6. Open the `onrender.com` URL shown in the service overview. The game is publicly live only after this deploy succeeds and that URL loads.

Any future `git push` to `main` will trigger a redeploy.

### C. Verify on two devices or browser sessions

1. Open the Render URL on device/browser session A. Create a room and copy its four-character code.
2. Open the same URL on device/browser session B (for example, a phone using mobile data, or a private browser window). Enter a different name and the room code, then join.
3. On A, check that B appears in the lobby and press **Start game**. On B, check that the first question and countdown appear.
4. Submit answers from both sessions. Confirm the reveal and score update appear on both screens. Do the same through the two challenge vote rounds and the final winner screen.
5. Refresh one browser during a round. It should rejoin under the same name without adding a duplicate player. If Render has slept, give the first page load time to wake the service.

## Rules

- Each match has five rounds: question, challenge, question, challenge, question.
- Question rounds award 2 points for the correct answer and 1 point for choosing an answer tied for most popular. Tied most-popular choices each earn the majority point.
- In challenge rounds, submitting a short response earns 1 point. The player or players with the most votes for funniest response earn 2 more. Players cannot vote for themselves.
- A tied top score at the end is a shared win. Challenge completion is self-reported, so play honestly and keep answers friendly.

## Project files

- `server.js` — HTTP server, rooms, timers, reconnects, validation, and scoring.
- `public/` — browser interface and styling.
- `render.yaml` — Render service settings.
- `scripts/test-flow.js` — automated two-player five-round multiplayer flow check.
