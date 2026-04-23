const express = require("express")
const mysql = require("mysql2")
const cors = require("cors")
const path = require("path")

const {
  createAtc3000ModbusReader,
  buildTrackedParamValues,
} = require("./atc3000-modbus")

const app = express()

const DATA_SOURCE = String(process.env.DATA_SOURCE || "ATC3000").toUpperCase()
const ATC3000_HOST = process.env.ATC3000_HOST ?? process.env.ATC_MODBUS_HOST ?? "192.168.100.99"
const ATC3000_PORT = Number(process.env.ATC3000_PORT ?? process.env.ATC_MODBUS_PORT ?? 502)
const ATC3000_SLAVE_ID = Number(process.env.ATC3000_SLAVE_ID ?? process.env.ATC_MODBUS_SLAVE_ID ?? 2)
const ATC3000_TIMEOUT_MS = Number(process.env.ATC3000_TIMEOUT_MS ?? process.env.MODBUS_TIMEOUT_MS ?? 4000)
const ATC3000_WORD_SWAP = process.env.ATC3000_WORD_SWAP ?? process.env.ATC_MODBUS_WORD_SWAP ?? "auto"
const TRACKED_TAGS = [
  "pm139Status",
  "pm139KWH",
  "pm139AR",
  "pm139P",
  "pm139App",
  "pm139VAN",
  "pm139F",
] 
const WEEK_DAYS = 7
const RETENTION_DAYS = 14
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000
const PARAM_POLL_INTERVAL_MS = Number(process.env.PARAM_POLL_INTERVAL_MS ?? 5 * 1000)
const PARAM_FETCH_RETRY_DELAY_MS = 1500
const PARAM_FETCH_MAX_ATTEMPTS = 2
const PARAM_STALE_THRESHOLD_MS = PARAM_POLL_INTERVAL_MS * 3
const HEALTHCHECK_DB_TIMEOUT_MS = 5 * 1000
const SHUTDOWN_FORCE_EXIT_MS = 10 * 1000
const REPORT_TIME_ZONE = "Asia/Jakarta"
const CO2E_PER_KWH_KG = 0.85
const KWH_TARIFF = 1444.7

const latestParamSnapshot = {
  values: [],
  updatedAt: null,
}
const slotLogState = {
  lastPersistedSlotKey: null,
}
let isParamPolling = false
let isSweepingOldLogs = false
let isShuttingDown = false
let shutdownPromise = null
let paramPollTimer = null
let retentionTimer = null
let httpServer = null

const atc3000Reader = createAtc3000ModbusReader({
  host: ATC3000_HOST,
  port: ATC3000_PORT,
  slaveId: ATC3000_SLAVE_ID,
  timeoutMs: ATC3000_TIMEOUT_MS,
  wordSwapMode: ATC3000_WORD_SWAP,
})

const paramPollingState = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  consecutiveFailures: 0,
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toLogLevelMethod = (level) => {
  if (level === "error") return "error"
  if (level === "warn") return "warn"
  return "log"
}

const normalizeError = (error) => {
  if (!error) {
    return { message: "unknown error" }
  }

  if (typeof error === "string") {
    return { message: error }
  }

  const normalized = {
    name: error.name,
    message: error.message ?? String(error),
    code: error.code,
    errno: error.errno,
    syscall: error.syscall,
    address: error.address,
    port: error.port,
    status: error.status,
    statusCode: error.statusCode,
    sqlState: error.sqlState,
    sqlMessage: error.sqlMessage,
  }

  if (error.cause?.code) {
    normalized.causeCode = error.cause.code
  }
  if (error.cause?.message) {
    normalized.causeMessage = error.cause.message
  }
  if (error.stack) {
    normalized.stack = error.stack
  }

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined))
}

const logEvent = (scope, level, message, details = null) => {
  const timestamp = new Date().toISOString()
  const method = toLogLevelMethod(level)
  const suffix =
    details && Object.keys(details).length
      ? ` ${JSON.stringify(details)}`
      : ""
  console[method](`[${scope}][${timestamp}][${level}] ${message}${suffix}`)
}

const logInfo = (scope, message, details) => {
  logEvent(scope, "info", message, details)
}

const logWarn = (scope, message, details) => {
  logEvent(scope, "warn", message, details)
}

const logError = (scope, message, details) => {
  logEvent(scope, "error", message, details)
}

const formatPollingError = (error) => {
  if (!error) return "unknown error"

  const causeCode = error.cause?.code
  if (causeCode) {
    return `${error.message} (cause: ${causeCode})`
  }

  return error.message ?? String(error)
}

const isTransientPollingError = (error) => {
  if (!error) return false

  const causeCode = error.cause?.code
  return (
    error.name === "TimeoutError" ||
    causeCode === "UND_ERR_SOCKET" ||
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "ECONNRESET" ||
    causeCode === "ETIMEDOUT" ||
    error.code === "ECONNREFUSED" ||
    error.code === "EHOSTUNREACH" ||
    error.code === "ENETUNREACH" ||
    error.code === "EPIPE"
  )
}

const getParamSnapshotAgeMs = () => {
  if (!latestParamSnapshot.updatedAt) return null
  return Date.now() - new Date(latestParamSnapshot.updatedAt).getTime()
}

const isParamSnapshotStale = () => {
  const ageMs = getParamSnapshotAgeMs()
  return ageMs !== null && ageMs > PARAM_STALE_THRESHOLD_MS
}

const withTimeout = (promise, timeoutMs, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })

const checkPoolHealth = async (pool, label) => {
  try {
    await withTimeout(
      pool.promise().query("SELECT 1 AS ok"),
      HEALTHCHECK_DB_TIMEOUT_MS,
      `${label} health check`,
    )
    return { status: "up" }
  } catch (error) {
    return {
      status: "down",
      error: formatPollingError(error),
    }
  }
}

const closePool = async (pool, label) => {
  try {
    await pool.promise().end()
    logLifecycle(`${label} pool closed`)
  } catch (error) {
    logError("lifecycle", `failed to close ${label} pool`, {
      label,
      error: normalizeError(error),
    })
  }
}

const closeAtc3000 = async () => {
  try {
    atc3000Reader.close()
    logLifecycle("atc3000 modbus client closed")
  } catch (error) {
    logError("lifecycle", "failed to close atc3000 modbus client", {
      error: normalizeError(error),
    })
  }
}

const runLoggedQuery = async (pool, scope, operation, sql, params = [], context = {}) => {
  try {
    return await pool.promise().query(sql, params)
  } catch (error) {
    logError(scope, `${operation} failed`, {
      operation,
      ...context,
      error: normalizeError(error),
    })
    throw error
  }
}

app.use(cors())
app.use(express.json())
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    next()
    return
  }

  const startedAt = Date.now()

  res.on("finish", () => {
    if (res.statusCode < 400) return

    const details = {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    }

    if (res.statusCode >= 500) {
      logError("api", "request completed with server error", details)
      return
    }

    logWarn("api", "request completed with client error", details)
  })

  res.on("close", () => {
    if (res.writableEnded) return

    logWarn("api", "request aborted before response completed", {
      method: req.method,
      path: req.originalUrl,
      durationMs: Date.now() - startedAt,
    })
  })

  next()
})

// koneksi database
const dbConfig = {
  host: "localhost",
  user: "root",
  password: "",
}

const createPool = (database) =>
  mysql.createPool({
    ...dbConfig,
    database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  })

const db = createPool("ewon")
const logsDb = createPool("ewon-logs")

const connectTo = (pool, scope, name) => {
  pool.getConnection((err, connection) => {
    if (connection) {
      connection.release()
    }
    if (err) {
      logError(scope, `${name} connection failed`, {
        database: name,
        error: normalizeError(err),
      })
      return
    }
    logInfo(scope, `${name} connected`, { database: name })
  })
}

connectTo(db, "db-main", "ewon")
connectTo(logsDb, "db-write", "ewon-logs")

const getSlotBucketKey = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  })
  const parts = {}
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== "literal") {
      parts[part.type] = part.value
    }
  })
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:00`
}

const getLatestLoggedSlotKey = async () => {
  const [[{ latest }]] = await runLoggedQuery(
    logsDb,
    "db-write",
    "select latest slot log",
    "SELECT MAX(created_at) AS latest FROM ewon_tag_logs WHERE tag_name IN (?)",
    [TRACKED_TAGS],
    {
      database: "ewon-logs",
      tagCount: TRACKED_TAGS.length,
    },
  )

  return latest ? getSlotBucketKey(new Date(latest), REPORT_TIME_ZONE) : null
}

const logParamValues = async (params) => {
  if (!params?.length) return
  const filtered = params
    .filter((param) => TRACKED_TAGS.includes(param.TagName))
    .map((param) => [param.TagName, param.Value])

  if (!filtered.length) return

  const currentSlotKey = getSlotBucketKey(new Date(), REPORT_TIME_ZONE)
  if (slotLogState.lastPersistedSlotKey === currentSlotKey) return

  const latestLoggedSlotKey = await getLatestLoggedSlotKey()
  if (latestLoggedSlotKey === currentSlotKey) {
    slotLogState.lastPersistedSlotKey = currentSlotKey
    return
  }

  await runLoggedQuery(
    logsDb,
    "db-write",
    "insert ewon_tag_logs",
    "INSERT INTO ewon_tag_logs (tag_name, value) VALUES ?",
    [filtered],
    {
      database: "ewon-logs",
      slotBucket: currentSlotKey,
      rowCount: filtered.length,
      tags: filtered.map(([tagName]) => tagName),
    },
  )

  slotLogState.lastPersistedSlotKey = currentSlotKey
}

const refreshParamSnapshot = async () => {
  let lastError = null

  for (let attempt = 1; attempt <= PARAM_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const startedAt = Date.now()

      if (DATA_SOURCE !== "ATC3000") {
        throw new Error(`unsupported DATA_SOURCE: ${DATA_SOURCE}`)
      }

      const snapshot = await atc3000Reader.readSnapshot()
      const data = buildTrackedParamValues(TRACKED_TAGS, snapshot.metrics)

      latestParamSnapshot.values = data
      latestParamSnapshot.updatedAt = new Date().toISOString()
      paramPollingState.lastSuccessAt = latestParamSnapshot.updatedAt
      paramPollingState.lastErrorMessage = null
      paramPollingState.consecutiveFailures = 0
      logInfo("atc3000-modbus", "param snapshot refreshed", {
        source: DATA_SOURCE,
        host: ATC3000_HOST,
        port: ATC3000_PORT,
        slaveId: ATC3000_SLAVE_ID,
        entryCount: data.length,
        durationMs: Date.now() - startedAt,
        updatedAt: latestParamSnapshot.updatedAt,
      })

      try {
        await logParamValues(data)
      } catch (error) {
        logWarn("atc3000-modbus", "snapshot fetched but database write failed", {
          updatedAt: latestParamSnapshot.updatedAt,
          entryCount: data.length,
          error: normalizeError(error),
        })
      }

      return
    } catch (error) {
      lastError = error

      if (attempt >= PARAM_FETCH_MAX_ATTEMPTS || !isTransientPollingError(error)) {
        throw error
      }

      logWarn("atc3000-modbus", "transient polling failure, retrying", {
        source: DATA_SOURCE,
        host: ATC3000_HOST,
        port: ATC3000_PORT,
        slaveId: ATC3000_SLAVE_ID,
        attempt,
        maxAttempts: PARAM_FETCH_MAX_ATTEMPTS,
        retryDelayMs: PARAM_FETCH_RETRY_DELAY_MS,
        error: normalizeError(error),
      })
      await sleep(PARAM_FETCH_RETRY_DELAY_MS)
    }
  }

  throw lastError
}

const startParamPolling = () => {
  const runner = () => {
    if (isShuttingDown) return

    if (isParamPolling) {
      logWarn("atc3000-modbus", "polling skipped because previous fetch is still running", {
        intervalMs: PARAM_POLL_INTERVAL_MS,
      })
      return
    }

    isParamPolling = true
    refreshParamSnapshot()
      .catch((error) => {
        paramPollingState.lastErrorAt = new Date().toISOString()
        paramPollingState.lastErrorMessage = formatPollingError(error)
        paramPollingState.consecutiveFailures += 1
        logError("atc3000-modbus", "param polling failed", {
          source: DATA_SOURCE,
          host: ATC3000_HOST,
          port: ATC3000_PORT,
          slaveId: ATC3000_SLAVE_ID,
          consecutiveFailures: paramPollingState.consecutiveFailures,
          lastErrorAt: paramPollingState.lastErrorAt,
          error: normalizeError(error),
        })
      })
      .finally(() => {
        isParamPolling = false
      })
  }
  runner()
  return setInterval(runner, PARAM_POLL_INTERVAL_MS)
}

paramPollTimer = startParamPolling()

const sweepOldLogs = async () => {
  if (isShuttingDown || isSweepingOldLogs) return

  isSweepingOldLogs = true
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const [result] = await runLoggedQuery(
      logsDb,
      "db-write",
      "delete old ewon_tag_logs",
      "DELETE FROM ewon_tag_logs WHERE created_at < ?",
      [cutoff],
      {
        database: "ewon-logs",
        retentionDays: RETENTION_DAYS,
        cutoff: cutoff.toISOString(),
      },
    )
    logInfo("db-write", "old log sweep completed", {
      database: "ewon-logs",
      deletedRows: result.affectedRows ?? 0,
      cutoff: cutoff.toISOString(),
    })
  } catch (error) {
    logError("db-write", "failed to sweep old logs", {
      database: "ewon-logs",
      retentionDays: RETENTION_DAYS,
      error: normalizeError(error),
    })
  } finally {
    isSweepingOldLogs = false
  }
}

void sweepOldLogs()
retentionTimer = setInterval(() => {
  void sweepOldLogs()
}, RETENTION_INTERVAL_MS)

/* ======================
   API ENDPOINT
====================== */

// list panel
app.get("/api/panels", async (req, res) => {
  try {
    const [result] = await runLoggedQuery(
      db,
      "db-main",
      "select panels",
      "SELECT id, tagname, tagdesc FROM tagmst",
      [],
      {
        route: "/api/panels",
        database: "ewon",
      },
    )

    res.json(result)
  } catch (error) {
    res.status(500).json({ message: "Tidak dapat mengambil data panel" })
  }
})

// realtime tag
app.get("/api/realtime", async (req, res) => {
  if (DATA_SOURCE === "ATC3000") {
    if (!latestParamSnapshot.values.length) {
      return res.status(503).json({ message: "Data realtime belum siap dari ATC 3000 (Modbus)" })
    }

    const created = latestParamSnapshot.updatedAt ?? new Date().toISOString()
    return res.json(
      latestParamSnapshot.values.map((param) => ({
        tagname: param.TagName,
        tagvalue: param.Value,
        created,
      })),
    )
  }

  try {
    const [result] = await runLoggedQuery(
      db,
      "db-main",
      "select realtime tags",
      "SELECT tagname,tagvalue,created FROM monitoring_tags",
      [],
      {
        route: "/api/realtime",
        database: "ewon",
      },
    )

    res.json(result)
  } catch (error) {
    res.status(500).json({ message: "Tidak dapat mengambil data realtime" })
  }
})

// history power
app.get("/api/history/:tag", async (req, res) => {
  const tag = req.params.tag

  if (DATA_SOURCE === "ATC3000") {
    if (!TRACKED_TAGS.some((tracked) => tracked.toLowerCase() === String(tag).toLowerCase())) {
      return res.status(404).json({ message: "Tag tidak ditemukan" })
    }

    try {
      const [result] = await runLoggedQuery(
        logsDb,
        "db-write",
        "select modbus tag history",
        "SELECT created_at AS created, value AS tagvalue FROM ewon_tag_logs WHERE tag_name = ? ORDER BY created_at DESC LIMIT 200",
        [tag],
        {
          route: "/api/history/:tag",
          database: "ewon-logs",
          tag,
        },
      )

      return res.json(result)
    } catch (error) {
      return res.status(500).json({ message: "Tidak dapat mengambil history tag" })
    }
  }

  try {
    const [result] = await runLoggedQuery(
      db,
      "db-main",
      "select tag history",
      "SELECT created,tagvalue FROM datamin WHERE tagname=? ORDER BY created DESC LIMIT 200",
      [tag],
      {
        route: "/api/history/:tag",
        database: "ewon",
        tag,
      },
    )

    res.json(result)
  } catch (error) {
    res.status(500).json({ message: "Tidak dapat mengambil history tag" })
  }
})

app.get("/api/param-values", (req, res) => {
  if (!latestParamSnapshot.values.length) {
    logWarn("api", "param values requested before first snapshot was ready", {
      method: req.method,
      path: req.originalUrl,
      paramStatus: paramPollingState.lastErrorMessage ? "error" : "starting",
      lastErrorAt: paramPollingState.lastErrorAt,
      lastErrorMessage: paramPollingState.lastErrorMessage,
    })
    return res.status(503).json({
      message: "Data param belum tersedia, sedang mencoba mengambil dari ATC 3000 (Modbus)",
    })
  }

  if (latestParamSnapshot.updatedAt) {
    res.setHeader("X-Param-Updated-At", latestParamSnapshot.updatedAt)
  }
  res.setHeader("X-Param-Stale", String(isParamSnapshotStale()))

  res.json(latestParamSnapshot.values)
})

app.get("/api/health", async (req, res) => {
  const [mainDb, logsDbHealth] = await Promise.all([
    checkPoolHealth(db, "main database"),
    checkPoolHealth(logsDb, "logs database"),
  ])

  const snapshotAgeMs = getParamSnapshotAgeMs()
  const snapshotStale = isParamSnapshotStale()
  const paramStatus = !latestParamSnapshot.updatedAt
    ? "starting"
    : snapshotStale || paramPollingState.consecutiveFailures > 0
      ? "degraded"
      : "up"
  const overallStatus =
    mainDb.status === "up" &&
    logsDbHealth.status === "up" &&
    (paramStatus === "up" || paramStatus === "starting")
      ? "ok"
      : "degraded"

  if (overallStatus !== "ok") {
    logWarn("api", "health check reported degraded status", {
      method: req.method,
      path: req.originalUrl,
      overallStatus,
      paramStatus,
      mainDb,
      logsDb: logsDbHealth,
    })
  }

  res.status(overallStatus === "ok" ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    shuttingDown: isShuttingDown,
    dataSource: DATA_SOURCE,
    atc3000: {
      host: ATC3000_HOST,
      port: ATC3000_PORT,
      slaveId: ATC3000_SLAVE_ID,
      timeoutMs: ATC3000_TIMEOUT_MS,
      wordSwap: String(ATC3000_WORD_SWAP),
    },
    paramPolling: {
      status: paramStatus,
      updatedAt: latestParamSnapshot.updatedAt,
      ageMs: snapshotAgeMs,
      stale: snapshotStale,
      consecutiveFailures: paramPollingState.consecutiveFailures,
      lastSuccessAt: paramPollingState.lastSuccessAt,
      lastErrorAt: paramPollingState.lastErrorAt,
      lastErrorMessage: paramPollingState.lastErrorMessage,
    },
    databases: {
      main: mainDb,
      logs: logsDbHealth,
    },
  })
})

const DAY_MS = 24 * 60 * 60 * 1000

const formatDayLabel = (date, timeZone) =>
  new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    timeZone,
  }).format(date)

const getTimeZoneParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const parts = {}
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value)
    }
  })
  return parts
}

const getTimeZoneOffsetMs = (timestamp, timeZone) => {
  const parts = getTimeZoneParts(new Date(timestamp), timeZone)
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - timestamp
  )
}

const getTimeZoneDayStartMs = (year, month, day, timeZone) => {
  const reference = Date.UTC(year, month - 1, day, 12, 0, 0)
  const offset = getTimeZoneOffsetMs(reference, timeZone)
  return Date.UTC(year, month - 1, day, 0, 0, 0) - offset
}

const formatPartsToDate = (parts) =>
  `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(
    2,
    "0",
  )}`

const normalizeDailyConsumption = (startValue, endValue) => {
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return null
  return Number(Math.max(0, endValue - startValue).toFixed(3))
}

const buildWeeklyResponse = (statRows, coverageRows, anchorTimestamp) => {
  const anchorDate = new Date(anchorTimestamp)
  const anchorParts = getTimeZoneParts(anchorDate, REPORT_TIME_ZONE)
  const anchorMidnight = getTimeZoneDayStartMs(
    anchorParts.year,
    anchorParts.month,
    anchorParts.day,
    REPORT_TIME_ZONE,
  )
  const startTimestamp = anchorMidnight - (WEEK_DAYS - 1) * DAY_MS
  const dayMap = new Map()
  for (let i = 0; i < WEEK_DAYS; i += 1) {
    const timestamp = startTimestamp + i * DAY_MS
    const date = new Date(timestamp)
    const parts = getTimeZoneParts(date, REPORT_TIME_ZONE)
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
      parts.day,
    ).padStart(2, "0")}`
    dayMap.set(key, {
      date: key,
      label: formatDayLabel(date, REPORT_TIME_ZONE),
      displayParts: parts,
      displayReferenceTime: date.getTime(),
      stats: {},
      slotCountMap: new Map(),
    })
  }

  statRows.forEach((row) => {
    const day = dayMap.get(row.day_key)
    if (!day) return

    const tag = row.tag_name
    if (!TRACKED_TAGS.includes(tag)) return

    const tagStats = day.stats[tag] ?? {
      count: 0,
      sum: 0,
      min: null,
      max: null,
      firstValue: null,
      lastValue: null,
      lastTime: 0,
    }

    tagStats.count = Number(row.sample_count ?? 0)
    tagStats.sum = Number(row.sum_value ?? 0)
    tagStats.min = row.min_value !== null ? Number(row.min_value) : null
    tagStats.max = row.max_value !== null ? Number(row.max_value) : null
    tagStats.firstValue = row.first_reading !== null ? Number(row.first_reading) : null
    tagStats.lastValue = row.last_reading !== null ? Number(row.last_reading) : null
    tagStats.lastTime = row.last_time ? new Date(row.last_time).getTime() : 0

    day.stats[tag] = tagStats
  })

  coverageRows.forEach((row) => {
    const day = dayMap.get(row.day_key)
    if (!day) return

    day.slotCountMap.set(Number(row.hour_key), Number(row.tag_count ?? 0))
  })

  const getExpectedSlotsForDateKey = (dateKey) => {
    // Coverage mingguan dihitung terhadap 24 jam penuh untuk setiap hari.
    // Hari yang sedang berjalan tetap harus terlihat sebagai hari yang belum lengkap,
    // bukan "100%" hanya karena jam yang sudah lewat baru sebagian.
    const totalSlotsPerDay = 24
    return totalSlotsPerDay
  }

  const week = Array.from(dayMap.values()).map((day) => ({
    date: day.date,
    label: day.label,
    displayDate: formatPartsToDate(
      day.displayParts ??
        getTimeZoneParts(
          new Date(`${day.date}T00:00:00Z`),
          REPORT_TIME_ZONE,
        ),
    ),
    stats: TRACKED_TAGS.reduce((acc, tag) => {
      const entry = day.stats[tag]
      const avg =
        entry && entry.count ? Number((entry.sum / entry.count).toFixed(4)) : null
      acc[tag] = {
        avg,
        last: entry?.lastValue ?? null,
        min: entry?.min ?? null,
        max: entry?.max ?? null,
      }
      return acc
    }, {}),
    consumptionKwh: (() => {
      const entry = day.stats.pm139KWH
      return normalizeDailyConsumption(entry?.firstValue ?? null, entry?.lastValue ?? null)
    })(),
    costEstimateIdr: (() => {
      const entry = day.stats.pm139KWH
      const consumptionKwh = normalizeDailyConsumption(entry?.firstValue ?? null, entry?.lastValue ?? null)
      return consumptionKwh == null ? null : Number((consumptionKwh * KWH_TARIFF).toFixed(2))
    })(),
    coverage: (() => {
      const expectedHours = getExpectedSlotsForDateKey(day.date)
      let observedHours = 0
      day.slotCountMap.forEach((tagCount) => {
        if (tagCount > 0) observedHours += 1
      })

      const completeHours = Math.min(expectedHours, observedHours)
      const missingHours = Math.max(0, expectedHours - completeHours)
      const progress = expectedHours
        ? Math.round(Math.min(100, (completeHours / expectedHours) * 100))
        : 0

      return {
        expectedHours,
        loggedHours: Math.min(expectedHours, observedHours),
        completeHours,
        missingHours,
        progress,
        hasLoss: missingHours > 0,
      }
    })(),
  }))

  return { tags: TRACKED_TAGS, week }
}

app.get("/api/logs/weekly", async (req, res) => {
  const now = new Date()
  try {
    const todayParts = getTimeZoneParts(now, REPORT_TIME_ZONE)
    const todayMidnight = getTimeZoneDayStartMs(
      todayParts.year,
      todayParts.month,
      todayParts.day,
      REPORT_TIME_ZONE,
    )
    const todayEnd = todayMidnight + DAY_MS - 1
    const anchorTimestamp = Math.min(now.getTime(), todayEnd)
    const anchorDate = new Date(anchorTimestamp)
    const anchorParts = getTimeZoneParts(anchorDate, REPORT_TIME_ZONE)
    const anchorMidnight = getTimeZoneDayStartMs(
      anchorParts.year,
      anchorParts.month,
      anchorParts.day,
      REPORT_TIME_ZONE,
    )
    const listStart = new Date(anchorMidnight - (WEEK_DAYS - 1) * DAY_MS)
    const listEnd = new Date(anchorMidnight + DAY_MS)

    const [statRows, coverageRows] = await Promise.all([
      runLoggedQuery(
        logsDb,
        "db-write",
        "select weekly summary stats",
        `
          SELECT
            DATE_FORMAT(created_at, '%Y-%m-%d') AS day_key,
            tag_name,
            COUNT(*) AS sample_count,
            SUM(value) AS sum_value,
            MIN(value) AS min_value,
            MAX(value) AS max_value,
            SUBSTRING_INDEX(GROUP_CONCAT(value ORDER BY created_at SEPARATOR ','), ',', 1) AS first_reading,
            SUBSTRING_INDEX(GROUP_CONCAT(value ORDER BY created_at SEPARATOR ','), ',', -1) AS last_reading,
            MAX(created_at) AS last_time
          FROM ewon_tag_logs
          WHERE tag_name IN (?) AND created_at >= ? AND created_at < ?
          GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d'), tag_name
          ORDER BY day_key ASC, tag_name ASC
        `,
        [TRACKED_TAGS, listStart, listEnd],
        {
          route: "/api/logs/weekly",
          database: "ewon-logs",
          from: listStart.toISOString(),
          to: listEnd.toISOString(),
        },
      ).then(([rows]) => rows),
      runLoggedQuery(
        logsDb,
        "db-write",
        "select weekly summary coverage",
        `
          SELECT
            DATE_FORMAT(created_at, '%Y-%m-%d') AS day_key,
            HOUR(created_at) AS hour_key,
            COUNT(DISTINCT tag_name) AS tag_count
          FROM ewon_tag_logs
          WHERE tag_name IN (?) AND created_at >= ? AND created_at < ?
          GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d'), HOUR(created_at)
          ORDER BY day_key ASC, hour_key ASC
        `,
        [TRACKED_TAGS, listStart, listEnd],
        {
          route: "/api/logs/weekly",
          database: "ewon-logs",
          from: listStart.toISOString(),
          to: listEnd.toISOString(),
        },
      ).then(([rows]) => rows),
    ])
    res.json(buildWeeklyResponse(statRows, coverageRows, anchorTimestamp))
  } catch (error) {
    res.status(500).json({ message: "Tidak dapat mengambil data mingguan" })
  }
})

app.get("/api/logs/day/:date", async (req, res) => {
  const { date } = req.params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: "format tanggal harus YYYY-MM-DD" })
  }
  const [year, month, day] = date.split("-").map((part) => Number(part))
  const startMs = getTimeZoneDayStartMs(year, month, day, REPORT_TIME_ZONE)
  const start = new Date(startMs)
  const end = new Date(startMs + DAY_MS)

  try {
    const [rows] = await runLoggedQuery(
      logsDb,
      "db-write",
      "select daily logs",
      "SELECT tag_name, value, created_at FROM ewon_tag_logs WHERE tag_name IN (?) AND created_at >= ? AND created_at < ? ORDER BY created_at ASC",
      [TRACKED_TAGS, start, end],
      {
        route: "/api/logs/day/:date",
        database: "ewon-logs",
        date,
        from: start.toISOString(),
        to: end.toISOString(),
      },
    )
    const detail = TRACKED_TAGS.reduce((acc, tag) => {
      acc[tag] = []
      return acc
    }, {})
    rows.forEach((row) => {
      if (!detail[row.tag_name]) return
      detail[row.tag_name].push({
        timestamp: new Date(row.created_at).toISOString(),
        value: Number(row.value),
      })
    })
    res.json({ date, tags: detail })
  } catch (error) {
    res.status(500).json({ message: "Tidak dapat mengambil data harian" })
  }
})

app.get("/api/logs/summary/daily", async (req, res) => {
  const queryDate = typeof req.query.date === "string" ? req.query.date : ""
  const targetDate =
    queryDate ||
    formatPartsToDate(getTimeZoneParts(new Date(), REPORT_TIME_ZONE))

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return res.status(400).json({ message: "format tanggal harus YYYY-MM-DD" })
  }

  const [year, month, day] = targetDate.split("-").map((part) => Number(part))
  const startMs = getTimeZoneDayStartMs(year, month, day, REPORT_TIME_ZONE)
  const start = new Date(startMs)
  const end = new Date(startMs + DAY_MS)

  try {
    const [rows] = await runLoggedQuery(
      logsDb,
      "db-write",
      "select daily kwh summary",
      "SELECT value, created_at FROM ewon_tag_logs WHERE tag_name = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC",
      ["pm139KWH", start, end],
      {
        route: "/api/logs/summary/daily",
        database: "ewon-logs",
        date: targetDate,
        from: start.toISOString(),
        to: end.toISOString(),
      },
    )

    const firstRow = rows.at(0) ?? null
    const lastRow = rows.at(-1) ?? null
    const startReading = firstRow ? Number(firstRow.value) : null
    const endReading = lastRow ? Number(lastRow.value) : null
    const consumptionKwh = normalizeDailyConsumption(startReading, endReading)
    const co2eKg =
      consumptionKwh == null
        ? null
        : Number((consumptionKwh * CO2E_PER_KWH_KG).toFixed(3))
    const costEstimateIdr =
      consumptionKwh == null
        ? null
        : Number((consumptionKwh * KWH_TARIFF).toFixed(2))

    res.json({
      date: targetDate,
      tag: "pm139KWH",
      emissionFactorKgPerKwh: CO2E_PER_KWH_KG,
      tariffPerKwh: KWH_TARIFF,
      recordCount: rows.length,
      startReading,
      endReading,
      consumptionKwh,
      costEstimateIdr,
      co2eKg,
      firstTimestamp: firstRow ? new Date(firstRow.created_at).toISOString() : null,
      lastTimestamp: lastRow ? new Date(lastRow.created_at).toISOString() : null,
    })
  } catch (error) {
    res.status(500).json({ message: "Tidak dapat mengambil ringkasan konsumsi harian" })
  }
})

/* ======================
   SERVE REACT BUILD
====================== */

const clientPath = path.join(__dirname, "../dist")

app.use(express.static(clientPath))

app.use((req,res)=>{
  res.sendFile(path.join(clientPath,"index.html"))
})

app.use((error, req, res, next) => {
  logError("api", "unhandled express error", {
    method: req.method,
    path: req.originalUrl,
    error: normalizeError(error),
  })

  if (res.headersSent) {
    next(error)
    return
  }

  if (req.path.startsWith("/api")) {
    res.status(500).json({ message: "Terjadi error internal pada API" })
    return
  }

  res.status(500).send("Internal Server Error")
})

/* ======================
   START SERVER
====================== */

const PORT = 3000

const logLifecycle = (message) => {
  logInfo("lifecycle", message)
}

const closeHttpServer = async () => {
  if (!httpServer) return

  await new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
  logLifecycle("http server closed")
}

const shutdown = (signal, code = 0) => {
  if (shutdownPromise) return shutdownPromise

  isShuttingDown = true
  logLifecycle(`received ${signal}, shutting down with code ${code}`)

  if (paramPollTimer) {
    clearInterval(paramPollTimer)
    paramPollTimer = null
  }
  if (retentionTimer) {
    clearInterval(retentionTimer)
    retentionTimer = null
  }

  const forceExitTimer = setTimeout(() => {
    logLifecycle(`force exiting after ${SHUTDOWN_FORCE_EXIT_MS}ms`)
    process.exit(code)
  }, SHUTDOWN_FORCE_EXIT_MS)
  forceExitTimer.unref?.()

  shutdownPromise = Promise.allSettled([
    closeHttpServer(),
    closeAtc3000(),
    closePool(db, "main database"),
    closePool(logsDb, "logs database"),
  ]).finally(() => {
    clearTimeout(forceExitTimer)
    process.exit(code)
  })

  return shutdownPromise
}

process.on("SIGINT", () => {
  void shutdown("SIGINT", 0)
})
process.on("SIGTERM", () => {
  void shutdown("SIGTERM", 0)
})
process.on("SIGBREAK", () => {
  void shutdown("SIGBREAK", 0)
})
process.on("uncaughtException", (error) => {
  logError("lifecycle", "uncaughtException", {
    error: normalizeError(error),
  })
  void shutdown("uncaughtException", 1)
})
process.on("unhandledRejection", (reason) => {
  logError("lifecycle", "unhandledRejection", {
    error: normalizeError(reason),
  })
  void shutdown("unhandledRejection", 1)
})
process.on("exit", (code) => {
  logLifecycle(`process.exit detected with code ${code}`)
})

httpServer = app.listen(PORT, () => {
  logInfo("lifecycle", "server listening", {
    url: "http://localhost:" + PORT,
    port: PORT,
    dataSource: DATA_SOURCE,
    atc3000: {
      host: ATC3000_HOST,
      port: ATC3000_PORT,
      slaveId: ATC3000_SLAVE_ID,
      timeoutMs: ATC3000_TIMEOUT_MS,
      wordSwap: String(ATC3000_WORD_SWAP),
    },
    pollIntervalMs: PARAM_POLL_INTERVAL_MS,
    retentionDays: RETENTION_DAYS,
  })
})

httpServer.on("error", (error) => {
  logError("lifecycle", "http server failed", {
    port: PORT,
    error: normalizeError(error),
  })
})
