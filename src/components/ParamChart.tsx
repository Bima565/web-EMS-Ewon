import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import * as echarts from "echarts"
import { getParamValues, type ParamValue } from "../api/api"

type ParamPoint = {
  label: string
  value: number
}

const DEFAULT_POINTS: ParamPoint[] = []
const FETCH_INTERVAL_MS = 2000

export default function ParamChart() {
  const [points, setPoints] = useState<ParamPoint[]>(DEFAULT_POINTS)
  const [status, setStatus] = useState<"loading" | "error" | "idle">("loading")

  useEffect(() => {
    let mounted = true

    const normalize = (data: ParamValue[]): ParamPoint[] =>
      data.map((item) => ({ label: item.TagName, value: Number(item.Value) }))

    const load = async (showLoading = false) => {
      if (!mounted) return
      if (showLoading) setStatus("loading")

      try {
        const data = await getParamValues()
        if (!mounted) return
        setPoints(normalize(data))
        setStatus("idle")
      } catch (error) {
        if (!mounted) return
        console.error("param fetch", error)
        setStatus("error")
      }
    }

    load(true)
    const timer = setInterval(() => load(), FETCH_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  const option = useMemo(() => {
    const labels = points.map((point) => point.label)
    const values = points.map((point) => point.value)

    return {
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(2,6,23,0.95)",
        textStyle: { color: "#f8fafc" },
      },
      grid: { left: 16, right: 18, top: 24, bottom: 18, containLabel: true },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: "rgba(148,163,184,0.4)" } },
        axisLabel: { color: "rgba(148,163,184,0.7)", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.2)" } },
        axisLabel: { color: "rgba(148,163,184,0.7)", fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          barWidth: 16,
          data: values,
          itemStyle: {
            borderRadius: 6,
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(14,165,233,0.9)" },
              { offset: 1, color: "rgba(14,165,233,0.3)" },
            ]),
          },
        },
      ],
    }
  }, [points])

  return (
    <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-900/70 to-slate-900/40 p-6 shadow-[0_30px_60px_rgba(9,18,40,0.7)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">API live</p>
          <h2 className="text-xl font-semibold text-white">Param monitoring</h2>
        </div>
        <span className="text-xs uppercase tracking-[0.4em] text-slate-400">
          {status === "loading" && "memuat"}
          {status === "error" && "error"}
          {status === "idle" && "online"}
        </span>
      </div>
      <div className="mt-6">
        {points.length ? (
          <ReactECharts option={option} style={{ height: 220 }} />
        ) : (
          <div className="flex h-48 items-center justify-center text-sm text-slate-400">
            {status === "error" ? "Tidak dapat mengakses API" : "Menunggu data Param..."}
          </div>
        )}
      </div>
    </div>
  )
}
