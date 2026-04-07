import { useEffect, useMemo, useState } from "react"
import { getPanels } from "../api/api"
import ComparisonKwhChart from "../components/ComparisonKwhChart"
import DashboardChart from "../components/DashboardChart"
import ParamChart from "../components/ParamChart"
import { useLiveParams } from "../hooks/useLiveParams"
import type { Panel } from "../types/tag"
import "./style-Dashboard.css"

const trafficMetrics = [
  { label: "Voltase", tag: "pm139VAN", unit: "V", accent: "emerald" },
  { label: "Ampere", tag: "pm139AR", unit: "A", accent: "cyan" },
  { label: "Daya", tag: "pm139P", unit: "kW", accent: "indigo" },
  { label: "Frekuensi", tag: "pm139F", unit: "Hz", accent: "amber" },
]
const KWH_TARIFF = 1444.7

const formatClock = (value: number | null) =>
  value == null
    ? "—"
    : new Date(value).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })

const formatCurrency = (value: number) =>
  value.toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  })

export default function Dashboard() {
  const [panels, setPanels] = useState<Panel[]>([])
  const { params, status, lastSync, history } = useLiveParams()

  useEffect(() => {
    let mounted = true

    const loadPanels = async () => {
      try {
        const data = await getPanels()
        if (!mounted) return
        setPanels(data)
      } catch (error) {
        console.error("failed to load panels", error)
      }
    }

    loadPanels()
    const timer = setInterval(loadPanels, 60 * 1000)

    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  const activeMetrics = useMemo(
    () =>
      trafficMetrics.map((metric) => {
        const match = params.find((param) => param.TagName.toLowerCase() === metric.tag.toLowerCase())
        return {
          ...metric,
          value: match?.Value ?? null,
        }
      }),
    [params],
  )

  const kwhHistory = history.pm139KWH ?? []
  const latestKwh = kwhHistory.at(-1)?.value ?? null
  const usageDelta = useMemo(() => {
    if (kwhHistory.length < 2) return 0
    return kwhHistory[kwhHistory.length - 1].value - kwhHistory[0].value
  }, [kwhHistory])

  const kwhChangePercent = useMemo(() => {
    if (kwhHistory.length < 2) return 0
    const latest = kwhHistory[kwhHistory.length - 1].value
    const previous = kwhHistory[kwhHistory.length - 2].value
    if (!previous) return 0
    return ((latest - previous) / previous) * 100
  }, [kwhHistory])

  const dailyKwhEstimate = useMemo(() => usageDelta * 24, [usageDelta])
  const dailyCostEstimate = useMemo(() => dailyKwhEstimate * KWH_TARIFF, [dailyKwhEstimate])

  const dashboardStatus =
    status === "error"
      ? "Koneksi live terganggu"
      : status === "loading"
      ? "Memuat telemetri"
      : "Live 1 jam tersimpan"

  const summaryStats = [
    { label: "Panel aktif", value: panels.length.toString() },
    { label: "Tag live", value: params.length.toString() },
    { label: "Sinkron terakhir", value: formatClock(lastSync) },
  ]

  return (
    <main className="dashboard-page">
      <section className="dashboard-body">
        <header className="dashboard-hero">
          <div className="dashboard-intro">
            <p className="dashboard-intro-meta">Operasi Energi</p>
            <h1 className="dashboard-intro-title">Energy Dashboard</h1>
            <p className="dashboard-intro-subtitle">
              Dashboard live untuk memantau telemetri PM139, tren energi per jam, dan kesehatan
              panel dengan pengalaman yang lebih cepat dan stabil saat reload maupun pindah halaman.
            </p>
          </div>
          <div className="dashboard-hero-side">
            <span className="dashboard-year-pill">{new Date().getFullYear()}</span>
            <span className={`dashboard-status-pill dashboard-status-pill--${status}`}>
              {dashboardStatus}
            </span>
          </div>
        </header>

        <section className="dashboard-overview-grid">
          <article className="dashboard-card dashboard-summary-card">
            <p className="dashboard-summary-label">Energy Dashboard</p>
            <h3 className="dashboard-summary-title">Ringkasan operasional</h3>
            <div className="dashboard-summary-grid">
              {summaryStats.map((stat) => (
                <div key={stat.label} className="dashboard-summary-item">
                  <div className="dashboard-summary-item-label">{stat.label}</div>
                  <div className="dashboard-summary-item-value">{stat.value}</div>
                </div>
              ))}
            </div>
          </article>

          <article className="dashboard-card dashboard-kwh-card">
            <p className="dashboard-section-label">Cost Predicted</p>
            <div className="dashboard-kwh-main">
              <div>
                <h3 className="dashboard-kwh-title">Total energi live</h3>
                <p className="dashboard-kwh-caption">Bacaan KWh terbaru dari PM139</p>
              </div>
              <div className="dashboard-kwh-value">
                {latestKwh != null
                  ? latestKwh.toLocaleString("id-ID", { maximumFractionDigits: 3 })
                  : "—"}
                <span>kWh</span>
              </div>
            </div>
            <div className="dashboard-kwh-foot">
              <span>Akumulasi 1 jam</span>
              <strong>{usageDelta.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kWh</strong>
            </div>
          </article>

          <article className="dashboard-card dashboard-change-card">
            <p className="dashboard-section-label">Change in Cost</p>
            <div className="dashboard-change-figure">
              <strong>{formatCurrency(dailyCostEstimate)}</strong>
              <span>
                estimasi biaya per hari pada tarif Rp1.444,70/kWh
              </span>
              <span>
                perubahan live{" "}
                {kwhChangePercent.toLocaleString("id-ID", {
                  maximumFractionDigits: 2,
                  signDisplay: "always",
                })}
                %
              </span>
            </div>
            <ComparisonKwhChart />
          </article>
        </section>

        <section className="dashboard-grid">
          <article className="dashboard-card dashboard-main-card">
            <div className="dashboard-main-header">
              <div>
                <p className="dashboard-main-label">Usage Estimate</p>
                <h2 className="dashboard-main-title">Aliran daya 1 jam terakhir</h2>
              </div>
              <span className="dashboard-main-status">{formatClock(lastSync)}</span>
            </div>
            <div className="dashboard-chart-wrapper">
              <DashboardChart />
            </div>
          </article>

          <div className="dashboard-side-column">
            <article className="dashboard-card dashboard-traffic-card">
              <p className="dashboard-traffic-label">Energy Intensity</p>
              <div className="dashboard-traffic-grid">
                {activeMetrics.map((metric) => (
                  <div key={metric.tag} className="traffic-metric-card">
                    <span className={`traffic-metric-label traffic-color-${metric.accent}`}>
                      {metric.label}
                    </span>
                    <span className="traffic-metric-value">
                      {metric.value != null
                        ? metric.value.toLocaleString("id-ID", { maximumFractionDigits: 3 })
                        : "—"}{" "}
                      <span className="traffic-metric-unit">{metric.unit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="dashboard-card dashboard-flow-card">
              <p className="dashboard-flow-label">Live Engine</p>
              <p className="dashboard-flow-text">
                Data live sekarang memakai cache frontend bersama, jadi polling tidak bertumpuk
                antar halaman. Saat reload, dashboard membaca cache lebih dulu lalu melanjutkan
                update, sehingga grafik tidak kembali dari nol secara acak.
              </p>
            </article>
          </div>
        </section>

        <div className="dashboard-card dashboard-param-panel">
          <ParamChart />
        </div>
      </section>
    </main>
  )
}
