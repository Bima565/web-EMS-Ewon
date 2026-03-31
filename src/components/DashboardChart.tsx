import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { getParamValues } from "../api/api"

const FETCH_INTERVAL_MS = 2000
const ONE_HOUR_MS = 60 * 60 * 1000

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

type LiveEntry = {
  timestamp: Date
  label: string
  values: Record<string, number | null>
}

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
  const [history, setHistory] = useState<LiveEntry[]>([])
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading")
  const [lastSync, setLastSync] = useState<string>("—")

  useEffect(() => {
    let mounted = true

    const load = async () => {
      if (!mounted) return
      setStatus("loading")

      try {
        const params = await getParamValues()
        if (!mounted) return

        const timestamp = new Date()
        const entry: LiveEntry = {
          timestamp,
          label: formatTimestamp(timestamp),
          values: LIVE_METRICS.reduce((acc, metric) => {
            const match = params.find(
              (param) => param.TagName.toLowerCase() === metric.tag.toLowerCase(),
            )
            acc[metric.tag] = match?.Value ?? null
            return acc
          }, {} as Record<string, number | null>),
        }

        setHistory((prev) => {
          const cutoff = timestamp.getTime() - ONE_HOUR_MS
          const next = [...prev, entry].filter((row) => row.timestamp.getTime() >= cutoff)
          return next
        })
        setStatus("idle")
        setLastSync(entry.label)
      } catch (error) {
        if (!mounted) return
        console.error("Dashboard live chart fetch", error)
        setStatus("error")
      }
    }

    load()
    const interval = setInterval(load, FETCH_INTERVAL_MS)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const chartOption = useMemo(() => {
    const sortedHistory = [...history].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    )
    const hasData = sortedHistory.some((entry) =>
      LIVE_METRICS.some((metric) => entry.values[metric.tag] != null),
    )
    const latestTimestamp = sortedHistory.at(-1)?.timestamp.getTime() ?? Date.now()
    const minTimestamp = latestTimestamp - ONE_HOUR_MS

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
        type: "time",
        boundaryGap: false,
        min: minTimestamp,
        max: latestTimestamp,
        axisLine: {
          lineStyle: {
            color: "rgba(148,163,184,0.3)",
          },
        },
        axisLabel: {
          color: "rgba(148,163,184,0.9)",
          fontSize: 11,
          formatter: (value: number) =>
            new Date(value).toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }),
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
          hasData && sortedHistory.length > 0
            ? {
                opacity: 0.2,
                color: metric.fill,
              }
            : undefined,
        emphasis: {
          focus: "series",
        },
        data: sortedHistory.map((entry) => [
          entry.timestamp.getTime(),
          entry.values[metric.tag],
        ]),
      })),
    }
  }, [history])

  const statusMessage =
    status === "error"
      ? "Tidak dapat terhubung ke API live."
      : status === "loading"
      ? "Memuat data realtime..."
      : `Terakhir sinkron: ${lastSync}`

  return (
    <div>
      <div className="dashboard-live-chart-meta">
        <span className="dashboard-live-chart-status">{statusMessage}</span>
        <span className="dashboard-live-chart-refresh">Refresh 2 detik</span>
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
