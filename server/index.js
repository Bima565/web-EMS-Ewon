const express = require("express")
const mysql = require("mysql2")
const cors = require("cors")

const app = express()

app.use(cors())

// koneksi database
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "ewon"
})

db.connect(err => {
  if (err) {
    console.log("DB error", err)
  } else {
    console.log("Database connected")
  }
})


// API panels
app.get("/api/panels", (req,res)=>{

db.query(
"SELECT tagid,lokasi,tagprefix FROM tagmst",
(err,result)=>{

if(err) return res.status(500).json(err)

res.json(result)

})

})


// API realtime tags
app.get("/api/realtime",(req,res)=>{

db.query(
"SELECT tagname,tagvalue,created FROM monitoring_tags",
(err,result)=>{

if(err) return res.status(500).json(err)

res.json(result)

})

})


app.listen(3000,()=>{
console.log("Server running http://localhost:3000")
})