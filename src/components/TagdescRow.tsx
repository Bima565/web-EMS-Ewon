import ReactECharts from "echarts-for-react"
import type { Panel, Tag } from "../types/tag"

type MetricDetail = {
  label: string
  code: string
  unit: string
  gradient: string
  color: string
}

const metricDetails: MetricDetail[] = [
  {
    label: "Voltase",
    code: "VAB",
    unit: "V",
    gradient: "linear-gradient(135deg, rgba(16,185,129,0.7), rgba(5,150,105,0.4))",
    color: "#34d399",
  },
  {
    label: "Ampere",
    code: "AR",
    unit: "A",
    gradient: "linear-gradient(135deg, rgba(6,182,212,0.7), rgba(8,145,178,0.4))",
    color: "#22d3ee",
  },
  {
    label: "Daya",
    code: "P",
    unit: "kW",
    gradient: "linear-gradient(135deg, rgba(99,102,241,0.7), rgba(79,70,229,0.4))",
    color: "#a5b4fc",
  },
  {
    label: "Frekuensi",
    code: "F",
    unit: "Hz",
    gradient: "linear-gradient(135deg, rgba(245,158,11,0.7), rgba(245,158,11,0.3))",
    color: "#fcd34d",
  },
]

export interface TagdescRowProps {
  panel: Panel
  tags: Tag[]
}

export default function TagdescRow({ panel, tags }: TagdescRowProps) {
  const relevantTags = tags.filter((t) => t.tagname.startsWith(panel.tagname))
  const baseValue =
    relevantTags.find((t) => t.tagname.includes("VAB"))?.tagvalue ??
    relevantTags.find((t) => t.tagname.includes("P"))?.tagvalue ??
    1650
  const timelineLabels = Array.from({ length: 24 }, (_, i) => {
    const hour = String(i).padStart(2, "0")
    return `${hour}:00`
  })
  const values = timelineLabels.map((_, idx) => {
    const offset = Math.sin(idx / 2) * 8 + (idx % 3 === 0 ? 5 : -3)
    return Number((baseValue + offset).toFixed(2))
  })
  const normalizedTag = panel.tagname.toLowerCase()
  const panelGroup = normalizedTag.includes("f1")
    ? "F1"
    : normalizedTag.includes("f2")
    ? "F2"
    : "Panel"
  const chartOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(2,6,23,0.95)",
      textStyle: { color: "#f8fafc" },
    },
    grid: { left: 16, right: 18, top: 24, bottom: 16, containLabel: true },
    xAxis: {
      type: "category",
      data: timelineLabels,
      axisLine: { lineStyle: { color: "rgba(148,163,184,0.3)" } },
      axisLabel: { color: "rgba(148,163,184,0.8)", fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: { color: "rgba(148,163,184,0.2)" },
      },
      axisLabel: {
        color: "rgba(148,163,184,0.7)",
        fontSize: 10,
      },
    },
    dataZoom: [
      { type: "slider", start: 0, end: 100, height: 20, bottom: 0 },
      { type: "inside", start: 0, end: 100 },
    ],
    series: [
      {
        type: "line",
        smooth: true,
        data: values,
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(14,165,233,0.4)" },
              { offset: 1, color: "rgba(15,23,42,0.1)" },
            ],
          },
        },
        lineStyle: {
          width: 2,
          color: "#22d3ee",
        },
        symbolSize: 8,
        itemStyle: {
          color: "#38bdf8",
        },
      },
    ],
  }

  return (
    <div className="tagdesc-row">
      <div className="tagdesc-row-content">
        <div className="tagdesc-row-header">
          <span>{panelGroup}</span>
          <span className="tagdesc-row-tagname">{panel.tagname}</span>
        </div>
        <div className="tagdesc-chart-wrapper">
          <ReactECharts option={chartOption} style={{ height: 180 }} />
        </div>
        <div className="tagdesc-row-description">
          <p className="tagdesc-row-title">{panel.tagdesc}</p>
          <p className="tagdesc-row-status">Status real-time</p>
        </div>
      </div>
      <div className="tagdesc-metrics-grid">
        {metricDetails.map((metric) => {
          const tag = relevantTags.find((t) => t.tagname.includes(metric.code))
          const value =
            typeof tag?.tagvalue === "number"
              ? tag.tagvalue.toFixed(2)
              : tag?.tagvalue ?? "-"
          return (
            <div
              key={metric.code}
              className="tagdesc-metric-card"
              style={{ backgroundImage: metric.gradient }}
            >
              <p className="tagdesc-metric-label">{metric.label}</p>
              <p className="tagdesc-metric-value" style={{ color: metric.color }}>
                {value} <span className="tagdesc-metric-unit">{metric.unit}</span>
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
