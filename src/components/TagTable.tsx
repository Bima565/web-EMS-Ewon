import { useEffect, useState } from "react"
import { getRealtime } from "../api/realtime"

interface TagData {
  tagname: string
  tagvalue: number
  created: string
}

export default function TagTable() {

  const [data,setData] = useState<TagData[]>([])

  useEffect(()=>{

    const load = () =>{
      getRealtime().then(setData)
    }

    load()

    const timer = setInterval(load,2000)

    return ()=>clearInterval(timer)

  },[])

  return (

    <table border={1} width="100%">
      <thead>
        <tr>
          <th>Tag</th>
          <th>Value</th>
          <th>Time</th>
        </tr>
      </thead>

      <tbody>

      {data.map((d,i)=>(
        <tr key={i}>
          <td>{d.tagname}</td>
          <td>{d.tagvalue}</td>
          <td>{d.created}</td>
        </tr>
      ))}

      </tbody>

    </table>

  )
}