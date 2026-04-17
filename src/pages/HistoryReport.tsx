import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import * as XLSX from "xlsx"
import { useLiveParams } from "../hooks/useLiveParams"
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
  consumptionKwh?: number | null
  costEstimateIdr?: number | null
  stats: Record<
    string,
    {
      avg: number | null
      last: number | null
      min: number | null
      max: number | null
    }
  >
  displayDate?: string
  coverage?: {
    expectedHours: number
    loggedHours: number
    completeHours: number
    missingHours: number
    progress: number
    hasLoss: boolean
  }
}

type WeeklyResponse = {
  tags: string[]
  week: WeeklyDay[]
}

type DailyResponse = {
  date: string
  tags: Record<string, Array<{ timestamp: string; value: number }>>
}

type WeeklyTableRow = {
  day: WeeklyDay
  tagDetails: Array<{ tag: string; value: number | null }>
  costEstimateIdr: number | null
  progress: number
  progressText: string
  lossLabel: string
}

type DayDetailMetricConfig = {
  tag: string
  label: string
  unit: string
  color: string
  standard: number
  standardLabel: string
  summaryMode: "avg" | "last"
  decimals?: number
}

type DayDetailMetric = DayDetailMetricConfig & {
  value: number | null
  average: number | null
  last: number | null
  min: number | null
  max: number | null
  fillPercent: number
}

type HourlyMetricPoint = {
  hour: number
  label: string
  value: number | null
}

const API_BASE = "http://localhost:3000"
const WEEKLY_REFRESH_MS = 5 * 60 * 1000
const DAILY_REFRESH_MS = 30 * 1000
const WEEKLY_FETCH_TIMEOUT_MS = 12000
const REPORT_TIME_ZONE = "Asia/Jakarta"

const HISTORY_REPORT_CACHE_KEY = "web-ewon:history-report:v3"

const DAY_DETAIL_CONFIG: DayDetailMetricConfig[] = [
  {
    tag: "pm139KWH",
    label: "Energi",
    unit: "kWh",
    color: "#34d399",
    standard: 25,
    standardLabel: "Patokan laporan 25 kWh",
    summaryMode: "last",
    decimals: 3,
  },
  {
    tag: "pm139AR",
    label: "Arus R",
    unit: "A",
    color: "#38bdf8",
    standard: 1,
    standardLabel: "Patokan operasi 1 A",
    summaryMode: "avg",
    decimals: 3,
  },
  {
    tag: "pm139P",
    label: "Daya nyata",
    unit: "kW",
    color: "#a855f7",
    standard: 1,
    standardLabel: "Patokan operasi 1 kW",
    summaryMode: "avg",
    decimals: 3,
  },
  {
    tag: "pm139App",
    label: "Daya semu",
    unit: "kVA",
    color: "#f97316",
    standard: 1,
    standardLabel: "Patokan operasi 1 kVA",
    summaryMode: "avg",
    decimals: 3,
  },
  {
    tag: "pm139VAN",
    label: "Tegangan VAN",
    unit: "V",
    color: "#22d3ee",
    standard: 220,
    standardLabel: "Nominal 220 V",
    summaryMode: "avg",
    decimals: 1,
  },
  {
    tag: "pm139F",
    label: "Frekuensi",
    unit: "Hz",
    color: "#facc15",
    standard: 50,
    standardLabel: "Nominal 50 Hz",
    summaryMode: "avg",
    decimals: 3,
  },
]

const EXPORT_WEEKLY_HEADERS = [
  "Hari",
  "Tanggal",
  "Cost Harian (Rp)",
  "Progress (%)",
  ...DAY_DETAIL_CONFIG.map((metric) => `${metric.label} (${metric.unit})`),
]

const EXPORT_HOURLY_HEADERS = [
  "Jam",
  ...DAY_DETAIL_CONFIG.map((metric) => `${metric.label} (${metric.unit})`),
]

const normalizeWeeklyData = (entries: WeeklyDay[]) => {
  if (!entries.length) return []
  return [...entries]
    .map((entry) => {
      const dateObject = new Date(entry.date)
      const computedDisplayDate =
        entry.displayDate ??
        dateObject.toLocaleDateString("id-ID", {
          weekday: "short",
          day: "2-digit",
          month: "short",
        })
      return {
        ...entry,
        displayDate: computedDisplayDate,
      }
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

const formatCurrencyValue = (value: number | null) =>
  value != null
    ? `Rp${value.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`
    : "-"

const formatMetricValue = (
  value: number | null,
  unit: string,
  maximumFractionDigits = 3,
) =>
  value != null
    ? `${value.toLocaleString("id-ID", { maximumFractionDigits })} ${unit}`
    : `- ${unit}`

const getHourInTimeZone = (timestamp: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  })
  const parts = formatter.formatToParts(new Date(timestamp))
  const hourPart = parts.find((part) => part.type === "hour")?.value ?? "0"
  return Number(hourPart)
}

const getDateKeyInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce(
      (acc, part) => {
        if (part.type === "year" || part.type === "month" || part.type === "day") {
          acc[part.type] = part.value
        }
        return acc
      },
      { year: "", month: "", day: "" } as Record<string, string>,
    )

  return `${parts.year}-${parts.month}-${parts.day}`
}

const buildHourlySeries = (
  entries: Array<{ timestamp: string; value: number }>,
  summaryMode: "avg" | "last",
) => {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    values: [] as number[],
  }))

  entries.forEach((entry) => {
    const hour = getHourInTimeZone(entry.timestamp, REPORT_TIME_ZONE)
    const bucket = buckets[hour]
    if (!bucket) return
    bucket.values.push(Number(entry.value))
  })

  return buckets.map((bucket) => {
    const value =
      bucket.values.length === 0
        ? null
        : summaryMode === "last"
        ? bucket.values.at(-1) ?? null
        : bucket.values.reduce((acc, current) => acc + current, 0) / bucket.values.length

    return {
      hour: bucket.hour,
      label: `${String(bucket.hour).padStart(2, "0")}:00`,
      value,
    }
  }) as HourlyMetricPoint[]
}

const buildHourlyExportRows = (day: WeeklyDay, dailyDetail: DailyResponse | null) => {
  const metricSeries = DAY_DETAIL_CONFIG.map((metric) => {
    const rawEntries = (dailyDetail?.tags[metric.tag] ?? []).filter((entry) =>
      Number.isFinite(entry.value),
    )
    return {
      metric,
      series: buildHourlySeries(rawEntries, metric.summaryMode),
    }
  })

  return Array.from({ length: 24 }, (_, hour) => {
    const record: Record<string, string | number | null> = {
      Hari: day.label,
      Tanggal: day.displayDate ?? day.date,
      Jam: `${String(hour).padStart(2, "0")}:00`,
    }

    metricSeries.forEach(({ metric, series }) => {
      const columnName = `${metric.label} (${metric.unit})`
      record[columnName] = series[hour]?.value ?? null
    })

    return record
  })
}

const fetchDailyReport = async (date: string): Promise<DailyResponse> => {
  const res = await fetch(`${API_BASE}/api/logs/day/${date}`)
  if (!res.ok) {
    throw new Error("tidak bisa memuat detail harian")
  }
  return (await res.json()) as DailyResponse
}

type HistoryReportCache = {
  weekData: WeeklyDay[]
  selectedDay: string
}

const readHistoryReportCache = (): HistoryReportCache => {
  if (typeof window === "undefined") {
    return { weekData: [], selectedDay: "" }
  }

  try {
    const raw = window.sessionStorage.getItem(HISTORY_REPORT_CACHE_KEY)
    if (!raw) {
      return { weekData: [], selectedDay: "" }
    }

    const parsed = JSON.parse(raw) as Partial<HistoryReportCache>
    return {
      weekData: normalizeWeeklyData(parsed.weekData ?? []),
      selectedDay: parsed.selectedDay ?? "",
    }
  } catch (error) {
    console.error("failed to read history report cache", error)
    return { weekData: [], selectedDay: "" }
  }
}

const persistHistoryReportCache = (cache: HistoryReportCache) => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      HISTORY_REPORT_CACHE_KEY,
      JSON.stringify({
        weekData: cache.weekData,
        selectedDay: cache.selectedDay,
      }),
    )
  } catch (error) {
    console.error("failed to persist history report cache", error)
  }
}

export default function HistoryReport() {
  const cachedReport = useMemo(() => readHistoryReportCache(), [])
  const [weekData, setWeekData] = useState<WeeklyDay[]>(cachedReport.weekData)
  const [loadingWeek, setLoadingWeek] = useState(cachedReport.weekData.length === 0)
  const [weekError, setWeekError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState(cachedReport.selectedDay)
  const [selectedHourlyTag, setSelectedHourlyTag] = useState("pm139KWH")
  const [dailyCache, setDailyCache] = useState<Record<string, DailyResponse>>({})
  const [loadingDay, setLoadingDay] = useState(false)
  const [dayError, setDayError] = useState<string | null>(null)
  const dailyCacheRef = useRef(dailyCache)
  const { params: liveParams, status: liveStatus } = useLiveParams()

  const selectedMonth = useMemo(() => {
    if (!selectedDay) return ""
    return new Date(selectedDay).toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    })
  }, [selectedDay])

  const latestParams = useMemo(
    () =>
      liveParams
        .filter((param) => TRACKED_TAGS.includes(param.TagName))
        .map((param) => ({
          tag: param.TagName,
          value: Number.isFinite(param.Value) ? param.Value : null,
        })),
    [liveParams],
  )

  const loadingLive = liveStatus === "loading" && latestParams.length === 0
  const liveError = liveStatus === "error" ? "Gagal memuat data realtime" : null

  useEffect(() => {
    dailyCacheRef.current = dailyCache
  }, [dailyCache])

  useEffect(() => {
    persistHistoryReportCache({
      weekData,
      selectedDay,
    })
  }, [selectedDay, weekData])

  useEffect(() => {
    if (!TRACKED_TAGS.includes(selectedHourlyTag)) {
      setSelectedHourlyTag("pm139KWH")
    }
  }, [selectedHourlyTag])

  const fetchWeeklyData = useCallback(() => {
    setLoadingWeek((prev) => prev || weekData.length === 0)
    setWeekError(null)

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), WEEKLY_FETCH_TIMEOUT_MS)

    fetch(
      `${API_BASE}/api/logs/weekly`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("tidak bisa memuat data mingguan")
        }
        return (await res.json()) as WeeklyResponse
      })
      .then((data) => {
        const normalized = normalizeWeeklyData(data.week ?? [])
        setWeekData(normalized)
        setSelectedDay((prev) => {
          if (prev && normalized.some((day) => day.date === prev)) {
            return prev
          }
          return normalized.at(-1)?.date ?? ""
        })
      })
      .catch((err) => {
        console.error(err)
        setWeekError(
          err instanceof DOMException && err.name === "AbortError"
            ? "Memuat data mingguan terlalu lama"
            : "Gagal memuat data mingguan",
        )
      })
      .finally(() => {
        window.clearTimeout(timeout)
        setLoadingWeek(false)
      })
  }, [weekData.length])

  useEffect(() => {
    fetchWeeklyData()
    const timer = setInterval(fetchWeeklyData, WEEKLY_REFRESH_MS)
    return () => clearInterval(timer)
  }, [fetchWeeklyData])

  const weeklyTableRows = useMemo<WeeklyTableRow[]>(() => {
    return weekData.map((day) => {
      const tagDetails = TRACKED_TAGS.map((tag) => ({
        tag,
        value: day.stats[tag]?.last ?? null,
      }))
      const progress =
        typeof day.coverage?.progress === "number" ? day.coverage.progress : 0
      const progressText = day.coverage
        ? `${day.coverage.completeHours}/${day.coverage.expectedHours}`
        : `0/24`
      const lossLabel = day.coverage
        ? day.coverage.hasLoss
          ? `Loss ${day.coverage.missingHours} jam`
          : "Lengkap"
        : "Memeriksa data"
      return {
        day,
        tagDetails,
        costEstimateIdr: day.costEstimateIdr ?? null,
        progress,
        progressText,
        lossLabel,
      }
    })
  }, [weekData])

  const weeklyExportRows = useMemo(() => {
    return weeklyTableRows.map((row) => {
      const record: Record<string, string | number | null> = {
        Hari: row.day.label,
        Tanggal: row.day.displayDate ?? row.day.date,
        "Cost Harian (Rp)": formatCurrencyValue(row.costEstimateIdr),
        "Progress (%)": row.progress,
      }
      row.tagDetails.forEach((detail) => {
        const metric = DAY_DETAIL_CONFIG.find((item) => item.tag === detail.tag)
        const columnName = metric ? `${metric.label} (${metric.unit})` : detail.tag
        record[columnName] = detail.value ?? null
      })
      return record
    })
  }, [weeklyTableRows])

  const fetchDayDetail = useCallback((date: string, force = false) => {
    if (!force && dailyCacheRef.current[date]) {
      return
    }
    setLoadingDay(!dailyCacheRef.current[date])
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
  }, [])

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

  const dailyDetail = selectedDay ? dailyCache[selectedDay] : undefined
  const selectedWeekDay = useMemo(
    () => weekData.find((day) => day.date === selectedDay) ?? null,
    [selectedDay, weekData],
  )
  const currentDateKey = useMemo(
    () => getDateKeyInTimeZone(new Date(), REPORT_TIME_ZONE),
    [],
  )
  const isSelectedDayToday = selectedDay === currentDateKey

  const selectedHourlyMetric = useMemo(
    () => DAY_DETAIL_CONFIG.find((metric) => metric.tag === selectedHourlyTag) ?? DAY_DETAIL_CONFIG[0],
    [selectedHourlyTag],
  )

  const hourlySeries = useMemo(() => {
    const rawEntries = (dailyDetail?.tags[selectedHourlyMetric.tag] ?? []).filter((entry) =>
      Number.isFinite(entry.value),
    )
    return buildHourlySeries(rawEntries, selectedHourlyMetric.summaryMode)
  }, [dailyDetail, selectedHourlyMetric.tag, selectedHourlyMetric.summaryMode])

  const hourlyChartOption = useMemo(() => {
    const values = hourlySeries.map((point) => point.value)
    const numericValues = values.filter((value): value is number => value != null)
    const maxValue = numericValues.length ? Math.max(...numericValues) : 0
    const benchmark = selectedHourlyMetric.standard
    const seriesColor = selectedHourlyMetric.color

    return {
      backgroundColor: "transparent",
      animationDuration: 650,
      grid: {
        left: 16,
        right: 16,
        top: 32,
        bottom: 36,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15, 23, 42, 0.96)",
        borderColor: "rgba(96, 165, 250, 0.35)",
        textStyle: {
          color: "#f8fafc",
        },
        axisPointer: {
          type: "line",
          lineStyle: {
            color: "rgba(148, 163, 184, 0.6)",
          },
        },
      },
      xAxis: {
        type: "category",
        data: hourlySeries.map((point) => point.label),
        boundaryGap: false,
        axisLine: {
          lineStyle: {
            color: "rgba(148, 163, 184, 0.28)",
          },
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: "rgba(226, 232, 240, 0.72)",
          interval: 2,
        },
      },
      yAxis: {
        type: "value",
        scale: true,
        max: benchmark ? Math.max(maxValue, benchmark) * 1.15 : maxValue * 1.15 || undefined,
        splitNumber: 4,
        axisLabel: {
          color: "rgba(226, 232, 240, 0.72)",
        },
        splitLine: {
          lineStyle: {
            color: "rgba(148, 163, 184, 0.14)",
          },
        },
      },
      series: [
        {
          name: selectedHourlyMetric.label,
          type: "line",
          smooth: true,
          showSymbol: true,
          symbol: "circle",
          symbolSize: 8,
          data: values,
          connectNulls: false,
          lineStyle: {
            width: 3,
            color: seriesColor,
          },
          itemStyle: {
            color: seriesColor,
            borderColor: "rgba(255,255,255,0.9)",
            borderWidth: 2,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${seriesColor}CC` },
                { offset: 1, color: "rgba(15, 23, 42, 0.04)" },
              ],
            },
          },
          markLine: benchmark
            ? {
                symbol: "none",
                label: {
                  color: "rgba(226, 232, 240, 0.8)",
                },
                lineStyle: {
                  color: "rgba(251, 191, 36, 0.7)",
                  type: "dashed",
                },
                data: [{ yAxis: benchmark, name: "Patokan" }],
              }
            : undefined,
        },
      ],
      graphic:
        values.every((value) => value == null)
          ? [
              {
                type: "text",
                left: "center",
                top: "middle",
                style: {
                  text: "Tidak ada data jam untuk hari ini",
                  fill: "rgba(226, 232, 240, 0.7)",
                  fontSize: 14,
                  fontWeight: 500,
                },
              },
            ]
          : [],
    }
  }, [hourlySeries, selectedHourlyMetric.color, selectedHourlyMetric.label, selectedHourlyMetric.standard])

  const dailyBarMetrics = useMemo<DayDetailMetric[]>(() => {
    return DAY_DETAIL_CONFIG.map((config) => {
      const entries = (dailyDetail?.tags[config.tag] ?? [])
        .filter((entry) => Number.isFinite(entry.value))
        .slice()
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

      const values = entries.map((entry) => Number(entry.value))
      const fallbackStats = selectedWeekDay?.stats[config.tag]
      const average = values.length
        ? values.reduce((acc, value) => acc + value, 0) / values.length
        : fallbackStats?.avg ?? null
      const last = values.length ? values.at(-1) ?? null : fallbackStats?.last ?? null
      const min = values.length ? Math.min(...values) : fallbackStats?.min ?? null
      const max = values.length ? Math.max(...values) : fallbackStats?.max ?? null
      const value = config.summaryMode === "last" ? last : average
      const fillPercent =
        value != null && config.standard > 0
          ? Math.max(0, Math.min(100, (value / config.standard) * 100))
          : 0

      return {
        ...config,
        value,
        average,
        last,
        min,
        max,
        fillPercent,
      }
    })
  }, [dailyDetail, selectedWeekDay])

  const shouldShowTodayLoader = isSelectedDayToday && loadingDay

  const exportWeeklyXLS = useCallback(async () => {
    if (!weeklyExportRows.length || typeof document === "undefined") {
      return
    }
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(weeklyExportRows, {
      header: EXPORT_WEEKLY_HEADERS,
    })
    XLSX.utils.book_append_sheet(workbook, worksheet, "Rekap Mingguan")

    // Loop through each day in weekData to create a separate sheet for daily hourly data
    for (const day of weekData) {
      const dailyDetail =
        dailyCacheRef.current[day.date] ?? (await fetchDailyReport(day.date).catch(() => null))

      if (dailyDetail) {
        const hourlyRows = buildHourlyExportRows(day, dailyDetail)
        if (hourlyRows.length) {
          // Use day.label for the sheet name, e.g., "Senin"
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(hourlyRows, { header: EXPORT_HOURLY_HEADERS }), day.label);
        }
      }
    }

    const rawData = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
    const blob = new Blob([rawData], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `history-report-${new Date().toISOString().slice(0, 10)}.xlsx`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [weeklyExportRows, weekData])


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
                      : "â€”"}
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
          {weekData.length ? (
            <div className="history-week-table-wrapper">
              <div className="history-week-table">
                <div className="history-week-table-header">
                  <div>
                    <p className="history-week-table-meta">Summary mingguan</p>
                    <h2 className="history-week-table-title">Rekap seminggu</h2>
                    <p className="history-week-table-note">
                      Progress menunjukkan kelengkapan data per jam (00:00-24:00) untuk tiap hari.
                    </p>
                  </div>
                  <div className="history-week-table-actions">
                    <button
                      type="button"
                      className="history-week-btn history-week-btn--solid"
                      onClick={exportWeeklyXLS}
                      disabled={!weeklyTableRows.length || loadingWeek}
                    >
                      Ekspor XLS
                    </button>
                  </div>
                </div>
                <div className="history-week-table-body">
                  <table>
                    <thead>
                      <tr>
                        <th>Hari</th>
                        <th>Cost Harian</th>
                        <th>Progress</th>

                      </tr>
                    </thead>
                    <tbody>
                      {weeklyTableRows.map(({ day, costEstimateIdr, progress, progressText, lossLabel }) => {
                        const isToday = day.date === currentDateKey

                        return (
                        <tr
                          className={`history-week-table-row${
                            isToday ? " history-week-table-row--today" : ""
                          }`}
                          key={day.date}
                        >
                          <td>
                            <div className="history-week-cell history-week-day">
                              <strong>{day.label}</strong>
                              <span>{day.displayDate ?? day.date}</span>
                              {isToday && (
                                <small className="history-week-day-badge">Hari ini</small>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="history-week-cell history-week-average">
                              <strong>{formatCurrencyValue(costEstimateIdr)}</strong>
                              <small>estimasi biaya kWh</small>
                            </div>
                          </td>
                          <td>
                            <div
                              className={`history-week-cell history-week-progress${
                                isToday ? " history-week-progress--today" : ""
                              }`}
                            >
                              <div className="history-progress-bar">
                                <span
                                  className={`history-progress-fill${
                                    day.coverage?.hasLoss ? " history-progress-fill--loss" : ""
                                  }${isToday ? " history-progress-fill--today" : ""
                                  }`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <strong>{progressText}</strong>
                              <small>{progress}%</small>
                              {isToday && (
                                <div className="history-week-progress-status">
                                  <div className="loader" aria-hidden="true">
                                    <div className="inner one" />
                                    <div className="inner two" />
                                    <div className="inner three" />
                                  </div>
                                  <span>Berjalan</span>
                                </div>
                              )}
                              <small
                                className={`history-week-loss${
                                  day.coverage?.hasLoss ? " history-week-loss--bad" : ""
                                }`}
                              >
                                {`Per jam: ${lossLabel}`}
                              </small>
                            </div>
                          </td>

                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
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
                  <p>{day.displayDate ?? day.date}</p>
                </div>
                <button type="button" onClick={() => handleSelectDay(day.date)}>
                  {isActive ? "Detail aktif" : "Lihat detail"}
                </button>
              </header>
              <div className="history-day-metrics">
                {dayValues.map((metric) => (
                  <div key={metric.tag} className="history-day-metric">
                    <span className="history-day-metric-label">{metric.tag}</span>
                    <strong className="history-day-metric-value">
                      {metric.value != null
                        ? metric.value.toLocaleString("id-ID", { maximumFractionDigits: 4 })
                        : "â€”"}
                    </strong>
                  </div>
                ))}
              </div>
              {isActive && (
                <div className="history-day-detail">
                  {loadingDay && !dailyDetail && <p>Memuat data harian...</p>}
                  {dayError && <p className="history-day-error">{dayError}</p>}
                  <div className="history-day-detail-header">
                    <div>
                      <strong>Grafik jam harian</strong>
                      <p>
                        Data 24 jam ditampilkan per jam supaya pola dan loss lebih mudah dibaca.
                        {isSelectedDayToday ? " Hari ini masih berjalan, jadi data bisa terus bertambah." : ""}
                      </p>
                    </div>
                  </div>
                  <div className="history-hourly-panel">
                    <div className="history-hourly-toolbar">
                      <div className="history-hourly-tabs" role="tablist" aria-label="Parameter per jam">
                        {DAY_DETAIL_CONFIG.map((metric) => (
                          <button
                            key={metric.tag}
                            type="button"
                            className={`history-hourly-tab${
                              selectedHourlyTag === metric.tag ? " history-hourly-tab--active" : ""
                            }`}
                            onClick={() => setSelectedHourlyTag(metric.tag)}
                          >
                            {metric.label}
                          </button>
                        ))}
                      </div>
                      <div className="history-hourly-meta">
                        <span>{selectedHourlyMetric.standardLabel}</span>
                        <strong>{selectedHourlyMetric.tag}</strong>
                      </div>
                    </div>
                    <div className="history-hourly-chart-row">
                      <div className="history-hourly-chart">
                        <ReactECharts
                          option={hourlyChartOption}
                          style={{ height: 360, width: "100%" }}
                          notMerge
                          lazyUpdate
                        />
                      </div>
                      {shouldShowTodayLoader && (
                        <aside className="history-hourly-loading" aria-live="polite">
                          <div className="loader" aria-hidden="true">
                            <div className="inner one" />
                            <div className="inner two" />
                            <div className="inner three" />
                          </div>
                          <strong>
                            {dailyDetail ? "Memperbarui data hari ini" : "Hari ini sedang mengambil data"}
                          </strong>
                          <span>
                            {dailyDetail
                              ? "Data lama masih tampil sambil menunggu sinkron terbaru."
                              : "Menunggu slot pertama masuk ke chart."}
                          </span>
                        </aside>
                      )}
                    </div>
                    <div className="history-hourly-summary">
                      <div className="history-hourly-summary-item">
                        <span>Tag aktif</span>
                        <strong>{selectedHourlyMetric.label}</strong>
                      </div>
                      <div className="history-hourly-summary-item">
                        <span>Patokan</span>
                        <strong>{selectedHourlyMetric.standardLabel}</strong>
                      </div>
                      <div className="history-hourly-summary-item">
                        <span>Jam tampil</span>
                        <strong>00:00 - 23:00</strong>
                      </div>
                    </div>
                  </div>
                  <div className="history-day-bars">
                    {dailyBarMetrics.map((metric) => (
                      <article key={metric.tag} className="history-day-bar-card">
                        <div className="history-day-bar-top">
                          <div>
                            <p className="history-day-bar-label">{metric.label}</p>
                            <span className="history-day-bar-standard">
                              {metric.standardLabel}
                            </span>
                          </div>
                          <strong className="history-day-bar-value">
                            {formatMetricValue(metric.value, metric.unit, metric.decimals ?? 3)}
                          </strong>
                        </div>
                        <div className="history-day-bar-track">
                          <span
                            className="history-day-bar-fill"
                            style={{
                              width: `${metric.fillPercent}%`,
                              background: `linear-gradient(90deg, ${metric.color}, rgba(255,255,255,0.92))`,
                            }}
                          />
                        </div>
                        <div className="history-day-bar-meta">
                          <span>
                            Avg {formatMetricValue(metric.average, metric.unit, metric.decimals ?? 3)}
                          </span>
                          <span>
                            Last {formatMetricValue(metric.last, metric.unit, metric.decimals ?? 3)}
                          </span>
                          <span>
                            Min {formatMetricValue(metric.min, metric.unit, metric.decimals ?? 3)}
                          </span>
                          <span>
                            Max {formatMetricValue(metric.max, metric.unit, metric.decimals ?? 3)}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </section>
    </main>
  )
}
