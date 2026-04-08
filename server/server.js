const express = require("express")
const mysql = require("mysql2")
const cors = require("cors")
const path = require("path")

const app = express()

const PARAM_URL = "http://192.168.100.239/rcgi.bin/ParamForm?AST_Param=$dtIV$flA$ftT"
const PARAM_AUTH = `Basic ${Buffer.from("admin:Admin123").toString("base64")}`
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
const PARAM_POLL_INTERVAL_MS = 15 * 1000
const PARAM_FETCH_TIMEOUT_MS = 12 * 1000
const PARAM_FETCH_RETRY_DELAY_MS = 1500
const PARAM_FETCH_MAX_ATTEMPTS = 2
const PARAM_STALE_THRESHOLD_MS = PARAM_POLL_INTERVAL_MS * 3
const HEALTHCHECK_DB_TIMEOUT_MS = 5 * 1000
const SHUTDOWN_FORCE_EXIT_MS = 10 * 1000
const REPORT_TIME_ZONE = "Asia/Jakarta"

const latestParamSnapshot = {
  values: [],
  updatedAt: null,
}
let isParamPolling = false
let isSweepingOldLogs = false
let isShuttingDown = false
let shutdownPromise = null
let paramPollTimer = null
let retentionTimer = null
let httpServer = null

const paramPollingState = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  consecutiveFailures: 0,
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    causeCode === "ETIMEDOUT"
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
    console.error(`failed to close ${label} pool`, error)
  }
}

const parseParamLines = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('"TagId"'))
    .map((line) => {
      const cols = line.split(";").map((col) => col.replace(/(^"|"$)/g, ""))
      return {
        TagId: Number(cols[0]),
        TagName: cols[1],
        Value: Number(cols[2]),
        AlStatus: Number(cols[3]),
        AlType: Number(cols[4]),
        Quality: Number(cols[5]),
      }
    })

app.use(cors())
app.use(express.json())

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

const connectTo = (pool, name) => {
  pool.getConnection((err, connection) => {
    if (connection) {
      connection.release()
    }
    if (err) {
      console.log(`${name} error`, err)
      return
    }
    console.log(`${name} connected`)
  })
}

connectTo(db, "Database")
connectTo(logsDb, "Logs database")

const logParamValues = async (params) => {
  if (!params?.length) return
  const filtered = params
    .filter((param) => TRACKED_TAGS.includes(param.TagName))
    .map((param) => [param.TagName, param.Value])

  if (!filtered.length) return

  try {
    await logsDb
      .promise()
      .query("INSERT INTO ewon_tag_logs (tag_name, value) VALUES ?", [filtered])
  } catch (error) {
    console.error("failed to write log entries", error)
  }
}

const refreshParamSnapshot = async () => {
  let lastError = null

  for (let attempt = 1; attempt <= PARAM_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(PARAM_URL, {
        headers: {
          Authorization: PARAM_AUTH,
          Connection: "close",
        },
        signal: AbortSignal.timeout(PARAM_FETCH_TIMEOUT_MS),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => "unable to read body")
        throw new Error(
          `param polling failed with status ${response.status}: ${response.statusText} (${body})`,
        )
      }

      const text = await response.text()
      const data = parseParamLines(text)

      latestParamSnapshot.values = data
      latestParamSnapshot.updatedAt = new Date().toISOString()
      paramPollingState.lastSuccessAt = latestParamSnapshot.updatedAt
      paramPollingState.lastErrorMessage = null
      paramPollingState.consecutiveFailures = 0
      await logParamValues(data)
      console.log(
        `Param snapshot refreshed (${data.length} entries) @${latestParamSnapshot.updatedAt}`,
      )
      return
    } catch (error) {
      lastError = error

      if (attempt >= PARAM_FETCH_MAX_ATTEMPTS || !isTransientPollingError(error)) {
        throw error
      }

      console.warn(
        `param polling transient failure on attempt ${attempt}/${PARAM_FETCH_MAX_ATTEMPTS}: ${formatPollingError(error)}; retrying in ${PARAM_FETCH_RETRY_DELAY_MS}ms`,
      )
      await sleep(PARAM_FETCH_RETRY_DELAY_MS)
    }
  }

  throw lastError
}

const startParamPolling = () => {
  const runner = () => {
    if (isShuttingDown) return

    if (isParamPolling) {
      console.warn("param polling skipped because previous fetch is still running")
      return
    }

    isParamPolling = true
    refreshParamSnapshot()
      .catch((error) => {
        paramPollingState.lastErrorAt = new Date().toISOString()
        paramPollingState.lastErrorMessage = formatPollingError(error)
        paramPollingState.consecutiveFailures += 1
        console.error(`param polling error: ${formatPollingError(error)}`)
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
    const [result] = await logsDb
      .promise()
      .query("DELETE FROM ewon_tag_logs WHERE created_at < ?", [cutoff])
    console.log(`old log sweep completed, deleted ${result.affectedRows ?? 0} rows`)
  } catch (error) {
    console.error("failed to sweep old logs", error)
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
app.get("/api/panels", (req, res) => {

   db.query(
    "SELECT id, tagname, tagdesc FROM tagmst",
    (err, result) => {

      if (err) return res.status(500).json(err)

      res.json(result)

    }
  )

})

// realtime tag
app.get("/api/realtime", (req, res) => {

  db.query(
    "SELECT tagname,tagvalue,created FROM monitoring_tags",
    (err, result) => {

      if (err) return res.status(500).json(err)

      res.json(result)

    }
  )

})

// history power
app.get("/api/history/:tag", (req,res)=>{

  const tag=req.params.tag

  db.query(
    "SELECT created,tagvalue FROM datamin WHERE tagname=? ORDER BY created DESC LIMIT 200",
    [tag],
    (err,result)=>{

      if(err) return res.status(500).json(err)

      res.json(result)

    }
  )

})

app.get("/api/param-values", (req, res) => {
  if (!latestParamSnapshot.values.length) {
    return res.status(503).json({
      message: "Data param belum tersedia, sedang mencoba mengambil dari Ewon",
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

  res.status(overallStatus === "ok" ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    shuttingDown: isShuttingDown,
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

const buildWeeklyResponse = (rows, anchorTimestamp) => {
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
    })
  }

  rows.forEach((row) => {
    const tag = row.tag_name
    if (!TRACKED_TAGS.includes(tag)) return
    const createdAt = new Date(row.created_at)
    const parts = getTimeZoneParts(createdAt, REPORT_TIME_ZONE)
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
      parts.day,
    ).padStart(2, "0")}`
    const day = dayMap.get(key)
    if (!day) return

    const timestamp = createdAt.getTime()
    if (!day.displayReferenceTime || timestamp >= day.displayReferenceTime) {
      day.displayReferenceTime = timestamp
      day.displayParts = parts
    }

    const tagStats = day.stats[tag] ?? {
      count: 0,
      sum: 0,
      min: null,
      max: null,
      lastValue: null,
      lastTime: 0,
    }

    const value = Number(row.value ?? 0)
    tagStats.count += 1
    tagStats.sum += value
    tagStats.min = tagStats.min === null ? value : Math.min(tagStats.min, value)
    tagStats.max = tagStats.max === null ? value : Math.max(tagStats.max, value)
    if (tagStats.lastTime === 0 || createdAt.getTime() > tagStats.lastTime) {
      tagStats.lastValue = value
      tagStats.lastTime = createdAt.getTime()
    }

    day.stats[tag] = tagStats
  })

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
  }))

  return { tags: TRACKED_TAGS, week }
}

app.get("/api/logs/weekly", async (req, res) => {
  const now = new Date()
  try {
    const [[{ latest }]] = await logsDb
      .promise()
      .query(
        "SELECT MAX(created_at) AS latest FROM ewon_tag_logs WHERE tag_name IN (?)",
        [TRACKED_TAGS],
      )
    const latestTimestamp = latest ? new Date(latest).getTime() : 0
    const nowTimestamp = now.getTime()
    const todayParts = getTimeZoneParts(now, REPORT_TIME_ZONE)
    const todayMidnight = getTimeZoneDayStartMs(
      todayParts.year,
      todayParts.month,
      todayParts.day,
      REPORT_TIME_ZONE,
    )
    const todayEnd = todayMidnight + DAY_MS - 1
    const anchorCandidate = latestTimestamp || nowTimestamp
    const anchorTimestamp = Math.min(anchorCandidate, todayEnd)
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
    const [rows] = await logsDb
      .promise()
      .query(
        "SELECT tag_name, value, created_at FROM ewon_tag_logs WHERE tag_name IN (?) AND created_at >= ? AND created_at < ? ORDER BY created_at ASC",
        [TRACKED_TAGS, listStart, listEnd],
      )
    res.json(buildWeeklyResponse(rows, anchorTimestamp))
  } catch (error) {
    console.error("failed to load weekly logs", error)
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
    const [rows] = await logsDb
      .promise()
      .query(
        "SELECT tag_name, value, created_at FROM ewon_tag_logs WHERE tag_name IN (?) AND created_at >= ? AND created_at < ? ORDER BY created_at ASC",
        [TRACKED_TAGS, start, end],
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
    console.error("failed to load daily logs", error)
    res.status(500).json({ message: "Tidak dapat mengambil data harian" })
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

/* ======================
   START SERVER
====================== */

const PORT = 3000

const logLifecycle = (message) => {
  const timestamp = new Date().toISOString()
  console.log(`[lifecycle][${timestamp}] ${message}`)
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
  console.error("uncaughtException", error)
  void shutdown("uncaughtException", 1)
})
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason)
  void shutdown("unhandledRejection", 1)
})
process.on("exit", (code) => {
  logLifecycle(`process.exit detected with code ${code}`)
})

httpServer = app.listen(PORT, () => {
  console.log("Server running http://localhost:" + PORT)
})
