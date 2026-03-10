import { useEffect,useState } from "react"
import { getRealtime,getPanels } from "../api/api"
import PanelCard from "../components/PanelCard"
import type { Tag, Panel } from "../types/tag"

export default function Dashboard(){

const [tags,setTags]=useState<Tag[]>([])
const [panels,setPanels]=useState<Panel[]>([])

useEffect(()=>{

const load=()=>{

getRealtime().then(setTags)
getPanels().then(setPanels)

}

load()

const timer=setInterval(load,2000)

return ()=>clearInterval(timer)

},[])

return(

<div className="dashboard">

<h1>EWON EMS Dashboard</h1>

<div className="panel-container">

{panels.map(p => {

const panelTags = tags.filter(t =>
  t.tagname.startsWith(p.tagname)
)

return (
  <PanelCard
    key={p.id}
    title={p.tagdesc}
    tags={panelTags}
  />
)

})}

</div>

</div>

)

}