import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuditSection from "./AuditSection";
import { getAuditQueue } from "../services/auditService";

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}));
jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({ username: "Auditor1" }),
}));
jest.mock("../hooks/useAccessGate", () => () => ({ hasPage: () => true, ready: true }));
jest.mock("../hooks/useTenantMode", () => () => ({ isCollections: true }));
jest.mock("../services/dropdownsService", () => ({
  listLocationsDropdown: jest.fn().mockResolvedValue([{ LocationName: "Kolkata" }]),
}));
jest.mock("../services/auditService", () => ({
  getAuditQueue: jest.fn(),
}));

describe("AuditSection collections bifurcations", () => {
  beforeEach(() => {
    getAuditQueue.mockResolvedValue({
      success: true,
      auditQueue: [
        {
          fileName: "a.wav",
          agentName: "Priya",
          location: "Kolkata",
          callDate: "2026-08-01",
          disposition: "Promise to pay",
          language: "Hindi",
          supervisor: "Anita",
          agentCreationDate: "2026-06-01",
        },
        {
          fileName: "b.wav",
          agentName: "Amit",
          location: "Kolkata",
          callDate: "2026-08-01",
          disposition: "Call back",
          language: "English",
          supervisor: "Rahul",
          agentCreationDate: "2022-08-01",
        },
      ],
    });
  });

  it("shows language, TL, and tenure breakdowns and filters the queue", async () => {
    render(<AuditSection />);
    expect(await screen.findByRole("table", { name: /language-wise/i })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /tl-wise/i })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /tenure-wise/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/language/i, { selector: "select" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^tl$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tenure/i, { selector: "select" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /view hindi calls/i }));
    expect(screen.getByText("a.wav")).toBeInTheDocument();
    expect(screen.queryByText("b.wav")).not.toBeInTheDocument();
  });
});
