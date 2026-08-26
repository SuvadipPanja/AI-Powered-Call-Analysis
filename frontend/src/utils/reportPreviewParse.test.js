import { parseCsvText, recordsFromObjects, exportFilename } from "./reportPreviewParse";

describe("reportPreviewParse", () => {
  it("parses quoted CSV cells", () => {
    const parsed = parseCsvText('Name,Score\n"Sharma, Priya",88\n');
    expect(parsed.columns).toEqual(["Name", "Score"]);
    expect(parsed.rows[0].Name).toBe("Sharma, Priya");
    expect(parsed.rows[0].Score).toBe("88");
  });

  it("treats empty or no-data CSV as empty", () => {
    expect(parseCsvText("No audit data found.").rows).toEqual([]);
    expect(parseCsvText("").columns).toEqual([]);
  });

  it("builds columns from object rows", () => {
    const parsed = recordsFromObjects([{ Agent: "A", Score: 9 }, { Agent: "B" }]);
    expect(parsed.columns).toEqual(["Agent", "Score"]);
    expect(parsed.rows[1].Score).toBe("");
  });

  it("includes the selected date range in the filename", () => {
    expect(exportFilename("audit", "2026-07-01", "2026-07-31")).toMatch(/^audit_2026-07-01_to_2026-07-31_/);
  });
});
