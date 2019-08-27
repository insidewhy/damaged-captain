import * as yargs from 'yargs'
import * as path from 'path'
import * as cosmiconfig from 'cosmiconfig'
import * as mkdirp from 'mkdirp'
import * as dotenv from 'dotenv'
import { format as formatDate } from 'date-fns'
import { closeSync, openSync, readFileSync, readdirSync } from 'fs'
import { buildTypes } from './types'
import { spawnClient, endClient } from './db-client'
import { Config } from './config'

interface Env {
  [k: string]: string
}

// invalid database name used to represent no database
const UNDEFINED_DATABASE = '$'
const UP_SCRIPT_NAME = 'up.sql'
const DOWN_SCRIPT_NAME = 'down.sql'

function touch(path: string) {
  closeSync(openSync(path, 'w'))
}

function getEnv(config: Config): Env {
  const { env } = config
  if (env) {
    return dotenv.parse(readFileSync(env))
  } else {
    return {}
  }
}

function applyEnv(config: Config, env: Env) {
  const { passwordFromEnv, passwordToEnv } = config
  if (passwordFromEnv && passwordToEnv) {
    process.env[passwordToEnv] = env[passwordFromEnv]
  }
}

function validateConfig(config: Config) {
  if (config.database === UNDEFINED_DATABASE) {
    throw new Error('Must set database in config')
  }
}

export function dirToVersion(dir: string) {
  return dir.slice(0, 15)
}

// '0' for no version i.e. pure database
export async function getCurrentDbVersion(config: Config): Promise<string> {
  const { command, database } = config
  const proc = spawnClient(command, [database], true)
  proc.stdin!.write('select * from db_version')
  try {
    const output = await endClient(proc)
    // final line of output is version
    return output.replace(/.*\n/, '').trim()
  } catch (e) {
    return '0'
  }
}

export async function runMigration(sql: string, config: Config) {
  const { command, database } = config
  const proc = spawnClient(command, [database])
  proc.stdin!.write(sql)
  return endClient(proc)
}

export async function recordMigration(version: string, config: Config) {
  const { command, database } = config
  const proc = spawnClient(command, [database])
  proc.stdin!.write('create table if not exists db_version (version char(15));')
  proc.stdin!.write('delete from db_version;')
  proc.stdin!.write(`insert into db_version values('${version}');`)
  return endClient(proc)
}

export async function migrate(config: Config) {
  validateConfig(config)
  const { migrationDir } = config
  const env = getEnv(config)
  applyEnv(config, env)

  const currentVersion = await getCurrentDbVersion(config)

  const migrationDirs = readdirSync(migrationDir).sort()
  // remove the migrations which have already been run
  const nextIndex = migrationDirs.findIndex(dir => dirToVersion(dir) > currentVersion)
  if (nextIndex === -1) {
    migrationDirs.splice(0)
  } else if (nextIndex > 0) {
    migrationDirs.splice(0, nextIndex)
  }

  if (migrationDirs.length === 0) {
    console.log('no migrations to run')
    return
  }

  console.log('run migrations since version', currentVersion)
  for (let subDir of migrationDirs) {
    const upScript = path.join(migrationDir, subDir, UP_SCRIPT_NAME)
    console.log('migrate', upScript)
    const rawContent = readFileSync(upScript).toString()
    const content = rawContent.replace(/\$\{([\w_]+)\}/, (_, match) => env[match])
    try {
      await runMigration(content, config)
    } catch (e) {
      try {
        console.log('rolling back partial application of failed migration', upScript)
        const rollbackVersion =
          nextIndex === 0 ? undefined : dirToVersion(migrationDirs[nextIndex - 1])
        await runRollback(config, env, subDir, rollbackVersion)
      } catch (e) {
        throw new Error(
          `failed to migrate ${upScript} then failed to roll back the partial migration`,
        )
      }

      throw new Error(`failed to run migration ${upScript}`)
    }

    try {
      await recordMigration(dirToVersion(subDir), config)
    } catch (e) {
      throw new Error(`failed to record migration ${upScript}`)
    }
  }
}

export async function runRollback(
  config: Config,
  env: Env,
  rollbackDir: string,
  rollbackVersion?: string,
) {
  const { migrationDir } = config
  const downScript = path.join(migrationDir, rollbackDir, DOWN_SCRIPT_NAME)
  const rawContent = readFileSync(downScript).toString()
  const content = rawContent.replace(/\$\{([\w_]+)\}/, (_, match) => env[match])
  console.log('rollback', downScript)
  try {
    await runMigration(content, config)
  } catch (e) {
    throw new Error(`failed to rollback migration ${downScript}`)
  }

  if (rollbackVersion) {
    try {
      await recordMigration(rollbackVersion, config)
    } catch (e) {
      throw new Error(`failed to record rollback migration ${downScript}`)
    }
  }
}

export async function rollback(config: Config) {
  validateConfig(config)
  const { migrationDir } = config
  const env = getEnv(config)
  applyEnv(config, env)

  // remove the migrations which have already been run
  const migrationDirs = readdirSync(migrationDir).sort()
  const currentVersion = await getCurrentDbVersion(config)
  const rollbackIndex = migrationDirs.findIndex(dir => dirToVersion(dir) === currentVersion)
  if (rollbackIndex === -1) {
    console.log('nothing to rollback')
    return
  }

  const rollbackDir = migrationDirs[rollbackIndex]
  const rollbackVersion =
    rollbackIndex === 0 ? '0' : dirToVersion(migrationDirs[rollbackIndex - 1])
  await runRollback(config, env, rollbackDir, rollbackVersion)
}

export function create(name: string, config: Config) {
  const { migrationDir } = config
  const subDir = formatDate(new Date(), 'YYYYMMDD-HHmmSS') + '-' + name
  const dir = path.join(migrationDir, subDir)
  mkdirp.sync(dir)
  touch(path.join(dir, 'up.sql'))
  touch(path.join(dir, 'down.sql'))
  console.log(`created migration at: ${dir}`)
}

export async function main() {
  const config: Config = {
    command: 'mysql',
    migrationDir: 'migrations',
    env: undefined,
    passwordFromEnv: undefined,
    passwordToEnv: undefined,
    database: UNDEFINED_DATABASE,
  }
  const explorer = cosmiconfig('damaged-captain')

  const result = await explorer.search()
  if (!result) {
    throw new Error('must supply damaged-captain config file')
  }

  process.chdir(path.dirname(result.filepath))
  Object.assign(config, result.config)

  try {
    yargs
      .strict()
      .command(['create <name>', 'c'], 'create migration', {}, ({ name }) => {
        create(name as string, config)
      })
      .command(['migrate', 'm'], 'migrate to latest', {}, async () => {
        await migrate(config)
        await buildTypes(config)
      })
      .command(['rollback', 'ro'], 'rollback latest migration', {}, async () => {
        await rollback(config)
        await buildTypes(config)
      })
      .command(['redo', 're'], 'redo latest migration', {}, async () => {
        await rollback(config)
        await migrate(config)
        await buildTypes(config)
      })
      .command(['types', 't'], 'generate types from database', {}, async () => {
        if (!config.outputTypes) {
          console.warn('must add `outputTypes` config element to output types')
        } else {
          await buildTypes(config)
        }
      })
      .demandCommand()
      .help().argv
  } catch (e) {
    die(e)
  }
}

function die(error: Error) {
  console.warn(error.message)
  process.exit(1)
}
