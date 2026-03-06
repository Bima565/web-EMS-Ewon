import ReactECharts from "echarts-for-react"
import { useEffect, useState } from "react"

interface ChartData {
  tagname: string
  tagvalue: number
}

export default function MixedChart(){

const [power,setPower] = useState<number[]>([])
const [freq,setFreq] = useState<number[]>([])
const [labels,setLabels] = useState<string[]>([])

useEffect(()=>{

fetch("http://localhost:3000/api/realtime")
.then(res=>res.json())
.then(data=>{

const p:number[]=[]
const f:number[]=[]
const l:string[]=[]

data.forEach((d:ChartData)=>{

 if(d.tagname.includes("P")){
   p.push(d.tagvalue)
   l.push(d.tagname)
 }

 if(d.tagname.includes("F")){
   f.push(d.tagvalue)
 }

})

setPower(p)
setFreq(f)
setLabels(l)

})

},[])

const option = {

tooltip:{
 trigger:"axis"
},

legend:{
 data:["Power","Frequency"]
},

xAxis:{
 type:"category",
 data:labels
},

yAxis:[
 {
  type:"value",
  name:"Power kW"
 },
 {
  type:"value",
  name:"Frequency Hz"
 }
],

series:[
 {
  name:"Power",
  type:"bar",
  data:power
 },
 {
  name:"Frequency",
  type:"line",
  yAxisIndex:1,
  data:freq
 }
]

}

return <ReactECharts option={option} style={{height:400}}/>

}