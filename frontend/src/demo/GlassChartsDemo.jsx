import QualityRagCard from "../components/dashboard/GlassCharts/QualityRagCard";
import CampaignMixCard from "../components/dashboard/GlassCharts/CampaignMixCard";

const BANDS = [
  { key: "red", name: "Red (<80%)", count: 70 },
  { key: "amber", name: "Amber (80–84.99%)", count: 11 },
  { key: "green", name: "Green (≥85%)", count: 32 },
];

const CAMPAIGNS = [
  { name: "COLL", count: 71 },
  { name: "PDM", count: 32 },
  { name: "Other", count: 14 },
];

function Pair({ scheme }) {
  const dark = scheme === "dark";
  return (
    <section data-scheme={scheme} style={{ padding: 20, borderRadius: 20, background: dark ? "#07111d" : "#f4f7fb" }}>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: dark ? "#9baabd" : "#68778a" }}>{dark ? "Dark mode" : "Light mode"}</p>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 7fr) minmax(0, 5fr)", gap: 16, alignItems: "stretch" }}>
        <QualityRagCard bands={BANDS} />
        <CampaignMixCard items={CAMPAIGNS} />
      </div>
    </section>
  );
}

/** Local review only. Sample numbers from the reference image. */
export default function GlassChartsDemo() {
  return (
    <main style={{ minHeight: "100vh", width: 1180, padding: 24, display: "grid", gap: 20, background: "#e7eef5" }}>
      <Pair scheme="light" />
      <Pair scheme="dark" />
    </main>
  );
}
