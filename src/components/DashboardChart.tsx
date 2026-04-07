import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { useLiveParams } from "../hooks/useLiveParams"

const LIVE_METRICS: Array<{
  tag: string
  label: string
  unit: string
  color: string
  fill: string
}> = [
  { tag: "pm139KWH", label: "KWH", unit: "kWh", color: "#34d399", fill: "rgba(52,211,153,0.3)" },
  { tag: "pm139AR", label: "Arus R", unit: "A", color: "#38bdf8", fill: "rgba(56,189,248,0.3)" },
  { tag: "pm139P", label: "kW", unit: "kW", color: "#a855f7", fill: "rgba(168,85,247,0.3)" },
  { tag: "pm139App", label: "App", unit: "kVA", color: "#f97316", fill: "rgba(249,115,22,0.25)" },
  { tag: "pm139VAN", label: "Volt", unit: "V", color: "#22d3ee", fill: "rgba(34,211,238,0.25)" },
  { tag: "pm139F", label: "Hz", unit: "Hz", color: "#facc15", fill: "rgba(250,204,21,0.25)" },
]

const formatTimestamp = (value: Date) =>
  value.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

type TooltipParams = Array<{
  axisValueLabel?: string
  marker?: string
  seriesName?: string
  data?: number | null
}>

export default function DashboardChart() {
  const { history, status, lastSync } = useLiveParams()

  const chartOption = useMemo(() => {
    const points = history[LIVE_METRICS[0].tag] ?? []
    const labels = points.map((entry) => formatTimestamp(new Date(entry.timestamp)))
    const hasData = LIVE_METRICS.some((metric) =>
      (history[metric.tag] ?? []).some((entry) => entry.value != null),
    )

    return {
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(2,6,23,0.95)",
        textStyle: {
          color: "#f8fafc",
        },
        formatter: (params: TooltipParams) => {
          if (!Array.isArray(params) || params.length === 0) return ""
          const header = `${params[0].axisValueLabel ?? ""}<br/>`
          const lines = params
            .map((param) => {
              const metric = LIVE_METRICS.find((item) => item.label === param.seriesName)
              const unit = metric ? ` ${metric.unit}` : ""
              const value =
                param.data == null
                  ? "—"
                  : Number.isFinite(param.data)
                  ? param.data.toLocaleString("id-ID", { maximumFractionDigits: 4 })
                  : param.data
              return `${param.marker ?? ""} ${param.seriesName ?? ""}: <strong>${value}${unit}</strong>`
            })
            .join("<br/>")
          return header + lines
        },
        axisPointer: {
          label: {
            formatter: "{value}",
          },
        },
      },
      legend: {
        data: LIVE_METRICS.map((metric) => metric.label),
        textStyle: {
          color: "rgba(255,255,255,0.65)",
        },
        top: 0,
      },
      grid: {
        left: "4%",
        right: "4%",
        bottom: "8%",
        top: "20%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: labels,
        axisLine: {
          lineStyle: {
            color: "rgba(148,163,184,0.3)",
          },
        },
        axisLabel: {
          color: "rgba(148,163,184,0.9)",
          fontSize: 11,
        },
        splitLine: {
          show: false,
        },
      },
      yAxis: {
        type: "value",
        axisLine: {
          show: false,
        },
        axisLabel: {
          color: "rgba(148,163,184,0.8)",
          fontSize: 11,
        },
        splitLine: {
          lineStyle: {
            color: "rgba(148,163,184,0.15)",
          },
        },
      },
      series: LIVE_METRICS.map((metric) => ({
        name: metric.label,
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: {
          width: 3,
          color: metric.color,
        },
        areaStyle:
          hasData && points.length > 0
            ? {
                opacity: 0.2,
                color: metric.fill,
              }
            : undefined,
        emphasis: {
          focus: "series",
        },
        data: (history[metric.tag] ?? []).map((entry) => entry.value),
      })),
    }
  }, [history])

  const statusMessage =
    status === "error"
      ? "Tidak dapat terhubung ke API live."
      : status === "loading"
      ? "Memuat data realtime..."
      : `Terakhir sinkron: ${lastSync ? formatTimestamp(new Date(lastSync)) : "—"}`

  return (
    <div>
      <div className="dashboard-live-chart-meta">
        <span className="dashboard-live-chart-status">{statusMessage}</span>
        <span className="dashboard-live-chart-refresh">Riwayat 1 jam</span>
      </div>
      {status === "error" && (
        <div className="dashboard-live-chart-error">{statusMessage}</div>
      )}
      <div className="dashboard-live-chart">
        <ReactECharts option={chartOption} style={{ height: 360, width: "100%" }} />
      </div>
    </div>
  )
}
