# Live schedule API setup

## NBA

Select NBA to search and save current NBA teams. The default team is the Philadelphia 76ers. Schedules span July 1 through June 30, using the starting year as BALLDONTLIE's season identifier (2026 for 2026-27).

The existing `BALLDONTLIE_API_KEY` is used server-side for the free `/v1/teams` and `/v1/games` endpoints. Game requests follow all cursor pages with 100 results per page. The default games query includes regular-season, NBA Cup, Play-In and playoff games; a separate `season_type=preseason` query includes preseason. Team and date filters are applied, and duplicates/cancellations are removed. A failed page or preseason request returns an explicit error, never a successful partial schedule. Team responses are cached for 12 hours and game responses for one hour. Free-tier traffic is limited to five provider requests per minute; rapid requests for several uncached teams can require a retry.

Confirmed times use the provider's `datetime` UTC timestamp. Missing, postponed or unconfirmed times stay TBD and are excluded from calendar actions. NBA date-only games retain their scheduled calendar date when the viewer changes time zones. Completed games remain visible, matching soccer and NFL behavior. Google Calendar and ICS exports include every confirmed upcoming game, with an estimated 150-minute duration.

BALLDONTLIE does not currently document an arena field for NBA games. ESPN supplies optional venue details matched on opponent, home/away status and Eastern calendar date. Venue-feed failures do not remove NBA games or invent arenas. ESPN is not used to replace NBA kickoff times.

The initial 2026-27 NBA schedule has 80 defined regular-season opponents per team. The remaining two depend on NBA Cup outcomes. Undetermined Cup and playoff fixtures are included when the provider publishes them, rather than creating speculative matches. Provider reference: https://docs.balldontlie.io/.

Run `npm test` for NBA pagination, normalization, failure handling and browser calendar-export checks. Both individual and bulk calendar actions use the same Google setup below; include the development site's origin when testing bulk additions.

## Major League Baseball

Choose MLB in the sport selector to search all MLB teams and load games scheduled from the current day through the end of the calendar year. The Worker uses the BALLDONTLIE MLB `/mlb/v1/teams` and `/mlb/v1/games` endpoints with cursor pagination, so it retrieves more than the first 100 games when necessary. Regular-season and already-determined postseason games are included; completed and cancelled games are omitted.

The provider does not expose a series identifier or a game number within a series. The browser therefore groups consecutive games against the same opponent and in the same season phase when they are no more than four days apart. Games stay in chronological order and become the Game 1, Game 2, and later tabs. Each game has its own Google Calendar action, each series has an **Add series** action, and the existing bulk actions include every remaining game with a confirmed start time.

BALLDONTLIE makes the MLB Teams and Games endpoints available on its free tier, with a free-tier limit of five requests per minute. A `BALLDONTLIE_API_KEY` is required. The Worker caches team data for 12 hours and schedules for one hour to stay comfortably within that limit. See https://mlb.balldontlie.io/ for current provider documentation.

## Formula 1

Choose Formula 1 in the sport selector to load the current calendar year's Grand Prix races. The schedule prefers the free Jolpica F1 race feed and falls back to BALLDONTLIE `/f1/v1/events?season=YEAR` and `/f1/v1/sessions?type=Race&event_ids[]=ID`, including cursor pagination. Practice, qualifying and sprint sessions are not included.

`BALLDONTLIE_API_KEY` is optional while Jolpica is available. Its race session times require F1 ALL-STAR or GOAT access; an NFL subscription does not grant F1 access. See https://f1.balldontlie.io/#sessions. Errors are shown instead of substituting weekend start dates for race times. Calendar entries use an estimated two-hour duration.

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

The worker requests soccer schedules from football-data.org, cross-checks supported league kickoff times with ESPN, and supplements missing domestic cup, Europa League, and Conference League fixtures from ESPN's public schedules. A football-data.org placeholder is replaced only when ESPN marks the kickoff time as valid; otherwise the game remains honestly labeled TBD until its league confirms it. NFL schedules prefer ESPN and fall back to BALLDONTLIE. MLB teams and remaining games come from BALLDONTLIE. Played fixtures remain visible for soccer, NFL, and Formula 1; MLB intentionally begins with the current day. The browser converts UTC timestamps to the selected time zone and includes the competition or league in each calendar event.

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
