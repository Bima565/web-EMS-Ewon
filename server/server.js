const express = require("express")
const mysql = require("mysql2")
const cors = require("cors")
const path = require("path")

const app = express()

const PARAM_URL = "http://192.168.100.239/rcgi.bin/ParamForm?AST_Param=$dtIV$flA$ftT"
const PARAM_AUTH = `Basic ${Buffer.from("admin:Admin123").toString("base64")}`

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
    res.json(data)
  } catch (error) {
    res.status(500).json({
      message: "Terjadi kesalahan saat menghubungi Ewon",
      error: error?.message ?? "unknown error",
    })
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
