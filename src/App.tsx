import { useEffect } from "react"
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom"
import Dashboard from "./pages/Dashboard.tsx"
import Panels from "./pages/Panels.tsx"
import "./App.css"

const navItems = [
  { to: "/dashboard", label: "Dasbor", description: "Ringkasan real-time" },
  { to: "/tagdesc", label: "Tagdesc", description: "Detil panel" },
]

function AppLayout() {
  const location = useLocation()
  const routePath = location.hash.replace("#", "") || "/dashboard"
  const showHeader = routePath === "/dashboard"

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div>
          <p className="app-sidebar-meta">Menu</p>
          <h1 className="app-sidebar-title">EWON EMS</h1>
          <p className="app-sidebar-subtitle">Monitoring</p>
        </div>
        <nav className="app-sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `app-navigation-link ${isActive ? "app-navigation-link--active" : ""}`
              }
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="app-main-area">
        {showHeader && (
          <header className="app-header">
            <p className="app-header-breadcrumb">Dashboard</p>
            <p className="app-header-meta">Real-time insights</p>
          </header>
        )}
        <main className="app-main-content">
          <Routes>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tagdesc" element={<Panels />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function App() {
  useEffect(() => {
    if (typeof window === "undefined") return

    const { pathname, hash } = window.location
    if (hash) return
    if (pathname === "/" || pathname === "" || pathname === "/index.html") return

    window.location.replace(`/#${pathname}`)
  }, [])

  return (
    <HashRouter>
      <AppLayout />
    </HashRouter>
  )
}

export default App
