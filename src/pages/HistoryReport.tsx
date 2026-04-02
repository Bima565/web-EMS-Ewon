import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import "./style-HistoryReport.css"

const TRACKED_TAGS = [
  "pm139KWH",
  "pm139AR",
  "pm139P",
  "pm139App",
  "pm139VAN",
  "pm139F",
]

type WeeklyDay = {
  date: string
  label: string
  stats: Record<
    string,
    {
      avg: number | null
      last: number | null
      min: number | null
      max: number | null
    }
  >
}

type WeeklyResponse = {
  tags: string[]
  week: WeeklyDay[]
}

type DailyResponse = {
  date: string
  tags: Record<string, Array<{ timestamp: string; value: number }>>
}

type HourlyPoint = [number, number]

const API_BASE = "http://localhost:3000"
const WEEKLY_REFRESH_MS = 5 * 60 * 1000
const DAILY_REFRESH_MS = 30 * 1000

export default function HistoryReport() {
  const [weekData, setWeekData] = useState<WeeklyDay[]>([])
  const [loadingWeek, setLoadingWeek] = useState(false)
  const [weekError, setWeekError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState("")
  const [dailyCache, setDailyCache] = useState<Record<string, DailyResponse>>({})
  const [loadingDay, setLoadingDay] = useState(false)
  const [dayError, setDayError] = useState<string | null>(null)
  const [latestParams, setLatestParams] = useState<Array<{ tag: string; value: number | null }>>([])
  const [loadingLive, setLoadingLive] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const dailyCacheRef = useRef(dailyCache)

  useEffect(() => {
    setLoadingLive(true)
    setLiveError(null)

    fetch(`${API_BASE}/api/param-values`)
      .then(async (res) => {
        if (!res.ok) throw new Error("tidak bisa memuat data realtime")
        return (await res.json()) as Array<{ TagName: string; Value: number }>
      })
      .then((params) => {
        const filtered = params
          .filter((param) => TRACKED_TAGS.includes(param.TagName))
          .map((param) => ({
            tag: param.TagName,
            value: Number.isFinite(param.Value) ? param.Value : null,
          }))
        setLatestParams(filtered)
      })
      .catch((err) => {
        console.error(err)
        setLiveError("Gagal memuat data realtime")
      })
      .finally(() => {
        setLoadingLive(false)
      })
  }, [])

  const selectedMonth = useMemo(() => {
    if (!selectedDay) return ""
    return new Date(selectedDay).toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    })
  }, [selectedDay])

  useEffect(() => {
    dailyCacheRef.current = dailyCache
  }, [dailyCache])

  const fetchWeeklyData = useCallback(() => {
    setLoadingWeek(true)
    setWeekError(null)

    fetch(`${API_BASE}/api/logs/weekly`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("tidak bisa memuat data mingguan")
        }
        return (await res.json()) as WeeklyResponse
      })
      .then((data) => {
        setWeekData(data.week ?? [])
        setSelectedDay((prev) => prev || (data.week.at(-1)?.date ?? ""))
      })
      .catch((err) => {
        console.error(err)
        setWeekError("Gagal memuat data mingguan")
      })
      .finally(() => {
        setLoadingWeek(false)
      })
  }, [])

  useEffect(() => {
    fetchWeeklyData()
    const timer = setInterval(fetchWeeklyData, WEEKLY_REFRESH_MS)
    return () => clearInterval(timer)
  }, [fetchWeeklyData])

  const fetchDayDetail = useCallback(
    (date: string, force = false) => {
      if (!force && dailyCacheRef.current[date]) {
        return
      }
      setLoadingDay(true)
      setDayError(null)

      fetch(`${API_BASE}/api/logs/day/${date}`)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error("tidak bisa memuat detail harian")
          }
          return (await res.json()) as DailyResponse
        })
        .then((data) => {
          setDailyCache((prev) => ({ ...prev, [date]: data }))
        })
        .catch((err) => {
          console.error(err)
          setDayError("Gagal memuat detail hari ini")
        })
        .finally(() => {
          setLoadingDay(false)
        })
    },
    [],
  )

  useEffect(() => {
    if (!selectedDay) return
    fetchDayDetail(selectedDay)
  }, [selectedDay, fetchDayDetail])

  useEffect(() => {
    if (!selectedDay) return
    const interval = setInterval(() => fetchDayDetail(selectedDay, true), DAILY_REFRESH_MS)
    return () => clearInterval(interval)
  }, [selectedDay, fetchDayDetail])

  const handleSelectDay = (date: string) => {
    setSelectedDay(date)
  }

  const weeklyChartOption = useMemo(() => {
    if (!weekData.length) return null
    const categories = weekData.map(
      (day) => `${day.label} ${day.date.slice(5).replace("-", "/")}`,
    )
    const series = TRACKED_TAGS.map((tag) => ({
      name: tag,
      type: "line",
      smooth: true,
      connectNulls: false,
      data: weekData.map((day) => day.stats[tag]?.last ?? null),
      emphasis: {
        focus: "series",
      },
    }))

    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: any) => {
          if (!Array.isArray(params)) return ""
          const header = `${params[0]?.axisValue ?? ""}<br/>`
          const lines = params
            .map((item: any) => {
              const val = item?.data ?? "—"
              return `${item.marker} ${item.seriesName}: ${
                typeof val === "number" ? val.toLocaleString("id-ID", { maximumFractionDigits: 4 }) : "—"
              }`
            })
            .join("<br/>")
          return header + lines
        },
      },
      legend: {
        data: TRACKED_TAGS,
        top: 0,
        textStyle: {
          color: "rgba(248, 250, 252, 0.9)",
        },
      },
      grid: {
        left: "3%",
        right: "3%",
        bottom: "5%",
        top: "12%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: categories,
        axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.6)" } },
        axisLabel: { color: "rgba(248, 250, 252, 0.8)" },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisLabel: { color: "rgba(248, 250, 252, 0.8)" },
        splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.2)" } },
      },
      series,
    }
  }, [weekData])

const dailyDetail = selectedDay ? dailyCache[selectedDay] : undefined

const hourlyChartOption = useMemo(() => {
  if (!dailyDetail) return null

  const buildSeries = (): Array<{
    name: string
    type: "line"
    smooth: boolean
    showSymbol: boolean
    connectNulls: boolean
    emphasis: { focus: "series" }
    data: HourlyPoint[]
  }> =>
    TRACKED_TAGS.map((tag) => {
      const entries = (dailyDetail.tags[tag] ?? []).slice()
      entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      const data = entries.map(
        (entry) => [new Date(entry.timestamp).getTime(), Number(entry.value)] as HourlyPoint,
      )
      return {
        name: tag,
        type: "line",
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        emphasis: { focus: "series" },
        data,
      }
    })

  const series = buildSeries()

  const timestamps = series
    .flatMap((serie) => serie.data.map((point: [number, number]) => point[0]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)

  const BREAK_THRESHOLD_MS = 90 * 60 * 1000
  const BREAK_GAP = "1%"
  const breaks: Array<{ start: number; end: number; gap: string }> = []
  for (let i = 1; i < timestamps.length; i += 1) {
    const prev = timestamps[i - 1]
    const curr = timestamps[i]
    if (curr - prev > BREAK_THRESHOLD_MS) {
      breaks.push({ start: prev, end: curr, gap: BREAK_GAP })
    }
  }

  const selectedDayNumber = selectedDay ? Number(selectedDay.slice(-2)) : null

  const formatTime = (value: number) => {
    const date = new Date(value)
    const label = `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes(),
    ).padStart(2, "0")}`
    if (selectedDayNumber && date.getDate() !== selectedDayNumber) {
      return `${label}\n${date.getDate()}/${date.getMonth() + 1}`
    }
    return label
  }

  return {
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
      },
      formatter: (params: any) => {
        if (!Array.isArray(params)) return ""
        const header = formatTime(params[0]?.axisValue ?? 0)
        const lines = params
          .map((item: any) => {
            const val = item?.data?.[1] ?? "—"
            return `${item.marker} ${item.seriesName}: ${
              typeof val === "number" ? val.toLocaleString("id-ID", { maximumFractionDigits: 4 }) : "—"
            }`
          })
          .join("<br/>")
        return `${header}<br/>${lines}`
      },
    },
    legend: {
      data: TRACKED_TAGS,
      top: 0,
      textStyle: {
        color: "rgba(248, 250, 252, 0.9)",
      },
    },
    grid: {
      left: "3%",
      right: "3%",
      bottom: "18%",
      top: "12%",
      containLabel: true,
    },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.6)" } },
      axisLabel: { color: "rgba(248, 250, 252, 0.8)" },
      axisPointer: {
        label: {
          formatter: ({ value }: any) => formatTime(value),
        },
      },
      breaks,
      breakArea: {
        expandOnClick: false,
        zigzagAmplitude: 0,
        zigzagZ: 200,
        itemStyle: {
          borderColor: "none",
          opacity: 0,
        },
      },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: "rgba(248, 250, 252, 0.8)" },
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.2)" } },
      min: "auto",
    },
    dataZoom: [
      {
        type: "inside",
        minValueSpan: 3600 * 1000,
      },
      {
        type: "slider",
        top: "75%",
        minValueSpan: 3600 * 1000,
      },
    ],
    series,
  }
}, [dailyDetail, selectedDay])

  return (
    <main className="history-page">
      <section className="history-live-card">
        <header className="history-card-header">
          <div>
            <p className="history-card-meta">Live</p>
            <h1 className="history-card-title">Hari ini (Real-time)</h1>
            <p className="history-card-subtitle">
              {liveError
                ? liveError
                : loadingLive
                ? "Mengambil nilai terbaru..."
                : "Update terakhir langsung dari Ewon"}
            </p>
          </div>
          <span className="history-card-status">
            {loadingLive ? "Memuat..." : `${TRACKED_TAGS.length} tag`}
          </span>
        </header>
        <div className="history-live-grid">
          {latestParams.length
            ? latestParams.map((param) => (
                <article key={param.tag} className="history-live-metric">
                  <p className="history-live-label">{param.tag}</p>
                  <p className="history-live-value">
                    {param.value != null
                      ? param.value.toLocaleString("id-ID", { maximumFractionDigits: 4 })
                      : "—"}
                  </p>
                </article>
              ))
            : !loadingLive && !liveError && (
              <p className="history-live-empty">Tidak ada data real-time.</p>
            )}
        </div>
      </section>
      <section className="history-chart-card">
        <header className="history-card-header">
          <div>
            <p className="history-card-meta">History Report</p>
            <h1 className="history-card-title">Rekap Seminggu</h1>
            <p className="history-card-subtitle">
              {weekError
                ? weekError
                : selectedMonth
                ? `Menampilkan nilai ${selectedMonth}`
                : "Loading data..."}
            </p>
          </div>
          <span className="history-card-status">
            {loadingWeek ? "Memuat..." : `${TRACKED_TAGS.length} tag`}
          </span>
        </header>
        <div className="history-chart-wrapper">
          {weeklyChartOption ? (
            <ReactECharts option={weeklyChartOption} style={{ height: 360 }} />
          ) : (
            <div className="history-chart-empty">
              {weekError || "Menunggu data untuk grafik mingguan."}
            </div>
          )}
        </div>
      </section>

      <section className="history-day-grid">
        {weekData.map((day) => {
          const isActive = selectedDay === day.date
          const dayValues = TRACKED_TAGS.map((tag) => ({
            tag,
            value: day.stats[tag]?.last,
          }))
          return (
            <article
              key={day.date}
              className={`history-day-card ${isActive ? "history-day-card--active" : ""}`}
            >
              <header className="history-day-card-header">
                <div>
                  <h3>{day.label}</h3>
                  <p>{day.date}</p>
                </div>
                <button type="button" onClick={() => handleSelectDay(day.date)}>
                  {isActive ? "Tampilkan per jam" : "Lihat detail"}
                </button>
              </header>
              <div className="history-day-metrics">
                {dayValues.map((metric) => (
                  <div key={metric.tag} className="history-day-metric">
                    <span className="history-day-metric-label">{metric.tag}</span>
                    <strong className="history-day-metric-value">
                      {metric.value != null
                        ? metric.value.toLocaleString("id-ID", { maximumFractionDigits: 4 })
                        : "—"}
                    </strong>
                  </div>
                ))}
              </div>
              {isActive && (
                <div className="history-day-detail">
                  {loadingDay && !dailyDetail && <p>Memuat data harian...</p>}
                  {dayError && <p className="history-day-error">{dayError}</p>}
                  {hourlyChartOption && (
                    <ReactECharts option={hourlyChartOption} style={{ height: 280 }} />
                  )}
                </div>
              )}
            </article>
          )
        })}
      </section>
    </main>
  )
}
