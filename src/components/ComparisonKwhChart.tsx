import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { useLiveParams } from "../hooks/useLiveParams"
import "./style-ComparisonKwhChart.css"

const WINDOW_MS = 5 * 60 * 1000
const PARAM_TAG = "pm139KWH"

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
  const { history: liveHistory, status, lastSync } = useLiveParams()
  const history = liveHistory[PARAM_TAG] ?? []

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
      : lastSync == null
      ? "Menunggu data"
      : `Last sync: ${formatTimestamp(lastSync)}`

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
