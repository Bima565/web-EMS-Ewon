import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { getParamValues } from "../api/api"
import "./style-ComparisonKwhChart.css"

const FETCH_INTERVAL_MS = 5000
const WINDOW_MS = 5 * 60 * 1000
const HISTORY_WINDOW_MS = WINDOW_MS * 2
const PARAM_TAG = "pm139KWH"
const STORAGE_KEY = "web-ewon:param-chart-live-history"

type ChartPoint = {
  timestamp: number
  value: number
}

const formatTimestamp = (value: number) =>
  new Date(value).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })

const buildSeries = (points: ChartPoint[]) =>
  points.map((row) => [row.timestamp, Number(row.value.toFixed?.(3) ?? row.value)])

const readStoredHistory = (): ChartPoint[] => {
  if (typeof window === "undefined") return []
  const storedText = window.localStorage.getItem(STORAGE_KEY)
  if (!storedText) return []

  try {
    const parsed = JSON.parse(storedText) as Record<string, ChartPoint[]>
    const cutoff = Date.now() - HISTORY_WINDOW_MS
    return (parsed[PARAM_TAG] ?? [])
      .filter(
        (entry) =>
          entry &&
          Number.isFinite(entry.timestamp) &&
          Number.isFinite(entry.value) &&
          entry.timestamp >= cutoff,
      )
  } catch (error) {
    console.error("failed parse history", error)
    return []
  }
}

const pruneHistory = (entries: ChartPoint[], now: number) =>
  entries.filter((entry) => entry.timestamp >= now - HISTORY_WINDOW_MS)

const buildOption = (points: ChartPoint[], title: string) => ({
  title: {
    text: title,
    left: "center",
    textStyle: { color: "#0f172a", fontSize: 12 },
  },
  tooltip: {
    trigger: "axis",
    formatter: (params: any) => {
      if (!Array.isArray(params)) return ""
      return params
        .map(
          (item) =>
            `${item.marker} ${item.value?.[1]?.toFixed?.(3) ?? item.value?.[1]} kWh`,
        )
        .join("<br/>")
    },
  },
  grid: {
    left: "5%",
    right: "5%",
    top: "20%",
    bottom: "15%",
    containLabel: true,
  },
  xAxis: {
    type: "time",
    axisLabel: {
      formatter: formatTimestamp,
    },
  },
yAxis: {
  type: "value",
  scale: true,
  min: (v: any) => {
    const range = Math.max(v.max - v.min, 0.05)
    return v.min - range * 0.2
  },
  max: (v: any) => {
    const range = Math.max(v.max - v.min, 0.05)
    return v.max + range * 0.2
  },
},
  series: [
    {
      type: "line",
      smooth: true,
      showSymbol: false,
      data: buildSeries(points),
    },
  ],
})

const getDelta = (points: ChartPoint[]) => {
  if (points.length < 2) return 0
  return points[points.length - 1].value - points[0].value
}

export default function ComparisonKwhChart() {
  const [history, setHistory] = useState<ChartPoint[]>(readStoredHistory)
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading")
  const [lastSync, setLastSync] = useState<string>("—")

  useEffect(() => {
    let mounted = true

    const load = async (showLoading = false) => {
      if (!mounted) return
      if (showLoading) setStatus("loading")

      try {
        const params = await getParamValues()
        if (!mounted) return

        const match = params.find(
          (p) => p.TagName.toLowerCase() === PARAM_TAG.toLowerCase(),
        )

        if (!match || !Number.isFinite(match.Value)) {
          throw new Error("nilai tidak valid")
        }

        const timestamp = Date.now()

        setHistory((prev) => {
          const next = [...prev, { timestamp, value: match.Value }]
          return pruneHistory(next, timestamp)
        })

        setLastSync(formatTimestamp(timestamp))
        setStatus("idle")
      } catch (err) {
        console.error(err)
        if (mounted) setStatus("error")
      }
    }

    load(true)

    const interval = setInterval(() => load(), FETCH_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const { currentPoints, previousPoints } = useMemo(() => {
    const now = Date.now()
    const currentStart = now - WINDOW_MS
    const previousStart = currentStart - WINDOW_MS

    const currentPoints = history
      .filter((e) => e.timestamp >= currentStart)
      .sort((a, b) => a.timestamp - b.timestamp)

    const previousPoints = history
      .filter((e) => e.timestamp >= previousStart && e.timestamp < currentStart)
      .sort((a, b) => a.timestamp - b.timestamp)

    return { currentPoints, previousPoints }
  }, [history])

  const statusMessage =
    status === "loading"
      ? "Memuat..."
      : status === "error"
      ? "Gagal ambil data"
      : lastSync === "—"
      ? "Menunggu data"
      : `Last sync: ${lastSync}`

  return (
    <section className="comparison-card">
      <header className="comparison-card-header">
        <div>
          <p className="comparison-card-title">Konsumsi KWh</p>
          <p className="comparison-card-subtitle">
            5 menit terakhir vs 5 menit sebelumnya
          </p>
        </div>
        <span className={`comparison-card-status comparison-card-status--${status}`}>
          {statusMessage}
        </span>
      </header>

      {status === "error" ? (
        <div className="comparison-card-error">Gagal memuat data</div>
      ) : (
        <>
          {/* DELTA INFO */}
          <div style={{ display: "flex", justifyContent: "space-around", marginBottom: 10 }}>
            <div>
              <strong>5 menit sebelumnya</strong>
              <p>{getDelta(previousPoints).toFixed(3)} kWh</p>
            </div>
            <div>
              <strong>5 menit terakhir</strong>
              <p>{getDelta(currentPoints).toFixed(3)} kWh</p>
            </div>
          </div>

          {/* 2 CHART */}
          <div style={{ display: "flex", gap: 12 }}>
            <ReactECharts
              option={buildOption(previousPoints, "5 Menit Sebelumnya")}
              style={{ height: 260, width: "50%" }}
            />
            <ReactECharts
              option={buildOption(currentPoints, "5 Menit Terakhir")}
              style={{ height: 260, width: "50%" }}
            />
          </div>
        </>
      )}
    </section>
  )
}