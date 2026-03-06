import ReactECharts from "echarts-for-react";

export default function DashboardChart() {
  const option = {
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: ["Sales", "Profit"],
    },
    xAxis: {
      type: "category",
      data: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    },
    yAxis: [
      {
        type: "value",
        name: "Sales",
      },
      {
        type: "value",
        name: "Profit",
      },
    ],
    series: [
      {
        name: "Sales",
        type: "bar",
        data: [120, 200, 150, 80, 70],
      },
      {
        name: "Profit",
        type: "line",
        yAxisIndex: 1,
        data: [30, 50, 45, 20, 25],
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 400 }} />;
}