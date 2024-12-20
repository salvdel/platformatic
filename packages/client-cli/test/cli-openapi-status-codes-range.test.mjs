import { isFileAccessible } from '../cli.mjs'
import { moveToTmpdir } from './helper.js'
import { test, after } from 'node:test'
import { equal, ok } from 'node:assert'
import { join } from 'path'
import * as desm from 'desm'
import { execa } from 'execa'
import { promises as fs } from 'fs'
import { readFile } from 'fs/promises'

test('status-codes-range', async () => {
  const openapi = desm.join(import.meta.url, 'fixtures', 'status-codes-range', 'openapi.json')
  const dir = await moveToTmpdir(after)

  const pltServiceConfig = {
    $schema: 'https://schemas.platformatic.dev/@platformatic/service/1.52.0.json',
    server: {
      hostname: '127.0.0.1',
      port: 0,
    },
    plugins: {
      paths: ['./plugin.js'],
    },
  }

  await fs.writeFile('./platformatic.service.json', JSON.stringify(pltServiceConfig, null, 2))

  await execa('node', [desm.join(import.meta.url, '..', 'cli.mjs'), openapi, '--name', 'full', '--validate-response', '--optional-headers', 'headerId', '--full'])

  equal(await isFileAccessible(join(dir, 'full', 'full.cjs')), false)

  const typeFile = join(dir, 'full', 'full.d.ts')
  const data = await readFile(typeFile, 'utf-8')
  ok(data.includes("import { type GetHeadersOptions, type StatusCode1xx, type StatusCode2xx, type StatusCode3xx, type StatusCode4xx, type StatusCode5xx } from '@platformatic/client'"))
  ok(data.includes(`
  export type GetMartello2XXResponse = unknown
  export type GetMartelloResponses =
    FullResponse<GetMartello2XXResponse, StatusCode2xx>`))
})
