# Developing Novelki

Run the ASP.NET Core API and Vite frontend as separate processes during development. Use PostgreSQL for the application database; Redis and S3-compatible storage are optional.

## Requirements

- .NET SDK matching [`global.json`](../global.json): .NET 10, with feature-band roll-forward enabled.
- Node.js 24 or later and npm.
- PostgreSQL with permission to create `pg_trgm` and `fuzzystrmatch`.
- Docker for the PostgreSQL Testcontainers integration tests.

## Configure the API

Run commands from the repository root. The checked-in [`Api/appsettings.json`](../Api/appsettings.json) contains placeholder credentials and an example S3 endpoint. Override them through user secrets for local development.

Prepare a JSON configuration with your database credentials and a long random JWT key:

```json
{
  "ConnectionStrings": {
    "DB": "Host=localhost;Port=5432;Database=novelki;Username=novelki;Password=<database-password>",
    "Redis": ""
  },
  "Jwt": {
    "Key": "<replace-with-a-long-random-secret>",
    "Issuer": "NovelkiBackend",
    "Audience": "NovelkiBackend"
  },
  "BookCovers": {
    "S3": {
      "Endpoint": ""
    }
  },
  "Admin": {
    "Emails": ["reader@example.com"]
  }
}
```

Save the JSON outside the checkout as `../novelki-secrets.json`, then import it into the API's user secrets:

```powershell
Get-Content ../novelki-secrets.json -Raw | dotnet user-secrets set --project Api
```

On Linux or macOS:

```sh
dotnet user-secrets set --project Api < ../novelki-secrets.json
```

The empty Redis value selects in-memory caching. The empty S3 endpoint selects local cover and EPUB storage. To use S3, configure the endpoint, region, access key, secret key, and bucket under `BookCovers:S3`.

## Run the API

Install the EF Core CLI if it is not already available. Use a 10.x version compatible with the project's EF Core packages:

```sh
dotnet tool install --global dotnet-ef --version 10.0.10
```

Restore dependencies, apply database migrations, and start the HTTPS launch profile:

```sh
dotnet restore NovelkiBackend.sln
dotnet dev-certs https --trust
dotnet ef database update --project Infrastructure --startup-project Api -- --environment Development
dotnet run --project Api --launch-profile https
```

The API listens at `https://localhost:7121` and `http://localhost:5232`. Open `https://localhost:7121/swagger` for the API reference. The development configuration leaves automatic migrations disabled, so apply migrations after pulling schema changes.

For administrator access, register with an email listed under `Admin:Emails`, then restart the API. The startup seeder assigns the role to that existing account.

## Run the frontend

In a second terminal:

```sh
cd Web
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `https://localhost:7121`. Copy [`Web/.env.example`](../Web/.env.example) to `Web/.env.local` to override `VITE_API_PROXY_TARGET` or the `VITE_API_BASE_URL` prefix.

## Project structure

| Project                           | Responsibility                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Api`                             | HTTP endpoints, authentication configuration, request limits, health checks, and telemetry.           |
| `Application`                     | Use cases, DTOs, validation, search parsing, and service contracts.                                   |
| `Domain`                          | Entities, search models, domain exceptions, and repository interfaces.                                |
| `Infrastructure`                  | EF Core persistence, Identity, file storage, imports, caching, metadata parsers, and background jobs. |
| `Web`                             | React application, component tests, and browser tests.                                                |
| `Application.UnitTests`           | Application and domain behavior tests.                                                                |
| `Infrastructure.IntegrationTests` | API and persistence tests using SQLite and PostgreSQL Testcontainers.                                 |
| `Application.Benchmarks`          | Application benchmarks.                                                                               |

The API uses the `/api/v1` prefix. Endpoint groups include accounts, books, book files, public books, authors, tags, genres, statuses, content types, and administration. Swagger in Development reflects the current routes and request contracts.

## Validation

### Backend

With Docker running for the PostgreSQL integration tests:

```sh
dotnet build NovelkiBackend.sln
dotnet test NovelkiBackend.sln --no-build
```

### Frontend

From `Web`:

```sh
npm ci
npx playwright install chromium
npm run test:all
npm run build
```

`test:all` runs TypeScript checks, ESLint, Prettier, Vitest, and Playwright layout tests for desktop, mobile, and tablet viewports. For a narrower check, use `npm run check`, `npm run test:run`, or `npm run test:layout`.

Use existing fixtures for tests where possible. New examples should use realistic book titles, authors, chapter data, and source metadata.

## EPUB crawler prototype

The **Find EPUB** interface uses a mock client. The crawler API and service integration remain unimplemented. See the [feature notes](../Web/src/features/epubSearch/README.md) for the client contract and integration boundary. EPUB uploads, storage, archive transfers, and authorized downloads use the existing API.
