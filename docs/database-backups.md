# Local PostgreSQL backups

The local catalog database is durable state. Crawled page HTML is useful for
reprocessing, but it is not a substitute for the normalized catalog tables.
Create a backup before running database-mutating integration work or large
catalog refreshes.

## Create a backup

Make sure the local PostgreSQL container is running, then run:

```bash
npm run db:backup
```

This writes a timestamped PostgreSQL custom-format dump and a SHA-256 checksum
under `backups/`. The dump files are ignored by Git so local catalog data does
not get committed. Copy the `backups/` folder to another disk or protected
storage periodically; a backup on the same computer does not protect against
disk loss.

The script targets the `ford` database in `ford-scraping-postgres-1`. Set
`FORD_POSTGRES_CONTAINER` if the container has another name. The output is
atomic: interrupted dumps remain as `.partial` files and are not treated as
completed backups.

## Restore

Use a separate empty database for recovery checks. Substitute the desired dump
filename:

```bash
docker exec ford-scraping-postgres-1 createdb -U postgres ford_restore_test
docker cp backups/ford-YYYYMMDDTHHMMSSZ.dump ford-scraping-postgres-1:/tmp/ford.dump
docker exec ford-scraping-postgres-1 pg_restore -U postgres --exit-on-error --no-owner --no-acl -d ford_restore_test /tmp/ford.dump
```

Check expected data before directing the application at the restored database:

```bash
docker exec ford-scraping-postgres-1 psql -U postgres -d ford_restore_test -c \
  "SELECT (SELECT count(*) FROM ford.models) AS models,
          (SELECT count(*) FROM ford.model_years) AS model_years,
          (SELECT count(*) FROM ford.specifications) AS specifications,
          (SELECT count(*) FROM ford.features) AS features;"
```

Keep the original database untouched until the restored counts and application
lookups have been checked. Do not restore over the live database as a first
step.
