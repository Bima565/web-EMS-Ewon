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
    gradient: "from-emerald-500/70 to-emerald-600/40",
    color: "#34d399",
  },
  {
    label: "Ampere",
    code: "AR",
    unit: "A",
    gradient: "from-cyan-500/70 to-cyan-600/40",
    color: "#06b6d4",
  },
  {
    label: "Daya",
    code: "P",
    unit: "kW",
    gradient: "from-indigo-500/70 to-indigo-600/40",
    color: "#6366f1",
  },
  {
    label: "Frekuensi",
    code: "F",
    unit: "Hz",
    gradient: "from-amber-500/70 to-amber-500/30",
    color: "#fbbf24",
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
  const timelineLabels = [
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
    "14:00",
    "14:30",
    "15:00",
  ]
  const values = timelineLabels.map((_, idx) => {
    const offset = Math.sin(idx / 2) * 8 + (idx % 3 === 0 ? 5 : -3)
    return Number((baseValue + offset).toFixed(2))
  })
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
    <div className="relative overflow-hidden rounded-[28px] border border-cyan-400/40 bg-gradient-to-r from-[#0f172a] via-[#0f172a]/70 to-[#0d3b66] p-4 shadow-[0_40px_60px_rgba(2,6,23,0.55)]">
      <div className="rounded-2xl bg-slate-900/70 p-2">
        <ReactECharts option={chartOption} style={{ height: 180 }} />
      </div>
      <div className="mt-4 space-y-1">
        <p className="text-sm font-semibold text-white">{panel.tagdesc}</p>
        <p className="text-xs uppercase tracking-[0.4em] text-cyan-200">
          UJi
        </p>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {metricDetails.map((metric) => {
          const tag = relevantTags.find((t) => t.tagname.includes(metric.code))
          const value =
            typeof tag?.tagvalue === "number"
              ? tag.tagvalue.toFixed(2)
              : tag?.tagvalue ?? "-"
          return (
            <div
              key={metric.code}
              className={`rounded-2xl p-4 text-white shadow-2xl shadow-slate-900/40 bg-gradient-to-br ${metric.gradient}`}
            >
              <p className="text-[0.65rem] uppercase tracking-[0.4em]">{metric.label}</p>
              <p className="text-2xl font-semibold">
                {value} <span className="text-sm font-normal">{metric.unit}</span>
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
