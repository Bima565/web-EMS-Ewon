import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { getHistory, type ParamValue } from "../api/api"
import { useLiveParams } from "../hooks/useLiveParams"
import "./style-ParamChart.css"

const HISTORY_WINDOW_MS = 60 * 60 * 1000

type LiveHistoryRow = {
  timestamp: number
  value: number
}

type HistoryRow = {
  created: string
  tagvalue: number
}

const CONNECTION_LABEL: Record<"loading" | "error" | "idle", string> = {
  loading: "memuat",
  error: "error",
  idle: "online",
}

const CONNECTION_COLOR: Record<"loading" | "error" | "idle", string> = {
  loading: "param-status-loading",
  error: "param-status-error",
  idle: "param-status-idle",
}

const CHART_PARAMETERS: Array<{
  tag: string
  label: string
  unit?: string
  accent: string
  decimals: number
  zoomPaddingRatio: number
  zoomMinPad: number
}> = [
  { tag: "pm139KWH", label: "Energi", unit: "kWh", accent: "#4ade80", decimals: 3, zoomPaddingRatio: 0.35, zoomMinPad: 0.01 },
  { tag: "pm139AR", label: "Ampere", unit: "A", accent: "#22c55e", decimals: 3, zoomPaddingRatio: 0.35, zoomMinPad: 0.02 },
  { tag: "pm139P", label: "Daya nyata", unit: "kW", accent: "#a855f7", decimals: 3, zoomPaddingRatio: 0.35, zoomMinPad: 0.01 },
  { tag: "pm139App", label: "Daya semu", unit: "kVA", accent: "#f97316", decimals: 3, zoomPaddingRatio: 0.35, zoomMinPad: 0.01 },
  { tag: "pm139VAN", label: "Tegangan VAN", unit: "V", accent: "#38bdf8", decimals: 1, zoomPaddingRatio: 0.5, zoomMinPad: 1 },
  { tag: "pm139F", label: "Frekuensi", unit: "Hz", accent: "#facc15", decimals: 2, zoomPaddingRatio: 0.6, zoomMinPad: 0.08 },
]

const CHART_TAGS = CHART_PARAMETERS.map((parameter) => parameter.tag)

// Format angka ke gaya Indonesia (titik ribuan, koma desimal) untuk axis & tooltip ECharts.
const formatAxisNumber = (value: number, decimals: number) =>
  value.toLocaleString("id-ID", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

const formatTooltipNumber = (value: number, decimals: number) =>
  Number.isFinite(value) ? formatAxisNumber(value, decimals) : "-"

// Hitung rentang sumbu Y yang "di-zoom" ke sekitar data aktual (bukan dari 0),
// supaya lonjakan kecil pada parameter yang nilainya relatif rapat (mis. tegangan,
// arus, frekuensi) tetap kelihatan jelas alih-alih tampak rata.
const computeZoomedRange = (values: number[], paddingRatio: number, minPad: number) => {
  if (!values.length) return null
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const mid = (minVal + maxVal) / 2
  const span = maxVal - minVal
  const pad = Math.max(span * paddingRatio, minPad)
  return {
    min: parseFloat((mid - pad).toFixed(4)),
    max: parseFloat((mid + pad).toFixed(4)),
  }
}

const isWithinWindow = (timestamp: number, now: number) => timestamp >= now - HISTORY_WINDOW_MS

const pruneEntries = (entries: LiveHistoryRow[], now: number) =>
  entries.filter((entry) => isWithinWindow(entry.timestamp, now))

const formatTimestamp = (value: number) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

export default function ParamChart() {
  const { params, history: sharedHistory, status } = useLiveParams()
  const [historyStatus, setHistoryStatus] = useState<"loading" | "error" | "idle">("loading")
  const [historyOverrides, setHistoryOverrides] = useState<Record<string, LiveHistoryRow[]>>({})

  const paramsByName = useMemo(() => {
    const map = new Map<string, ParamValue>()
    for (const param of params) {
      map.set(param.TagName.toLowerCase(), param)
    }
    return map
  }, [params])

  useEffect(() => {
    let mounted = true

    const loadHistories = async (showLoading = false) => {
      if (!mounted) return
      if (showLoading) setHistoryStatus("loading")

      try {
        const now = Date.now()
        const results = await Promise.all(
          CHART_PARAMETERS.map(async (chart) => {
            const raw = await getHistory(chart.tag)
            const cleaned: HistoryRow[] = Array.isArray(raw)
              ? raw
                  .map((row) => ({
                    created: String(row?.created ?? ""),
                    tagvalue: Number(row?.tagvalue ?? ""),
                  }))
                  .filter(
                    (entry) =>
                      entry.created.length > 0 &&
                      Number.isFinite(entry.tagvalue) &&
                      isWithinWindow(new Date(entry.created).getTime(), now),
                  )
              : []
            return [chart.tag, cleaned] as const
          }),
        )

        if (!mounted) return
        const updates: Record<string, LiveHistoryRow[]> = {}
        for (const [tag, rows] of results) {
          updates[tag] = rows.map((row) => ({
            timestamp: new Date(row.created).getTime(),
            value: row.tagvalue,
          }))
        }
        setHistoryOverrides((prev) => {
          const now = Date.now()
          const next = { ...prev }
          for (const tag of CHART_TAGS) {
            next[tag] = pruneEntries(updates[tag] ?? prev[tag] ?? [], now)
          }
          return next
        })
        setHistoryStatus("idle")
      } catch (error) {
        if (!mounted) return
        console.error("param history fetch", error)
        setHistoryStatus("error")
      }
    }

    loadHistories(true)

    const refreshTimer = window.setInterval(() => {
      void loadHistories(false)
    }, 60 * 1000)

    const pruneTimer = window.setInterval(() => {
      setHistoryOverrides((prev) => {
        const now = Date.now()
        const next: Record<string, LiveHistoryRow[]> = {}
        for (const tag of CHART_TAGS) {
          next[tag] = pruneEntries(prev[tag] ?? [], now)
        }
        return next
      })
    }, 30 * 1000)

    return () => {
      mounted = false
      window.clearInterval(refreshTimer)
      window.clearInterval(pruneTimer)
    }
  }, [])

  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 30 * 1000)
    return () => window.clearInterval(t)
  }, [])

  const liveHistory = useMemo(() => {
    return CHART_TAGS.reduce<Record<string, LiveHistoryRow[]>>((acc, tag) => {
      const shared = (sharedHistory[tag] ?? []).map((entry) => ({
        timestamp: entry.timestamp,
        value: entry.value,
      }))
      const override = historyOverrides[tag] ?? []
      const merged = shared.length > 0 ? shared : override
      acc[tag] = pruneEntries(merged, nowTick)
      return acc
    }, {})
  }, [historyOverrides, sharedHistory, nowTick])

  const formatValue = (value: number) =>
    Number.isFinite(value)
      ? value.toLocaleString("id-ID", {
          maximumFractionDigits: 4,
        })
      : "—"

  return (
    <section className="param-chart-section">
      <header className="param-chart-header">
        <div>
          <p className="param-chart-subtitle">API live</p>
          <h2 className="param-chart-title">Param monitoring</h2>
          {historyStatus === "error" && (
            <p className="param-chart-error">Riwayat parameter tidak tersedia</p>
          )}
        </div>
        <span className={`param-chart-status ${CONNECTION_COLOR[status]}`}>
          {CONNECTION_LABEL[status]}
        </span>
      </header>

      <div className="param-chart-grid">
        {CHART_PARAMETERS.map((chartParam) => {
          const paramValue = paramsByName.get(chartParam.tag.toLowerCase())
          const historyRows = liveHistory[chartParam.tag] ?? []
          const sortedHistory = [...historyRows].sort((a, b) => a.timestamp - b.timestamp)
          const labels = sortedHistory.map((row) => formatTimestamp(row.timestamp))
          const values = sortedHistory.map((row) => row.value)
          const hasHistory = values.length > 0

          const latestLabel = labels.at(-1)
          const hasDataToPlot = hasHistory

          const historyMessage =
            historyStatus === "error"
              ? "Riwayat tidak tersedia"
              : hasHistory
              ? latestLabel
                ? `Terakhir ${latestLabel}`
                : "Menunggu data"
              : historyStatus === "loading"
              ? "Memuat riwayat..."
              : "Menunggu data"

          const statusBadgeClass =
            paramValue == null
              ? "param-badge-unknown"
              : paramValue.AlStatus === 0
              ? "param-badge-normal"
              : "param-badge-alarm"

          const statusBadgeLabel = paramValue == null ? "—" : paramValue.AlStatus === 0 ? "Normal" : "Alarm"

          const displayValue = paramValue != null ? formatValue(paramValue.Value) : "—"

          const chartOption = hasHistory
            ? (() => {
                const accent = chartParam.accent
                const accentMid = accent + "55"
                const accentFade = accent + "18"

                const isStairStep = chartParam.tag === "pm139KWH"
                const isFreq = chartParam.tag === "pm139F"

                const commonGrid = { left: 0, right: 6, bottom: 18, top: 8, containLabel: true }

                const zoomRange = computeZoomedRange(
                  values,
                  chartParam.zoomPaddingRatio,
                  chartParam.zoomMinPad,
                )

                const commonXAxis = {
                  type: "category" as const,
                  boundaryGap: false,
                  data: labels,
                  axisLine: { show: false },
                  axisTick: { show: false },
                  axisLabel: {
                    color: "rgba(148,163,184,0.55)",
                    fontSize: 9,
                    interval: Math.max(0, Math.floor(labels.length / 4) - 1),
                  },
                  splitLine: { show: false },
                }

                const commonYAxis = {
                  type: "value" as const,
                  ...(zoomRange ?? {}),
                  axisLine: { show: false },
                  axisTick: { show: false },
                  axisLabel: {
                    color: "rgba(148,163,184,0.55)",
                    fontSize: 9,
                    formatter: (v: number) =>
                      Math.abs(v) >= 1000
                        ? `${(v / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}k`
                        : formatAxisNumber(v, chartParam.decimals),
                  },
                  splitLine: {
                    lineStyle: { color: "rgba(148,163,184,0.07)", type: "dashed" as const },
                  },
                }

                const commonTooltip = {
                  trigger: "axis" as const,
                  backgroundColor: "rgba(2,6,23,0.95)",
                  borderColor: accent + "44",
                  borderWidth: 1,
                  padding: [6, 10],
                  textStyle: { color: "#f8fafc", fontSize: 11 },
                  formatter: (params: any[]) => {
                    const p = params[0]
                    const displayValue = formatTooltipNumber(Number(p.value), chartParam.decimals)
                    return `<span style="color:${accent};font-size:13px;font-weight:700">${displayValue}</span>&nbsp;<span style="color:rgba(148,163,184,0.7)">${chartParam.unit ?? ""}</span><br/><span style="color:rgba(148,163,184,0.5);font-size:10px">${p.name}</span>`
                  },
                }

                const linearFill = {
                  type: "linear" as const,
                  x: 0, y: 0, x2: 0, y2: 1,
                  colorStops: [
                    { offset: 0, color: accentMid },
                    { offset: 1, color: accentFade },
                  ],
                }

                if (isStairStep) {
                  return {
                    tooltip: commonTooltip,
                    grid: commonGrid,
                    xAxis: commonXAxis,
                    yAxis: commonYAxis,
                    series: [{
                      type: "line" as const,
                      step: "end" as const,
                      data: values,
                      showSymbol: false,
                      lineStyle: { color: accent, width: 2 },
                      areaStyle: { color: linearFill },
                    }],
                  }
                }

                if (isFreq) {
                  return {
                    tooltip: commonTooltip,
                    grid: commonGrid,
                    xAxis: commonXAxis,
                    yAxis: commonYAxis,
                    series: [{
                      type: "line" as const,
                      data: values,
                      smooth: 0.4,
                      showSymbol: false,
                      lineStyle: { color: accent, width: 1.5 },
                      areaStyle: { color: linearFill },
                      markLine: {
                        silent: true,
                        symbol: "none",
                        data: [{ type: "average" as const }],
                        lineStyle: { color: accent, type: "dashed" as const, width: 1, opacity: 0.5 },
                        label: {
                          color: accent,
                          fontSize: 9,
                          formatter: (p: any) =>
                            `avg ${formatAxisNumber(Number(p.value), chartParam.decimals)} Hz`,
                        },
                      },
                    }],
                  }
                }

                return {
                  tooltip: commonTooltip,
                  grid: commonGrid,
                  xAxis: commonXAxis,
                  yAxis: commonYAxis,
                  series: [{
                    type: "line" as const,
                    data: values,
                    smooth: 0.5,
                    showSymbol: values.length <= 20,
                    symbolSize: 4,
                    symbol: "circle",
                    itemStyle: { color: accent },
                    lineStyle: { color: accent, width: 2 },
                    areaStyle: { color: linearFill },
                    emphasis: {
                      scale: true,
                      itemStyle: { borderWidth: 2, borderColor: "#fff", color: accent },
                    },
                  }],
                }
              })()
            : undefined

          const trendClass = (() => {
            if (values.length < 2) return ""
            const previous = values.at(-2)
            const latest = values.at(-1)
            if (!Number.isFinite(previous ?? Number.NaN) || !Number.isFinite(latest ?? Number.NaN)) {
              return ""
            }
            if (latest! > previous!) return "param-card-value--up"
            if (latest! < previous!) return "param-card-value--down"
            return ""
          })()

          return (
            <article key={chartParam.tag} className="param-card">
              <div className="param-card-header">
                <span className="param-card-name">{chartParam.label}</span>
                <span className={`param-card-badge ${statusBadgeClass}`}>{statusBadgeLabel}</span>
              </div>

              <div>
                <p className="param-card-tag">{paramValue?.TagName ?? chartParam.tag}</p>
                <p className={`param-card-value ${trendClass}`}>
                  {displayValue}
                  {chartParam.unit && <span className="param-card-unit">{chartParam.unit}</span>}
                </p>
              </div>

              <div className="param-card-chart">
                {chartOption ? (
                  <ReactECharts option={chartOption} style={{ height: "100%" }} />
                ) : (
                  <div className="param-card-placeholder">{historyMessage}</div>
                )}
              </div>

              <div className="param-card-footer">
                <span>{historyMessage}</span>
                <span>Tag {paramValue?.TagId ?? "—"}</span>
              </div>
            </article>
          )
        })}
      </div>

      {!params.length && status !== "error" && <div className="param-empty">Menunggu data Param...</div>}
      {status === "error" && (
        <div className="param-error">Tidak dapat mengakses API live param monitoring.</div>
      )}
    </section>
  )
}