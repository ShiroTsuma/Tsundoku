# Self-hosting Tsundoku

Run Tsundoku with Docker Compose and an external PostgreSQL database. The stack builds the API and web application and starts Grafana, Prometheus, Loki, Tempo, and the OpenTelemetry Collector.

## Prerequisites

- Docker with the Compose plugin.
- A PostgreSQL database reachable from the API container, with permission to install `pg_trgm` and `fuzzystrmatch` during migration.
- Persistent storage for the database, covers, and EPUB files.
- Optional: Redis for shared caching and an S3-compatible bucket for file storage.

The committed `docker-compose.yml` does not provision PostgreSQL or Redis. A local `docker-compose.override.yml` can add services, but it is not part of the repository.

## Configure the instance

Copy [`.env.example`](../.env.example) to `.env` in the repository root. Keep instance-specific settings and credentials in this untracked file.

| Setting                                        | Purpose                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DB_CONNECTION_STRING`                         | PostgreSQL connection string. Use a database hostname reachable from the API container.                                |
| `JWT_KEY`                                      | Long random secret for signing access tokens. Replace the example value.                                               |
| `JWT_ISSUER`, `JWT_AUDIENCE`                   | Token issuer and audience for your instance.                                                                           |
| `ADMIN_EMAIL`                                  | Existing account that should receive the `Admin` role at API startup.                                                  |
| `REDIS_CONNECTION_STRING`                      | Redis connection; leave empty for in-memory caching.                                                                   |
| `WEB_PUBLIC_ORIGIN`                            | Browser-facing origin, also included in the API's allowed CORS origins.                                                |
| `API_PORT`, `WEB_PORT`, `WEB_HTTP_PORT`        | Published API, HTTPS, and HTTP ports.                                                                                  |
| `BOOK_COVERS__S3__*`                           | Endpoint, region, access key, secret key, and bucket for S3-compatible storage. Clear these values to use local files. |
| `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` | Grafana credentials. Replace the example password.                                                                     |
| `BOOK_FILES_OWNER_STORAGE_BYTES`               | Per-account EPUB storage quota, including trash.                                                                       |
| `BOOK_FILES_LIBRARY_ARCHIVE_BYTES`             | Maximum dedicated EPUB library archive size.                                                                           |
| `BOOK_FILES_STAGING_BYTES`                     | Global EPUB staging capacity.                                                                                          |
| `BOOK_FILES_ARCHIVE_UPLOAD_LIMIT`              | nginx archive request limit; allow at least the API archive limit plus 1 MiB for multipart overhead.                   |

The example database and Redis addresses use `localhost`. Inside a container, that address points to the container itself. Use a service name on a shared Docker network or a host address reachable from Docker. Docker Desktop provides `host.docker.internal` for services on the host machine.

The API reads ASP.NET Core configuration keys, such as `ConnectionStrings__DB`. Compose maps the `.env` variables above to those keys. For direct API execution, follow the [development guide](development.md).

## Start and update

From the repository root:

```sh
docker compose up --build -d
docker compose ps
```

Compose enables `Database:AutoMigrate`, so the API applies EF Core migrations before serving requests. Back up an existing instance before updating to a revision with database changes.

Register an account in the web application. To make it an administrator, set `ADMIN_EMAIL` to that account's email and restart the API:

```sh
docker compose restart api
```

The seeder grants the role to an existing account; it does not create the account.

### Local addresses

| Service                | Default address                      |
| ---------------------- | ------------------------------------ |
| Web application        | `https://localhost:8080`             |
| HTTP redirect to HTTPS | `http://localhost:8081`              |
| API                    | `http://localhost:5232`              |
| API readiness          | `http://localhost:5232/health/ready` |
| API liveness           | `http://localhost:5232/health/live`  |
| Grafana                | `http://localhost:3000`              |
| Prometheus             | `http://localhost:9090`              |

The default web container creates a 30-day self-signed certificate. Expect a browser certificate prompt for local use. Swagger is available at `/swagger` only when the API runs in Development; Compose defaults to Production.

## Public domain and HTTPS

Point your domain's DNS record to the server and make public TCP ports 80 and 443 reachable. Set these values in `.env`:

```dotenv
WEB_PORT=443
WEB_HTTP_PORT=80
WEB_PUBLIC_ORIGIN=https://library.example.com
PUBLIC_DOMAIN=library.example.com
PUBLIC_HTTPS_AUTHORITY=library.example.com
ACME_ENABLED=true
ACME_EMAIL=operator@example.com
```

Rebuild and start the stack:

```sh
docker compose up --build -d
```

The web container requests a Let's Encrypt certificate through HTTP-01 on startup. It checks for renewal every 12 hours and reloads nginx after a successful renewal. Preserve the `letsencrypt-data` volume during updates.

nginx accepts the configured `PUBLIC_DOMAIN`, redirects HTTP to `PUBLIC_HTTPS_AUTHORITY`, and proxies API requests. Compose binds the API port to the host's loopback interface. Route public application traffic through nginx and restrict access to the separate monitoring ports to your administration network.

For local use, keep these settings instead:

```dotenv
WEB_PORT=8080
WEB_HTTP_PORT=8081
WEB_PUBLIC_ORIGIN=https://localhost:8080
PUBLIC_DOMAIN=localhost
PUBLIC_HTTPS_AUTHORITY=localhost:8080
ACME_ENABLED=false
```

## Storage and recovery

Compose mounts three host directories into the API container:

| Directory              | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `storage/covers`       | Original covers and thumbnails when using local storage.                |
| `storage/epubs`        | Private EPUB files when using local storage.                            |
| `storage/epub-staging` | Temporary files and active import/export jobs, including when using S3. |

With S3 configured, covers and EPUBs use the configured bucket. Keep EPUB objects private and let the API authorize downloads. Do not expose the EPUB or staging directories through a static file server.

Back up PostgreSQL and local file storage or S3 objects together. The application's **Full backup ZIP** contains CSV book data and covers; export EPUBs through the separate **EPUB archive** workflow. An EPUB archive restore matches existing books and does not create catalog entries. See [EPUB storage](epub-storage.md) for matching rules, quotas, and retention.

Keep `storage/epub-staging` across restarts so the API can recover active jobs. Preserve Compose volumes for certificates and any monitoring history you want to retain. `docker compose down` stops the stack; adding `--volumes` also deletes its named volumes.

## Monitoring and diagnostics

The API sends logs, metrics, and traces through OTLP to the OpenTelemetry Collector. Grafana includes provisioned Prometheus, Loki, and Tempo data sources and the **Tsundoku overview** dashboard.

- `/health/live` checks that the API process responds.
- `/health/ready` checks readiness, including database connectivity.

Inspect startup failures with:

```sh
docker compose logs --tail=100 api web
```

Check database reachability and credentials first if the API never becomes healthy. The web container waits for API readiness before starting.
