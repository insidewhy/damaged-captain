import { spawn, ChildProcess } from 'child_process'

export function spawnClient(command: string, args: string[], stdoutPipe?: boolean) {
  return spawn(command, args, { stdio: ['pipe', stdoutPipe ? 'pipe' : 'inherit', 'inherit'] })
}

export function endClient(process: ChildProcess, getError?: () => Error): Promise<string> {
  process.stdin!.end()
  let output = ''
  if (process.stdout) {
    process.stdout.on('data', data => {
      output += data
    })
  }

  return new Promise((resolve, reject) => {
    process.on('exit', code => {
      if (code) {
        reject(getError ? getError() : new Error('failed'))
      } else {
        resolve(output)
      }
    })
  })
}

