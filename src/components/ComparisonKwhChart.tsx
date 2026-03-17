import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { getHistory } from "../api/api"
import "./style-ComparisonKwhChart.css"

const FETCH_INTERVAL_MS = 60 * 1000
const WINDOW_MS = 5 * 60 * 1000

type HistoryRow = {
  created: string
  tagvalue: number
}

type ChartPoint = {
  timestamp: number
  value: number
}

type TooltipParam = Array<{
  marker?: string
  seriesName?: string
  value?: [number, number]
}>

const formatTimestamp = (value: number) =>
  new Date(value).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

const buildSeries = (points: ChartPoint[]) =>
  points.map((row) => [row.timestamp, Number(row.value.toFixed?.(3) ?? row.value)])

export default function ComparisonKwhChart() {
  const [currentHour, setCurrentHour] = useState<ChartPoint[]>([])
  const [previousHour, setPreviousHour] = useState<ChartPoint[]>([])
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading")

  const load = async () => {
    setStatus("loading")
    try {
      const raw = await getHistory("pm139KWH")
      const now = Date.now()
      const rows: HistoryRow[] = Array.isArray(raw)
        ? raw
            .map((row) => ({
              created: String(row?.created ?? ""),
              tagvalue: Number(row?.tagvalue ?? ""),
            }))
            .filter(
              (entry) =>
                entry.created.length > 0 && Number.isFinite(entry.tagvalue),
            )
        : []

      const currentStart = now - WINDOW_MS
      const previousStart = currentStart - WINDOW_MS

      const currentPoints: ChartPoint[] = []
      const previousPoints: ChartPoint[] = []

      for (const entry of rows) {
        const timestamp = new Date(entry.created).getTime()
        if (timestamp >= currentStart) {
          currentPoints.push({ timestamp, value: entry.tagvalue })
        } else if (timestamp >= previousStart) {
          previousPoints.push({ timestamp: timestamp + WINDOW_MS, value: entry.tagvalue })
        }
      }

      setCurrentHour(currentPoints.sort((a, b) => a.timestamp - b.timestamp))
      setPreviousHour(previousPoints.sort((a, b) => a.timestamp - b.timestamp))
      setStatus("idle")
    } catch (error) {
      console.error("comparison chart", error)
      setStatus("error")
    }
  }

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      if (!mounted) return
      await load()
    }

    refresh()
    const interval = setInterval(() => {
      if (!mounted) return
      load()
    }, FETCH_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const option = useMemo(() => {
      const baseData = buildSeries(currentHour)
      const previousData = buildSeries(previousHour)

    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: TooltipParam) => {
          if (!Array.isArray(params)) return ""
          return params
            .map(
              (item) =>
                `${item.marker} ${item.seriesName} <strong>${item.value?.[1]?.toFixed?.(3) ??
                  item.value?.[1]}</strong> kWh`,
            )
            .join("<br/>")
        },
      },
        legend: {
          data: ["5 menit terakhir", "5 menit sebelumnya"],
          textStyle: {
            color: "#0f172a",
          },
          bottom: 10,
        },
      grid: {
        left: "3%",
        right: "3%",
        top: "15%",
        bottom: "20%",
        containLabel: true,
      },
      xAxis: {
        type: "time",
        axisLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.3)",
          },
        },
        axisLabel: {
          color: "rgba(255,255,255,0.7)",
          formatter: formatTimestamp,
        },
        splitLine: {
          show: false,
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        axisLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.2)",
          },
        },
        axisLabel: {
          color: "rgba(255,255,255,0.6)",
        },
        splitLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.05)",
          },
        },
      },
      series: [
        {
          name: "Jam ini",
          type: "line",
          smooth: true,
          lineStyle: {
            width: 2,
            color: "#38bdf8",
          },
          areaStyle: {
            opacity: 0.2,
            color: "#38bdf8",
          },
          data: baseData,
        },
        {
          name: "Jam lalu",
          type: "line",
          smooth: true,
          lineStyle: {
            width: 2,
            type: "dashed",
            color: "#f97316",
          },
          data: previousData,
        },
      ],
    }
  }, [currentHour, previousHour])

  return (
    <section className="comparison-card">
      <header className="comparison-card-header">
        <div>
          <p className="comparison-card-title">Konsumsi KWh perbandingan</p>
          <p className="comparison-card-subtitle">5 menit terakhir vs 5 menit sebelumnya</p>
        </div>
        <span className={`comparison-card-status comparison-card-status--${status}`}>
          {status === "loading"
            ? "Memuat..."
            : status === "error"
            ? "Tidak bisa mengambil data"
            : "Terbarui setiap menit"}
        </span>
      </header>
      {status === "error" ? (
        <div className="comparison-card-error">Gagal memuat data historis.</div>
      ) : (
        <div className="comparison-card-chart">
          <ReactECharts option={option} style={{ height: 260, width: "100%" }} />
        </div>
      )}
    </section>
  )
}
