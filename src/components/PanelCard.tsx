import type { Tag } from "../types/tag"

interface Props {
  title:string
  tags:Tag[]
}

export default function PanelCard({title,tags}:Props){

const getValue=(name:string)=>{
  const t=tags.find(x=>x.tagname.includes(name))
  return t?.tagvalue ?? "-"
}

return(

<div className="card">

<h3>{title}</h3>

<div className="panel-grid">

<div>Voltage</div>
<div>{getValue("VAB")} V</div>

<div>Current</div>
<div>{getValue("AR")} A</div>

<div>Power</div>
<div>{getValue("P")} kW</div>

<div>Frequency</div>
<div>{getValue("F")} Hz</div>

</div>

</div>

)

}