import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import QualityRagCard from "./QualityRagCard";
import CampaignMixCard, { campaignRows } from "./CampaignMixCard";

const BANDS = [
  { key: "red", name: "Red (<80%)", count: 94, drilldownToken: "tok-red" },
  { key: "amber", name: "Amber (80–84.99%)", count: 3, drilldownToken: "tok-amber" },
  { key: "green", name: "Green (≥85%)", count: 20, drilldownToken: "tok-green" },
];

describe("QualityRagCard", () => {
  it("shows the total and each band count and share", () => {
    render(<QualityRagCard bands={BANDS} />);
    expect(screen.getByText("Quality grade (RAG)")).toBeInTheDocument();
    expect(screen.getByText("Share of audited calls by score band")).toBeInTheDocument();
    expect(screen.getByText("117")).toBeInTheDocument();
    expect(screen.getByText("TOTAL")).toBeInTheDocument();
    expect(screen.getByText("94")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("17%")).toBeInTheDocument();
  });

  it("drills into a band from the legend", async () => {
    const onDrilldown = jest.fn();
    render(<QualityRagCard bands={BANDS} onDrilldown={onDrilldown} />);
    const buttons = screen.getAllByRole("button", { name: /View 20 calls for Green/ });
    await userEvent.click(buttons[buttons.length - 1]);
    expect(onDrilldown).toHaveBeenCalledWith(expect.objectContaining({ key: "green", drilldownToken: "tok-green" }));
  });

  it("shows an empty message when nothing is graded", () => {
    render(<QualityRagCard bands={[]} />);
    expect(screen.getByText("No graded calls yet.")).toBeInTheDocument();
  });
});

describe("CampaignMixCard", () => {
  it("sorts campaigns, keeps Other last and computes shares", () => {
    const { rows, total } = campaignRows([
      { name: "Other", count: 14 },
      { name: "PDM", count: 32 },
      { name: "COLL", count: 71 },
    ]);
    expect(total).toBe(117);
    expect(rows.map((r) => [r.name, r.percent])).toEqual([["COLL", 61], ["PDM", 27], ["Other", 12]]);
  });

  it("renders each bar with its count and drills in on click", async () => {
    const onDrilldown = jest.fn();
    render(
      <CampaignMixCard
        items={[{ name: "COLL", count: 71, drilldownToken: "tok-coll" }, { name: "PDM", count: 32 }]}
        onDrilldown={onDrilldown}
      />,
    );
    expect(screen.getByText("Campaign mix")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View 32 calls for PDM/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /View 71 calls for COLL/ }));
    expect(onDrilldown).toHaveBeenCalledWith(expect.objectContaining({ name: "COLL", drilldownToken: "tok-coll" }));
  });
});
