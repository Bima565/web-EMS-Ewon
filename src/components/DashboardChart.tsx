import ReactECharts from "echarts-for-react";

const weekLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function DashboardChart() {
  const option = {
    color: ["#22d3ee", "#a855f7"],
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15,23,42,0.9)",
      textStyle: {
        color: "#f8fafc",
      },
    },
    legend: {
      data: ["Energi (kWh)", "Efisiensi (%)"],
      textStyle: {
        color: "rgba(255,255,255,0.8)",
      },
      top: 0,
    },
    grid: {
      left: "3%",
      right: "3%",
      bottom: "10%",
      top: "20%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: weekLabels,
      axisLine: {
        lineStyle: {
          color: "rgba(255,255,255,0.2)",
        },
      },
      axisLabel: {
        color: "rgba(255,255,255,0.7)",
        fontSize: 12,
      },
    },
    yAxis: {
      type: "value",
      axisLine: {
        show: false,
      },
      axisLabel: {
        color: "rgba(255,255,255,0.6)",
      },
      splitLine: {
        lineStyle: {
          color: "rgba(255,255,255,0.08)",
        },
      },
    },
    series: [
      {
      name: "Energi (kWh)",
        type: "line",
        smooth: true,
        areaStyle: {
          opacity: 0.3,
        },
        lineStyle: {
          width: 3,
        },
        symbolSize: 8,
        data: [4.4, 5.2, 5.8, 6.1, 6.7, 6.4, 6.9],
      },
      {
      name: "Efisiensi (%)",
        type: "line",
        smooth: true,
        lineStyle: {
          width: 2,
          type: "dashed",
        },
        symbol: "diamond",
        symbolSize: 7,
        data: [86, 88, 91, 92, 93, 92, 94],
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 320 }} />;
}
