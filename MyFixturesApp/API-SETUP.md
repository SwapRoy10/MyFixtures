# Live schedule API setup

## Schedule reliability updates

Fixture responses include `health` freshness and coverage metadata. Last-good edge snapshots are retained best-effort for seven days; stale results are explicitly labeled and are not cached as new successes. The browser also retains a dated last-good snapshot. Partial responses never replace a complete snapshot.

Living Calendar settings accept `venueFilter` (`all`, `home`, `away`), inclusive local `dateFrom`/`dateTo`, and an optional `competitionFilters` allowlist. Existing calendars default to all games. Dashboard and ICS filtering share the same rules; removed events retain their UID as cancellations and restored events reuse that UID.

Per-team provider-change history starts at the first baseline and keeps at most 80 records for 90 days. Large schedule snapshots are stored in bounded chunks, with legacy records read transparently. No additional secrets or Durable Object migration are required.

Run `npm test` and `npm run audit:living -- URL --all-sports` for regression and disposable-subscription integration checks. Run `npm run audit:seasons -- URL` for a paced, read-only current-season audit. The scheduled verification workflow becomes active after promotion to the repository's default branch.

## Living Calendar and My Week

`/calendar.html` combines up to 12 selections across all six sports. Create a subscription, wait for its initial schedules to finish, then subscribe to `/calendar/ID.ics`. Google Calendar's desktop **Add calendar → From URL** accepts the HTTPS URL; Apple Calendar and Outlook can also subscribe. No Google OAuth access is needed for this feature. Existing one-off exports and Google bulk sync remain separate.

### Storage and refresh

Deploy the `CALENDARS` Durable Object binding and `living-calendar-v1` SQLite migration already declared in `wrangler.toml`. No manually created database ID is required. Each Worker has its own subscription data. Do not remove the binding or migration when promoting development to production.

Durable Object alarms refresh shared team snapshots approximately hourly without a browser open. BALLDONTLIE-backed sports are paced at least 65 seconds apart; one schedule can require several paginated provider requests. Provider failures retain the last good snapshot and retry with backoff. Initial multi-sport preparation can take several minutes; the first feed returns 503 with Retry-After until every selected team has loaded. Later provider failures do not erase published events. Background work expires after 90 days without a dashboard/feed read and resumes on the next read. Stopping a subscription releases team refreshes unless another active subscription uses them.

Events keep stable UIDs and increment SEQUENCE for changes. Previously published events that are removed from a selection, cancelled or become TBD are retained as cancelled entries for client reconciliation. Unpublished TBD starts never become timed events. Missing fixtures require two complete snapshots before withdrawal; partial soccer/NFL responses cannot imply cancellations. Event end times and overlap detection use estimated durations. Retained event history is bounded to 400 days. Calendar clients decide their refresh interval and reminder behavior: changes are not instant push notifications.

### API and management

- `POST /api/calendars`: JSON settings; returns ID, revision and a one-time edit token.
- `GET /api/calendars/ID`: view-only settings, combined games and readiness/delay status.
- `PUT /api/calendars/ID`: update settings using `Authorization: Bearer EDIT_TOKEN` and the current revision; stale writes return 409.
- `DELETE /api/calendars/ID`: owner-only stop; the feed remains readable with withdrawn events so existing subscribers can reconcile.
- `GET` or `HEAD /calendar/ID.ics`: calendar subscription with ETag/304 support.

The browser saves the edit token locally. The private management link carries it in a URL fragment, not a query string. Only its hash is stored server-side. Anyone with a dashboard or subscription URL can read the selection, but cannot edit without the token. Keep management links private. Clearing browser storage without saving that link loses edit access. Anonymous creation is capped at 20 subscriptions per IP/hour; request bodies and team selections are bounded.

### Verification

Run `npm test` for mocked-provider, event reconciliation, timezone, authorization, persistence and cleanup tests. With a local Worker running, `npm run audit:living -- http://localhost:8787` exercises real NHL data without provider keys. Against development, use:

```text
npm run audit:living -- https://my-fixtures-api-development.sorp.workers.dev --all-sports
```

This creates a disposable subscription and stops it afterward, checking readiness, deduplication, feed contents, caching, unauthorized writes and stable IDs after settings changes. It does not add events to an actual calendar account. Provider keys must be configured for all-sport checks. Allow several minutes for the initial background queue.

If Wrangler's local asset watcher continuously reloads because the asset directory is the project root, use `npm run preview:stable` and restart it after code changes.

## NHL

NHL uses the league's public Web API, with no API key or BALLDONTLIE subscription. Select NHL and search/save any active team; the default is the Philadelphia Flyers.

- Active teams: `https://api-web.nhle.com/v1/schedule-calendar/now`
- Full team season: `https://api-web.nhle.com/v1/club-schedule-season/PHI/20262027`

The Worker resolves team IDs to NHL abbreviations automatically. Each season runs July through June, using an eight-digit identifier (`20262027`). The feed returns the complete season without pagination, including preseason, regular season and published Stanley Cup playoff games. Undetermined playoff matchups are not invented. Split-squad games remain separate using NHL game IDs.

Dates and UTC start times come directly from NHL. Timezone conversion uses the date-specific daylight-saving offset. Date-only, unconfirmed and postponed games remain TBD and cannot be exported. Completed games remain visible; individual Google Calendar buttons, Add All and ICS downloads export confirmed upcoming games with an estimated 150-minute duration. Venue and neutral-site flags come from each game, not a team's default arena.

Team data is cached for 12 hours and schedules for one hour. Provider requests have a 15-second timeout; provider errors are not cached as successful empty schedules. The API is a public NHL service, not a contracted developer service, so availability and schemas may change.

Run `npm test` for regression and calendar tests. Run `npm run audit:nhl` to compare all 32 development-site schedules with NHL source game IDs, dates, timestamps, opponents and venues, check opposing-team consistency, measure cold/warm responses, and verify a completed Stanley Cup playoff season. Use `npm run audit:nhl -- --local` to audit the local Worker; `MYFIXTURES_URL` and `NHL_SEASON_YEAR` can override the target and season. These audits are read-only and do not write to Google Calendar.

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

Choose Formula 1 in the sport selector to load the current calendar year's Grand Prix weekends. The schedule comes from the free Jolpica F1 race feed, which publishes separate Race, Qualifying, Sprint and Sprint Qualifying (formerly Sprint Shootout) dates and times where available. Practice sessions are not included. Sessions with no confirmed time remain visible as TBD but are excluded from calendar exports.

No API key is needed. There is no BALLDONTLIE fallback, because its F1 session times require a paid ALL-STAR or GOAT plan. If Jolpica is unavailable the worker returns a 503, so the site keeps showing the last successful schedule and marks it as delayed. Calendar durations are estimated at two hours for races, one hour for qualifying, and 45 minutes for sprint and sprint qualifying.

Test locally with `npm test`. Select Formula 1 and check session titles, local times, and calendar exports. Do not deploy to the default production Worker when testing this change.

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
