export interface Config {
  command: string
  migrationDir: string
  database: string
  outputTypes?: string | undefined
  outputInterfacePrefix?: string | undefined
  env?: string | undefined
  passwordFromEnv?: string | undefined
  passwordToEnv?: string | undefined
}

