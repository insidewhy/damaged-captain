import { ChildProcess } from 'child_process'
import camelCase from 'camelcase'

import { spawnClient, endClient } from './db-client'
import { writeFileSync } from 'fs'

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
  return dbName
}

function buildOutputSource(tables: OutputTable[]) {
  return tables
    .map(table => {
      return (
        `export class ${table.name} {\n` +
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

export async function buildTypes(command: string, dbName: string, outputPath?: string) {
  if (!outputPath) return
  const listTablesProc = spawnClient(command, ['-b', dbName], true)
  listTablesProc.stdin!.write('show tables;')
  const tableRows = (await endBatch(listTablesProc)).filter(t => t[0] !== 'db_version')

  const outputTables: OutputTable[] = []

  for (const [tableName] of tableRows) {
    const getColumnsProc = spawnClient(command, ['-b', dbName], true)
    getColumnsProc.stdin!.write(`describe ${tableName};`)
    const columnRows = await endBatch(getColumnsProc)
    const outputTable = {
      name: camelCase(dbNameToTypeScriptName(tableName), { pascalCase: true }),
      columns: columnRows.map(column => columnToSource(column)),
    }
    outputTables.push(outputTable)
  }

  const src = buildOutputSource(outputTables)
  writeFileSync(outputPath, src)
}
