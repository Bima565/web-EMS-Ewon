import ReactECharts from "echarts-for-react"
import type { Tag } from "../types/tag"

interface Props {
  title: string
  tags: Tag[]
}

type TooltipAxisParam = {
  dataIndex: number
  marker: string
  seriesName: string
  value: number
}

const metricMap = [
  { label: "Tegangan", key: "VAB", unit: "V" },
  { label: "Arus", key: "AR", unit: "A" },
  { label: "Daya", key: "P", unit: "kW" },
  { label: "Frekuensi", key: "F", unit: "Hz" },
]

export default function PanelCard({ title, tags }: Props) {
  const getValue = (name: string) => {
    const match = tags.find((x) => x.tagname.includes(name))
    return match?.tagvalue != null ? match.tagvalue.toString() : "--"
  }

  const chartPoints = metricMap.map(({ label, key, unit }) => {
    const rawValue = parseFloat(getValue(key))
    const value = Number.isFinite(rawValue) ? rawValue : 0
    return { label, unit, value }
  })

  const chartOption = {
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15,23,42,0.95)",
      textStyle: {
        color: "#f8fafc",
      },
    formatter: (params: TooltipAxisParam[]) => {
      const point = params[0]
      const data = chartPoints[point.dataIndex]
      return `${data.label}<br/>${point.marker} ${point.seriesName}: ${point.value} ${data.unit}`
    },
    },
    grid: {
      top: 10,
      right: 10,
      bottom: 12,
      left: 30,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: chartPoints.map((point) => point.label),
      axisLine: {
        lineStyle: {
          color: "rgba(15,23,42,0.4)",
        },
      },
      axisLabel: {
        color: "rgba(15,23,42,0.7)",
        fontSize: 10,
      },
    },
    yAxis: {
      type: "value",
      splitLine: {
        lineStyle: {
          color: "rgba(15,23,42,0.3)",
        },
      },
      axisLine: {
        show: false,
      },
      axisLabel: {
        color: "rgba(15,23,42,0.6)",
        fontSize: 10,
      },
    },
    series: [
      {
        name: "Nilai",
        type: "bar",
        data: chartPoints.map((point) => point.value),
        itemStyle: {
          color: "rgba(14,165,233,0.7)",
        },
        barMaxWidth: 18,
        emphasis: {
          itemStyle: {
            color: "rgba(14,165,233,1)",
          },
        },
      },
    ],
  }

  return (
    <div className="bg-white/80 shadow-2xl shadow-slate-900/10 border border-white/50 rounded-3xl p-6 backdrop-blur-lg transition hover:-translate-y-0.5">
      <header className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
        <span className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-400">Langsung</span>
      </header>

      <div className="space-y-3 text-slate-500">
        {metricMap.map(({ label, key, unit }) => (
          <div key={key} className="flex items-baseline justify-between gap-4">
            <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
            <span className="text-base font-semibold text-slate-900 flex items-baseline gap-1">
              <span>{getValue(key)}</span>
              <span className="text-xs font-medium text-slate-500">{unit}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 -mx-4 rounded-2xl bg-white/5 px-4 pb-3 pt-2 shadow-inner shadow-slate-900/20">
        <ReactECharts option={chartOption} style={{ height: 140 }} />
      </div>
    </div>
  )
}
