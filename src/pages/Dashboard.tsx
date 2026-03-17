import { useEffect, useState } from "react"
import { getRealtime, getPanels } from "../api/api"
import ComparisonKwhChart from "../components/ComparisonKwhChart"
import DashboardChart from "../components/DashboardChart"
import ParamChart from "../components/ParamChart"
import type { Panel, Tag } from "../types/tag"
import "./style-Dashboard.css"

const trafficMetrics = [
  { label: "Voltase", code: "VAB", unit: "V", accent: "emerald" },
  { label: "Ampere", code: "AR", unit: "A", accent: "cyan" },
  { label: "Daya", code: "P", unit: "kW", accent: "indigo" },
  { label: "Frekuensi", code: "F", unit: "Hz", accent: "amber" },
]

export default function Dashboard() {
  const [tags, setTags] = useState<Tag[]>([])
  const [panels, setPanels] = useState<Panel[]>([])

  useEffect(() => {
    const load = () => {
      getRealtime().then(setTags)
      getPanels().then(setPanels)
    }

    load()
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [])

  const lastSync = new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

  const summaryStats = [
    { label: "Panel aktif", value: panels.length.toString() },
    { label: "Titik telemetri", value: tags.length.toString() },
    { label: "Pembaruan terakhir", value: lastSync },
  ]

  const trafficData = trafficMetrics.map((metric) => {
    const match = tags.filter((t) => t.tagname.includes(metric.code)).pop()
    return {
      ...metric,
      value:
        match?.tagvalue != null
          ? match.tagvalue.toFixed?.(2) ?? String(match.tagvalue)
          : "—",
    }
  })

  return (
    <main className="dashboard-page">
      <section className="dashboard-body">
        <div className="dashboard-intro">
          <p className="dashboard-intro-meta">Operasi Energi</p>
          <h1 className="dashboard-intro-title">Dasbor EMS EWON</h1>
          <p className="dashboard-intro-subtitle">
            Tampilkan data terbaru dari setiap panel yang dimonitor dengan umpan balik langsung
            mengenai tegangan, arus, daya, dan frekuensi di lantai pabrik.
          </p>
        </div>

        <section className="dashboard-grid">
          <div className="dashboard-main-card">
            <div className="dashboard-main-header">
              <div>
                <p className="dashboard-main-label">Tren</p>
                <h2 className="dashboard-main-title">Aliran daya</h2>
              </div>
              <span className="dashboard-main-status">Langsung</span>
            </div>
            <div className="dashboard-chart-wrapper">
              <DashboardChart />
            </div>
            <ComparisonKwhChart />
          </div>

          <div className="dashboard-side-column">
            <div className="dashboard-summary-card">
              <p className="dashboard-summary-label">Ringkasan</p>
              <h3 className="dashboard-summary-title">Kesehatan situs</h3>
              <div className="dashboard-summary-grid">
                {summaryStats.map((stat) => (
                  <div key={stat.label} className="dashboard-summary-item">
                    <div className="dashboard-summary-item-label">{stat.label}</div>
                    <div className="dashboard-summary-item-value">{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="dashboard-flow-card">
              <p className="dashboard-flow-label">Alur</p>
              <p className="dashboard-flow-text">
                Sinkronisasi data berjalan setiap dua detik untuk menjaga telemetri tetap selaras
                dengan output terkini. Panel tidak aktif diberi bayangan untuk menghemat bandwidth.
              </p>
            </div>

            <div className="dashboard-traffic-card">
              <p className="dashboard-traffic-label">Trafik energi</p>
              <div className="dashboard-traffic-grid">
                {trafficData.map((metric) => (
                  <div key={metric.code} className="traffic-metric-card">
                    <span className={`traffic-metric-label traffic-color-${metric.accent}`}>
                      {metric.label}
                    </span>
                    <span className="traffic-metric-value">
                      {metric.value} <span className="traffic-metric-unit">{metric.unit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="dashboard-param-panel">
          <ParamChart />
        </div>
      </section>
    </main>
  )
}
