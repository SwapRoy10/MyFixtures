# Live fixture API setup

The app uses a Cloudflare Worker so the football-data.org token is never exposed in the browser.

1. Create a football-data.org token at https://www.football-data.org/client/register.
2. Install Wrangler and log in to Cloudflare.
3. From this directory, run:

```text
npx wrangler secret put FOOTBALL_DATA_API_KEY
npx wrangler deploy
```

4. Open the deployed Worker URL. It serves both the static app and `/api/fixtures`.

The worker requests Arsenal team `57` from football-data.org for August 1, 2026 through May 30, 2027. It returns every competition made available to your football-data.org plan. The browser converts UTC timestamps to `America/New_York` Eastern Time and includes the competition in each calendar event.

## Google Calendar bulk sync

If Google says the app is restricted to users within the organization:

1. Open Google Cloud Console and select the project that owns the OAuth client ID.
2. Go to **Google Auth Platform > Audience**.
3. Change the app from **Internal** to **External** and save.
4. Add your Google account under **Test users** while the app is in testing.
5. Under **Data access**, add `https://www.googleapis.com/auth/calendar.events`.
6. Under **Clients**, confirm this **authorized JavaScript origin** exists:
	`https://my-fixtures-api.sorp.workers.dev`

This app uses the Google Identity Services popup token flow. Do **not** add a redirect URI for this flow. In Google Cloud, the OAuth client must be a **Web application** client, and the origin must include the scheme with no trailing path:

```text
https://my-fixtures-api.sorp.workers.dev
```

Common fixes:

- `origin_mismatch`: add the exact origin above and open the site at that same URL, not a `file://` URL or a different preview URL.
- `access_denied` or organization restriction: set the app audience to **External** and add your Google account as a test user.
- `Error 403: access_denied`: enable Google Calendar API and add the `calendar.events` scope under **Data access**.
- "Only proceed if the developer invited you": the selected email is not in **Test users**. Add that exact email under **Google Auth Platform > Audience > Test users**, save, then wait a few minutes and retry.
- "Something went wrong" after selecting the account: open the app using exactly `https://my-fixtures-api.sorp.workers.dev` and confirm that exact value appears under the OAuth client's **Authorized JavaScript origins**. Do not include `/`, a path, query string, `file://`, or `http://`.

Then reload the deployed app and click **Add all to Google Calendar** again. No client secret belongs in this project.