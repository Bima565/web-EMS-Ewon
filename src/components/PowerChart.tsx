import ReactECharts from "echarts-for-react"

export default function PowerChart(){

const option = {
  xAxis:{
    type:"category",
    data:["1","2","3","4","5"]
  },
  yAxis:{
    type:"value"
  },
  series:[
    {
      data:[10,20,15,30,40],
      type:"line"
    }
  ]
}

return <ReactECharts option={option} style={{height:300}} />

}