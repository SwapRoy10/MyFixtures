# MyFixtures

MyFixtures is a responsive sports schedule website for following soccer clubs, NFL teams, and the Formula 1 season. It shows fixtures in the viewer's selected time zone and can export individual events, full schedules, or confirmed upcoming fixtures to Google Calendar.

## Live sites

- Production: https://my-fixtures-api.sorp.workers.dev
- Development: https://my-fixtures-api-development.sorp.workers.dev

## Features

- Search and save soccer clubs and NFL teams.
- View full-season schedules, including completed events.
- Follow Formula 1 Grand Prix races for the current calendar year.
- Convert kickoff and race times to Eastern, Central, Mountain, Pacific, or British time.
- Download one event or a complete schedule as an `.ics` calendar file.
- Add all confirmed upcoming events directly to Google Calendar.
- Keep genuinely provisional soccer fixtures labeled `TBD` until a provider confirms the kickoff.

## Schedule data

- Soccer league schedules come from [football-data.org](https://www.football-data.org/) and are cross-checked with ESPN for confirmed kickoff times.
- ESPN supplements domestic cup, Europa League, and Conference League fixtures.
- NFL schedules prefer ESPN and use [BALLDONTLIE](https://www.balldontlie.io/) as a fallback.
- Formula 1 schedules prefer [Jolpica F1](https://github.com/jolpica/jolpica-f1) and use BALLDONTLIE as a fallback.

## Technology

- Vanilla HTML, CSS, and JavaScript
- Cloudflare Workers and static assets
- Node.js tests with the built-in test runner
- GitHub Actions deployment to separate development and production Workers

## Local development

Requirements:

- Node.js 24
- A [football-data.org](https://www.football-data.org/client/register) API token for soccer data
- An optional BALLDONTLIE API key for fallback NFL and Formula 1 data

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
```

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
|   |-- styles.css
|   |-- app.js
|   |-- worker.js
|   |-- fixtures.test.mjs
|   |-- f1.test.mjs
|   |-- package.json
|   `-- wrangler.toml
`-- README.md
```

