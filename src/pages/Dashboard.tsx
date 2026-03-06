import DashboardChart from "../components/DashboardChart";

export default function Dashboard() {
  return (
    <div style={{ padding: "20px" }}>
      <h1 style={{ marginBottom: "20px" }}>Analytics Dashboard</h1>

      {/* Stat Cards */}
      <div className="stats-grid">
        <div className="card">
          <h3>Total Sales</h3>
          <p className="stat">$12,430</p>
        </div>

        <div className="card">
          <h3>Total Orders</h3>
          <p className="stat">1,230</p>
        </div>

        <div className="card">
          <h3>Customers</h3>
          <p className="stat">842</p>
        </div>

        <div className="card">
          <h3>Revenue</h3>
          <p className="stat">$8,420</p>
        </div>
      </div>

      {/* Chart */}
      <div className="card chart-card">
        <DashboardChart />
      </div>
    </div>
  );
}