import { ChildProcess } from 'child_process'
import { writeFileSync } from 'fs'
import camelCase from 'camelcase'
import * as pluralize from 'pluralize'

import { spawnClient, endClient } from './db-client'
import { Config } from './config'

async function endBatch(proc: ChildProcess): Promise<string[][]> {
  const output = await endClient(proc)
  return output
    .trimRight()
    .split('\n')
    .slice(1)
    .map(row => row.split('\t'))
}

interface OutputTable {
  name: string
  columns: string[][]
}

const typeMap: { [k: string]: string | undefined } = {
  varchar: 'string',
  longtext: 'string',
  bigint: 'string',
  tinyint: 'number',
  double: 'number',
  datetime: 'string',
}

function columnToSource(columnRow: string[]) {
  const columnName = columnRow[0]
  const dbType = columnRow[1].replace(/\(.*/, '')

  // console.log(dbType)
  const outputType = typeMap[dbType] || 'string'

  const sourceString = `${columnName}: ${outputType}`
  if (dbType === 'bigint') {
    return ['// type is bigint', sourceString]
  } else {
    return [sourceString]
  }
}

function dbNameToTypeScriptName(dbName: string) {
  return camelCase(pluralize(dbName, 1), { pascalCase: true })
}

function buildOutputSource(tables: OutputTable[], outputInterfacePrefix: string = '') {
  return tables
    .map(table => {
      return (
        `export interface ${outputInterfacePrefix}${table.name} {\n` +
        table.columns
          .map(column => {
            return column.map(sourceLine => `  ${sourceLine}\n`).join('')
          })
          .join('') +
        '}\n'
      )
    })
    .join('\n')
}

export async function buildTypes(config: Config) {
  const { command, database, outputTypes: outputPath } = config
  if (!outputPath) return
  const listTablesProc = spawnClient(command, ['-b', database], true)
  listTablesProc.stdin!.write('show tables;')
  const tableRows = (await endBatch(listTablesProc)).filter(t => t[0] !== 'db_version')

  const outputTables: OutputTable[] = []

  for (const [tableName] of tableRows) {
    const getColumnsProc = spawnClient(command, ['-b', database], true)
    getColumnsProc.stdin!.write(`describe ${tableName};`)
    const columnRows = await endBatch(getColumnsProc)
    const outputTable = {
      name: dbNameToTypeScriptName(tableName),
      columns: columnRows.map(column => columnToSource(column)),
    }
    outputTables.push(outputTable)
  }

  const src = buildOutputSource(outputTables, config.outputInterfacePrefix)
  writeFileSync(outputPath, src)
}
