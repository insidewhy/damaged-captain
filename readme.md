# Usage

## Setup
```bash
yarn add damaged-captain
```

Then edit `.damaged-captainrc` and set your database configuration:

```yaml
database: my_db_name
# the rest of the configuration elements are optional
# command defaults to mysql
command: mysql
# the following are undefined when not configured
env: .env
passwordToEnv: MYSQL_PWD
passwordFromEnv: DB_PASSWORD
```

If you prefer you can also record these in a `json` file at `.damaged-captain.json` or in your `package.json` under the `"damaged-captain"` property.

The optional `.env` configuration element points to a [dotenv](https://github.com/motdotla/dotenv) file containing variables you can substitute within your SQL scripts.
If `passwordToEnv` and `passwordFromEnv` are set then when running the `command`, the value in the `env` file corresponding to `passwordFromEnv` (in this case `DB_PASSWORD`) will be exported to the environment variable corresponding to `passwordToEnv` (in this case `MYSQL_PWD`).

Next create your first migration
```bash
npx damaged-captain create migration-name
```

## Creating migrations
This will create a directory at `migrations/20181225-040000` with two files, `up.sql` and `down.sql`.

An example `up.sql` might look like this:

```sql
create user 'db_user'@'%' identified by '${MYSQL_USER_PASSWORD}';
```

If `.env` looks like this:
```sql
MYSQL_USER_PASSWORD=mypassword
```

Then the following command will be run:
```sql
create user 'db_user'@'%' identified by 'mypassword';
```

## Running migrations

This will migrate to the latest version:
```bash
npx damaged-captain migrate
```

This will rollback the latest migration by running the `down.sql` script:
```bash
npx damaged-captain rollback
```

This will rollback the latest migration and then migrate to the latest version:
```bash
npx damaged-captain redo
```

Each of these commands will manipulate an entry in a table `db_version` to store the current migration version so that future commands will know which migrations have been applied.
