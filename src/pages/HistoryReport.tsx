import { useEffect, useMemo, useState } from "react"
import { getHistory, getPanels } from "../api/api"
import type { Panel } from "../types/tag"
import "./style-HistoryReport.css"

type HistoryRow = {
  created: string
  tagvalue: number
}

export default function HistoryReport() {
  const [panels, setPanels] = useState<Panel[]>([])
  const [selectedTag, setSelectedTag] = useState<string>("")
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    getPanels()
      .then((result) => {
        if (!mounted) return
        setPanels(result)
        if (result.length > 0) {
          setSelectedTag((prev) => prev || result[0].tagname)
        }
      })
      .catch((err) => {
        if (!mounted) return
        console.error("failed to load panels", err)
        setError("Gagal memuat daftar panel")
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!selectedTag) {
      setHistory([])
      return
    }

    let mounted = true
    setLoading(true)
    setError(null)

    getHistory(selectedTag)
      .then((result) => {
        if (!mounted) return
        setHistory(Array.isArray(result) ? result : [])
      })
      .catch((err) => {
        if (!mounted) return
        console.error("failed to load history", err)
        setError("Gagal mengambil riwayat")
        setHistory([])
      })
      .finally(() => {
        if (!mounted) return
        setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [selectedTag])

  const selectedPanel = useMemo(
    () => panels.find((panel) => panel.tagname === selectedTag),
    [panels, selectedTag],
  )

  const formattedHistory = useMemo(
    () =>
      history
        .slice()
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
        .map((row, index) => ({
          ...row,
          key: `${row.created}-${index}`,
          time: new Date(row.created).toLocaleString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        })),
    [history],
  )

  return (
    <main className="history-page">
      <section className="history-hero">
        <div>
          <p className="history-hero-meta">Monitoring</p>
          <h1 className="history-hero-title">History Report</h1>
          <p className="history-hero-subtitle">
            Laporan penggunaan daya per panel berdasarkan data `datamin`. Pilih panel untuk melihat nilai
            terakhir dan tren waktu nyata.
          </p>
        </div>
        <div className="history-control">
          <label htmlFor="panel-select">Pilih panel</label>
          <select
            id="panel-select"
            value={selectedTag}
            onChange={(event) => setSelectedTag(event.target.value)}
            className="history-select"
          >
            {panels.map((panel) => (
              <option key={panel.id} value={panel.tagname}>
                {panel.tagdesc}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="history-card">
        <header className="history-card-header">
          <div>
            <p className="history-card-label">Tag terpilih</p>
            <h2 className="history-card-title">
              {selectedPanel?.tagname ?? "Belum ada panel terdaftar"}
            </h2>
            <p className="history-card-subtitle">{selectedPanel?.tagdesc ?? "—"}</p>
          </div>
          <span className="history-card-status">
            {loading
              ? "Memuat..."
              : error
              ? "Error"
              : `${formattedHistory.length} baris riwayat`}
          </span>
        </header>

        {error && <p className="history-card-error">{error}</p>}

        <div className="history-table-wrapper">
          {!formattedHistory.length && !loading ? (
            <p className="history-empty">Tidak ada data riwayat.</p>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Nilai</th>
                </tr>
              </thead>
              <tbody>
                {formattedHistory.map((row) => (
                  <tr key={row.key}>
                    <td>{row.time}</td>
                    <td>{row.tagvalue.toLocaleString("id-ID", { maximumFractionDigits: 4 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  )
}
