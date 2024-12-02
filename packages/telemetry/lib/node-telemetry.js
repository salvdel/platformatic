'use strict'
const process = require('node:process')
const opentelemetry = require('@opentelemetry/sdk-node')
const { Resource } = require('@opentelemetry/resources')
const FileSpanExporter = require('./file-span-exporter')
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions')
const { workerData } = require('node:worker_threads')
const { resolve } = require('node:path')
const { tmpdir } = require('node:os')
const logger = require('abstract-logging')
const { statSync, readFileSync } = require('node:fs') // We want to have all this synch
const util = require('node:util')
const debuglog = util.debuglog('@platformatic/telemetry')
const {
  ConsoleSpanExporter,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} = require('@opentelemetry/sdk-trace-base')

const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg')
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http')
const {
  UndiciInstrumentation,
} = require('@opentelemetry/instrumentation-undici')

// See: https://www.npmjs.com/package/@opentelemetry/instrumentation-http
// When this is fixed we should set this to 'http' and fixe the tests
// https://github.com/open-telemetry/opentelemetry-js/issues/5103
process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'http/dup'

const setupNodeHTTPTelemetry = (opts) => {
  const { serviceName } = opts

  let exporter = opts.exporter
  if (!exporter) {
    logger.warn('No exporter configured, defaulting to console.')
    exporter = { type: 'console' }
  }
  const exporters = Array.isArray(exporter) ? exporter : [exporter]
  const spanProcessors = []
  for (const exporter of exporters) {
    // Exporter config:
    // https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_exporter_zipkin.ExporterConfig.html
    const exporterOptions = { ...exporter.options, serviceName }

    let exporterObj
    if (exporter.type === 'console') {
      exporterObj = new ConsoleSpanExporter(exporterOptions)
    } else if (exporter.type === 'otlp') {
      const {
        OTLPTraceExporter,
      } = require('@opentelemetry/exporter-trace-otlp-proto')
      exporterObj = new OTLPTraceExporter(exporterOptions)
    } else if (exporter.type === 'zipkin') {
      const { ZipkinExporter } = require('@opentelemetry/exporter-zipkin')
      exporterObj = new ZipkinExporter(exporterOptions)
    } else if (exporter.type === 'memory') {
      exporterObj = new InMemorySpanExporter()
    } else if (exporter.type === 'file') {
      exporterObj = new FileSpanExporter(exporterOptions)
    } else {
      logger.warn(
        `Unknown exporter type: ${exporter.type}, defaulting to console.`
      )
      exporterObj = new ConsoleSpanExporter(exporterOptions)
    }

    // We use a SimpleSpanProcessor for the console/memory exporters and a BatchSpanProcessor for the others.
    // (these are the ones used by tests)
    const spanProcessor = ['memory', 'console', 'file'].includes(exporter.type)
      ? new SimpleSpanProcessor(exporterObj)
      : new BatchSpanProcessor(exporterObj)
    spanProcessors.push(spanProcessor)
  }

  const sdk = new opentelemetry.NodeSDK({
    spanProcessors, // https://github.com/open-telemetry/opentelemetry-js/issues/4881#issuecomment-2358059714
    instrumentations: [
      new UndiciInstrumentation(),
      new HttpInstrumentation(),
      new PgInstrumentation(),
    ],
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName
    })
  })
  sdk.start()

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => debuglog('Tracing terminated'))
      .catch((error) => debuglog('Error terminating tracing', error))
  })
}

let data = null
const useWorkerData = !!workerData

if (useWorkerData) {
  data = workerData
} else if (process.env.PLT_MANAGER_ID) {
  try {
    const dataPath = resolve(tmpdir(), 'platformatic', 'runtimes', `${process.env.PLT_MANAGER_ID}.json`)
    statSync(dataPath)
    const jsonData = JSON.parse(readFileSync(dataPath, 'utf8'))
    data = jsonData.data
    debuglog(`Loaded data from ${dataPath}`)
  } catch (e) {
    debuglog('Error reading data from file %o', e)
  }
}

if (data) {
  debuglog('Setting up telemetry %o', data)
  const telemetryConfig = useWorkerData ? data?.serviceConfig?.telemetry : data?.telemetryConfig
  if (telemetryConfig) {
    debuglog('telemetryConfig %o', telemetryConfig)
    setupNodeHTTPTelemetry(telemetryConfig)
  }
}