# Live schedule API setup

## Formula 1

Choose Formula 1 in the sport selector to load the current calendar year's Grand Prix races. This championship-wide schedule uses BALLDONTLIE `/f1/v1/events?season=YEAR` and `/f1/v1/sessions?type=Race&event_ids[]=ID`, including cursor pagination. Practice, qualifying and sprint sessions are not included in this first integration.

The existing server-side `BALLDONTLIE_API_KEY` is reused. Race session times require F1 ALL-STAR or GOAT access; an NFL subscription does not grant F1 access. See https://f1.balldontlie.io/#sessions. Errors are shown instead of substituting weekend start dates for race times. Calendar entries use an estimated two-hour duration.

Test locally with `npm test`. For live development testing, configure `BALLDONTLIE_API_KEY` on `my-fixtures-api-development`, or in an untracked `.dev.vars` file for `npm run preview`. Select Formula 1 and check race titles, local times, and calendar exports. Do not deploy to the default production Worker when testing this change.

The app uses a Cloudflare Worker so schedule provider tokens are never exposed in the browser.

1. Create a football-data.org token at https://www.football-data.org/client/register.
2. Create a BALLDONTLIE API key at https://app.balldontlie.io/.
3. Install Wrangler and log in to Cloudflare.
4. From this directory, run:

```text
npx wrangler secret put FOOTBALL_DATA_API_KEY
npx wrangler secret put BALLDONTLIE_API_KEY
npx wrangler deploy
```

5. Open the deployed Worker URL. It serves both the static app and `/api/fixtures`.

The worker requests soccer schedules from football-data.org, cross-checks supported league kickoff times with ESPN, and supplements missing domestic cup, Europa League, and Conference League fixtures from ESPN's public schedules. A football-data.org placeholder is replaced only when ESPN marks the kickoff time as valid; otherwise the game remains honestly labeled TBD until its league confirms it. NFL schedules prefer ESPN and fall back to BALLDONTLIE. Played fixtures remain visible so each supported season is complete; the browser converts UTC timestamps to the selected time zone and includes the competition or league in each calendar event.

For the development Worker, set both secrets on the development Worker too:

```text
npx wrangler secret put FOOTBALL_DATA_API_KEY --name my-fixtures-api-development
npx wrangler secret put BALLDONTLIE_API_KEY --name my-fixtures-api-development
```

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
