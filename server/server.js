const express = require("express")
const mysql = require("mysql2")
const cors = require("cors")

const app = express()

app.use(cors())

// koneksi database laragon
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "ewon"
})

db.connect(err=>{
  if(err){
    console.log(err)
  }else{
    console.log("MySQL connected")
  }
})

// API realtime monitoring
app.get("/api/realtime",(req,res)=>{

db.query(`
SELECT tagname, tagvalue, created
FROM monitoring_tags
ORDER BY tagname
`,(err,result)=>{

 if(err){
   res.json(err)
 }else{
   res.json(result)
 }

})

})

app.listen(3000,()=>{
 console.log("API running on port 3000")
})