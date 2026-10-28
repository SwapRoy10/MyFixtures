# MyFixtures

MyFixtures is a responsive sports schedule website for following soccer clubs, NFL, MLB, NBA and NHL teams, and the Formula 1 season. It shows fixtures in the viewer's selected time zone and can export individual events, full schedules, or confirmed upcoming fixtures to Google Calendar.

## Live sites

- Production: https://my-fixtures-api.sorp.workers.dev
- Development: https://my-fixtures-api-development.sorp.workers.dev

## Features

- Check per-team schedule freshness and coverage, with dated last-good schedules during provider outages.
- Review recent schedule changes: times, venues, postponements and newly published matchups.
- Filter a Living Calendar by home/away, competitions and inclusive local dates; the dashboard and subscribed feed use the same settings.
- Follow device-specific subscription instructions with duplicate-import warnings.
- Browse MLB series with expandable game tabs in My Week while retaining individual calendar events.
- Combine up to 12 teams across sports in a persistent Living Calendar subscription.
- See a combined My Week agenda with Today, Weekend, Full season, sport and postseason filters, plus estimated game overlaps.
- Keep subscribed events updated as confirmed times, venues and matchups change; edit selections and reminders without replacing the subscription link.
- Search and save soccer, NFL, MLB, NBA, and NHL teams.
- Follow NHL preseason, regular-season and published Stanley Cup playoff games, with individual and full-season calendar actions.
- Follow NBA preseason, regular-season, NBA Cup, Play-In and playoff games as matchups are published, with individual Google Calendar buttons and season-wide exports.
- View full-season schedules, including completed events.
- Browse remaining MLB games in series cards with Game 1, Game 2, and later-game tabs.
- Add one MLB game, an entire series, or all remaining games to Google Calendar.
- Follow Formula 1 races, qualifying, sprint races, and sprint qualifying for the current calendar year when their schedules are published.
- Convert kickoff and race times to Eastern, Central, Mountain, Pacific, or British time.
- Download one event or a complete schedule as an `.ics` calendar file.
- Add all confirmed upcoming events directly to Google Calendar.
- Keep genuinely provisional soccer fixtures labeled `TBD` until a provider confirms the kickoff.

## Schedule data

- NHL schedules come from the league's public, keyless API. The app automatically fetches each selected team's full July-to-June season, preserving exact published UTC times, venues and separate split-squad games. Unconfirmed times remain TBD and are not exported. Run `npm run audit:nhl` to check all 32 teams against the source.
- Soccer league schedules come from [football-data.org](https://www.football-data.org/) and are cross-checked with ESPN for confirmed kickoff times.
- ESPN supplements domestic cup, Europa League, and Conference League fixtures.
- NFL schedules prefer ESPN and use [BALLDONTLIE](https://www.balldontlie.io/) as a fallback.
- NBA schedules use [BALLDONTLIE's free Teams and Games endpoints](https://docs.balldontlie.io/), with ESPN supplying matched venue details. Seasons span July through June; unpublished Cup and playoff matchups are added when available.
- MLB team and game data comes from [BALLDONTLIE MLB](https://mlb.balldontlie.io/). Only games scheduled from the current day forward are shown; determined postseason games are included automatically.
- Formula 1 schedules come from the free [Jolpica F1](https://github.com/jolpica/jolpica-f1) feed.

## Technology

- Vanilla HTML, CSS, and JavaScript
- Cloudflare Workers and static assets
- Node.js tests with the built-in test runner
- GitHub Actions deployment to separate development and production Workers

## Local development

Requirements:

- Node.js 24
- A [football-data.org](https://www.football-data.org/client/register) API token for soccer data
- A BALLDONTLIE API key for MLB/NBA data and the optional NFL fallback

From the application directory:

```bash
cd MyFixturesApp
npm ci
```

Create an untracked `.dev.vars` file when provider keys are needed locally:

```text
FOOTBALL_DATA_API_KEY=your_token
BALLDONTLIE_API_KEY=your_optional_key
```

Then start the local Worker:

```bash
npm run preview
```

Do not commit `.dev.vars`, `.env` files, API keys, or Google client secrets.

## Testing

```bash
cd MyFixturesApp
npm test
npx wrangler deploy --dry-run
npm run audit:living -- http://localhost:8787
```

The Living Calendar audit creates and stops its own disposable NHL subscription. Add `--all-sports` to check all six sports against a configured development Worker. It may take several minutes while initial schedules load. It never writes to a user's Google, Apple or Outlook calendar.

Run `npm run audit:seasons -- https://my-fixtures-api-development.sorp.workers.dev` for a paced, read-only check of current published seasons across all six sports. Regression tests cover January and July rollovers. The **Verify published schedules** workflow provides manual checks and a daily production check once merged into the default branch; it cannot verify unpublished matchups.

## Living Calendar

Open **My Week & Living Calendar**, select your teams, and create your calendar. Once schedules finish preparing, subscribe using the provided URL in Google Calendar (Settings → Add calendar → From URL), Apple Calendar or Outlook. Importing a downloaded file once is not a subscription.

Save the private management link to edit your selection on another device. The subscription and dashboard links are view-only but reveal your chosen teams to anyone holding them. No account is required. Losing both the management link and browser storage means creating a new calendar.

Schedules refresh approximately hourly in the background. Calendar applications control their own polling and may take several hours to display changes. Unconfirmed times are excluded from the feed until confirmed. Overlap detection uses estimated game lengths; reminder support depends on the calendar application. Only published matchups are available, including postseason games as providers announce them.

The Worker uses the `CALENDARS` SQLite Durable Object binding and migration in `wrangler.toml`. Development and production have separate subscription data and URLs. Ordinary one-off exports remain available and unchanged.

### Reliability, history and filters

Coverage describes the provider response, not a guarantee that future fixtures have been announced. Cached checks may reuse an upstream response. When an update fails, the dashboard retains its last successful schedule and labels it stale. One-off schedule pages use a best-effort seven-day edge/browser snapshot; cache eviction or disabled browser storage can make that snapshot unavailable.

History begins with the first successful baseline and retains up to 80 changes per team for 90 days. Editing calendar settings does not create schedule-change entries. Unknown opponents and unconfirmed or postponed start times are not exported as confirmed events.

Home/away filters match any selected participating team; neutral-site games are excluded from either side-only filter. Date bounds use the calendar's selected time zone. All competitions includes newly announced competitions automatically; an explicit selection does not. Excluded events are withdrawn using their existing identifiers, so restoring filters restores the same events rather than creating duplicates.

## Deployment

The repository uses two long-lived branches:

- `development` deploys the development Worker for testing.
- `main` deploys the production Worker.

Changes should normally be tested on `development` before being promoted to `main`. GitHub Actions performs the corresponding Cloudflare deployment after each push.

See [API-SETUP.md](MyFixturesApp/API-SETUP.md) for provider and Google Calendar configuration, and [DEVELOPMENT-WORKFLOW.md](MyFixturesApp/DEVELOPMENT-WORKFLOW.md) for the branch workflow.

## Project structure

```text
.
|-- .github/workflows/deploy.yml
|-- MyFixturesApp/
|   |-- index.html
|   |-- calendar.html
|   |-- app.css          (all page styles)
|   |-- app.js
|   |-- worker.js
|   |-- fixtures.test.mjs
|   |-- f1.test.mjs
|   |-- package.json
|   `-- wrangler.toml
`-- README.md
```
