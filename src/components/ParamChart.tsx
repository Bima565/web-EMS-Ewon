import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { getHistory, getParamValues, type ParamValue } from "../api/api"
import "./style-ParamChart.css"

const FETCH_INTERVAL_MS = 2000
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
}> = [
  { tag: "pm139Status", label: "Status PM139", unit: "", accent: "#22d3ee" },
  { tag: "pm139KWH", label: "Energi", unit: "kWh", accent: "#4ade80" },
  { tag: "pm139AR", label: "Ampere", unit: "A", accent: "#22c55e" },
  { tag: "pm139P", label: "Daya nyata", unit: "kW", accent: "#a855f7" },
  { tag: "pm139App", label: "Daya semu", unit: "kVA", accent: "#f97316" },
  { tag: "pm139VAN", label: "Tegangan VAN", unit: "V", accent: "#38bdf8" },
  { tag: "pm139F", label: "Frekuensi", unit: "Hz", accent: "#facc15" },
]

const CHART_TAGS = CHART_PARAMETERS.map((parameter) => parameter.tag)
const STORAGE_KEY = "web-ewon:param-chart-live-history"

const parseStoredHistory = () => {
  if (typeof window === "undefined") return {}
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, LiveHistoryRow[]>
  } catch (error) {
    console.error("param chart: failed to parse stored history", error)
    return {}
  }
}

const isWithinWindow = (timestamp: number, now: number) => timestamp >= now - HISTORY_WINDOW_MS

const pruneEntries = (entries: LiveHistoryRow[], now: number) =>
  entries.filter((entry) => isWithinWindow(entry.timestamp, now))

const getInitialLiveHistory = () => {
  const stored = parseStoredHistory()
  const now = Date.now()
  return CHART_TAGS.reduce<Record<string, LiveHistoryRow[]>>((acc, tag) => {
    const cached = stored[tag] ?? []
    acc[tag] = pruneEntries(cached, now)
    return acc
  }, {})
}

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

const persistLiveHistory = (history: Record<string, LiveHistoryRow[]>) => {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch (error) {
    console.error("param chart: failed to persist history", error)
  }
}

export default function ParamChart() {
  const [params, setParams] = useState<ParamValue[]>([])
  const [status, setStatus] = useState<"loading" | "error" | "idle">("loading")
  const [historyStatus, setHistoryStatus] = useState<"loading" | "error" | "idle">("loading")
  const [liveHistory, setLiveHistory] = useState<Record<string, LiveHistoryRow[]>>(getInitialLiveHistory)

  const paramsByName = useMemo(() => {
    const map = new Map<string, ParamValue>()
    for (const param of params) {
      map.set(param.TagName.toLowerCase(), param)
    }
    return map
  }, [params])

  useEffect(() => {
    let mounted = true

    const applyUpdates = (updates: Record<string, LiveHistoryRow[]>) => {
      setLiveHistory((prev) => {
        const now = Date.now()
        const next: Record<string, LiveHistoryRow[]> = { ...prev }
        for (const tag of CHART_TAGS) {
          const incoming = updates[tag] ?? []
          const base = next[tag] ?? []
          next[tag] = pruneEntries([...base, ...incoming], now)
        }
        persistLiveHistory(next)
        return next
      })
    }

    const appendLiveEntry = (data: ParamValue[]) => {
      const now = Date.now()
      const updates: Record<string, LiveHistoryRow[]> = {}
      for (const metric of CHART_PARAMETERS) {
        const match = data.find(
          (param) => param.TagName.toLowerCase() === metric.tag.toLowerCase(),
        )
        if (match && Number.isFinite(match.Value)) {
          updates[metric.tag] = [{ timestamp: now, value: match.Value }]
        }
      }
      applyUpdates(updates)
    }

    const loadParams = async (showLoading = false) => {
      if (!mounted) return
      if (showLoading) setStatus("loading")

      try {
        const data = await getParamValues()
        if (!mounted) return
        setParams(data)
        appendLiveEntry(data)
        setStatus("idle")
      } catch (error) {
        if (!mounted) return
        console.error("param fetch", error)
        setStatus("error")
      }
    }

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
        applyUpdates(updates)
        setHistoryStatus("idle")
      } catch (error) {
        if (!mounted) return
        console.error("param history fetch", error)
        setHistoryStatus("error")
      }
    }

    loadHistories(true)
    loadParams(true)
    const timer = setInterval(loadParams, FETCH_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

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
                const axisOption = {
                  type: "category",
                  boundaryGap: false,
                  data: labels,
                  axisLine: {
                    lineStyle: { color: "rgba(148,163,184,0.4)" },
                  },
                  axisLabel: {
                    color: "rgba(148,163,184,0.8)",
                    fontSize: 11,
                  },
                }

                const markAreaIndices = {
                  morningStart: Math.min(6, labels.length - 1),
                  morningEnd: Math.min(9, labels.length - 1),
                  eveningStart: Math.min(14, labels.length - 1),
                  eveningEnd: Math.min(17, labels.length - 1),
                }

                return {
                  color: [chartParam.accent],
                  tooltip: {
                    trigger: "axis",
                    backgroundColor: "rgba(15,23,42,0.85)",
                    textStyle: {
                      color: "#f8fafc",
                    },
                  },
                  toolbox: {
                    show: true,
                    feature: {
                      saveAsImage: {},
                    },
                  },
                  grid: {
                    left: "3%",
                    right: "3%",
                    bottom: "6%",
                    top: "6%",
                    containLabel: true,
                  },
                  xAxis: axisOption,
                  yAxis: {
                    type: "value",
                    axisLine: {
                      show: false,
                    },
                    axisLabel: {
                      color: "rgba(148,163,184,0.9)",
                      fontSize: 11,
                    },
                    splitLine: {
                      lineStyle: {
                        color: "rgba(148,163,184,0.12)",
                      },
                    },
                  },
                  visualMap: {
                    show: false,
                    dimension: 0,
                    pieces: [
                      { lte: 6, color: "green" },
                      { gt: 6, lte: 8, color: "red" },
                      { gt: 8, lte: 14, color: "green" },
                      { gt: 14, lte: 17, color: "red" },
                      { gt: 17, color: "green" },
                    ],
                  },
                  series: [
                    {
                      type: "line",
                      smooth: true,
                      showSymbol: hasDataToPlot,
                      symbolSize: 5,
                      areaStyle: hasDataToPlot
                        ? { opacity: 0.2, color: chartParam.accent }
                        : undefined,
                      lineStyle: {
                        width: 2,
                      },
                      emphasis: {
                        focus: "series",
                      },
                      data: values,
                      markArea: {
                        data: [
                          [
                            {
                              name: "Morning Peak",
                              xAxis: markAreaIndices.morningStart,
                            },
                            { xAxis: markAreaIndices.morningEnd },
                          ],
                          [
                            {
                              name: "Evening Peak",
                              xAxis: markAreaIndices.eveningStart,
                            },
                            { xAxis: markAreaIndices.eveningEnd },
                          ],
                        ],
                        itemStyle: {
                          color: "rgba(255, 173, 177, 0.3)",
                        },
                      },
                    },
                  ],
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
