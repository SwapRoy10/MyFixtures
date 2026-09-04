# Development workflow

## Branches

- `main`: production code. Merges here deploy `https://my-fixtures-api.sorp.workers.dev`.
- `development`: work in progress. Pushes deploy a separate Worker named `my-fixtures-api-development` for testing.

## First-time setup

1. Install Git from https://git-scm.com/download/win.
2. Create an empty GitHub repository named `my-fixtures-app`.
3. In this folder, run:

```powershell
git init
git add .
git commit -m "Initial MyFixtures app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/my-fixtures-app.git
git push -u origin main
git switch -c development
git push -u origin development
```

4. In GitHub repository settings, add these Actions secrets:
   - `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with Workers Scripts edit permission
   - `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID
5. Add `FOOTBALL_DATA_API_KEY` as a secret to the development Worker too:

```powershell
npx wrangler secret put FOOTBALL_DATA_API_KEY --name my-fixtures-api-development
```

## Everyday work

Create a feature branch from `development`, make changes, and push it:

```powershell
git switch development
git pull
git switch -c feature/my-change
git add .
git commit -m "Describe the change"
git push -u origin feature/my-change
```

Open a pull request into `development` and test the development deployment. When it is ready, open a pull request from `development` into `main`. Merging that pull request deploys production.

Never commit API keys, Google client secrets, `.dev.vars`, or `.env` files. The Google OAuth client ID is public; the Calendar permission still requires users to authorize the app.
