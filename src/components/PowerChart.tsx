import ReactECharts from "echarts-for-react"

interface Props{
 data:number[]
 time:string[]
}

export default function PowerChart({data,time}:Props){

const option={

tooltip:{trigger:"axis"},

xAxis:{
 type:"category",
 data:time
},

yAxis:{
 type:"value",
 name:"Power kW"
},

series:[
 {
  name:"Power",
  type:"line",
  smooth:true,
  data:data
 }
]

}

return <ReactECharts option={option} style={{height:300}}/>

}