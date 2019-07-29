import * as yargs from 'yargs'
import * as path from 'path'
import * as cosmiconfig from 'cosmiconfig'
import * as mkdirp from 'mkdirp'
import { format as formatDate } from 'date-fns'
import { closeSync, openSync } from 'fs'

interface Config {
  command: string
  migrationDir: string
}

function touch(path: string) {
  closeSync(openSync(path, 'w'))
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
  const config: Config = { command: 'mysql', migrationDir: 'migrations' }
  const explorer = cosmiconfig('damaged-captain')

  const result = await explorer.search()
  if (result) {
    process.chdir(path.dirname(result.filepath))
    Object.assign(config, result.config)
  }

  yargs
    .strict()
    .command(['create <name>', 'c'], 'create migration', {}, ({ name }) => {
      create(name as string, config)
    })
    .demandCommand()
    .help().argv
}
