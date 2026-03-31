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

const db = mysql.createConnection({
  ...dbConfig,
  database: "ewon",
})

const logsDb = mysql.createConnection({
  ...dbConfig,
  database: "ewon-logs",
})

const connectTo = (connection, name) => {
  connection.connect((err) => {
    if (err) {
      console.log(`${name} error`, err)
    } else {
      console.log(`${name} connected`)
    }
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
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    await logsDb.promise().query(
      "DELETE FROM ewon_tag_logs WHERE created_at < ?",
      [cutoff],
    )
  } catch (error) {
    console.error("failed to write log entries", error)
  }
}

const sweepOldLogs = async () => {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    await logsDb
      .promise()
      .query("DELETE FROM ewon_tag_logs WHERE created_at < ?", [cutoff])
  } catch (error) {
    console.error("failed to sweep old logs", error)
  }
}

setInterval(sweepOldLogs, RETENTION_INTERVAL_MS)

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

app.get("/api/param-values", async (req, res) => {
  try {
    const response = await fetch(PARAM_URL, {
      headers: {
        Authorization: PARAM_AUTH,
      },
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "unable to read body")
      return res.status(response.status).json({
        message: "Gagal mengambil data param dari Ewon",
        statusText: response.statusText,
        detail: body,
      })
    }

    const text = await response.text()
    const data = parseParamLines(text)
    void logParamValues(data)
    res.json(data)
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan saat menghubungi Ewon",
      error: error?.message ?? "unknown error",
    })
  }
})

const formatDayLabel = (date) =>
  new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
  }).format(date)

const buildWeeklyResponse = (rows, startDate) => {
  const dayMap = new Map()
  for (let i = 0; i < WEEK_DAYS; i += 1) {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + i)
    const key = date.toISOString().slice(0, 10)
    dayMap.set(key, {
      date: key,
      label: formatDayLabel(date),
      stats: {},
    })
  }

  rows.forEach((row) => {
    const tag = row.tag_name
    if (!TRACKED_TAGS.includes(tag)) return
    const createdAt = new Date(row.created_at)
    const key = createdAt.toISOString().slice(0, 10)
    const day = dayMap.get(key)
    if (!day) return

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
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (WEEK_DAYS - 1))
  try {
    const [rows] = await logsDb
      .promise()
      .query(
        "SELECT tag_name, value, created_at FROM ewon_tag_logs WHERE tag_name IN (?) AND created_at BETWEEN ? AND ? ORDER BY created_at ASC",
        [TRACKED_TAGS, start, now],
      )
    res.json(buildWeeklyResponse(rows, start))
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
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

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

app.listen(PORT, () => {
  console.log("Server running http://localhost:" + PORT)
})
