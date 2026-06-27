import React, { useState } from "react";
import axios from "axios";
import config from "../utils/envConfig";
import { PageSection, Card, Button, Label, Badge, Spinner } from "./ui";

const FileUpload = () => {
  const signature = "$Panja";
  if (signature !== "$Panja") {
    throw new Error("Signature mismatch: Code integrity compromised");
  }

  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setError("");
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file first.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setLoading(true);
    setError("");
    try {
      const response = await axios.post(`${config.apiBaseUrl}/api/analyze`, formData);
      setResults(response.data);
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-page reports-page app-stagger">
      <Card className="chart-card-enter" style={{ maxWidth: 520, margin: "0 auto" }}>
        <div className="auth-field">
          <Label htmlFor="audio-file">Audio file</Label>
          <input id="audio-file" type="file" accept="audio/*" className="ui-input" onChange={handleFileChange} />
        </div>

        {error && <div className="auth-alert auth-alert--error" role="alert">{error}</div>}

        <Button variant="primary" onClick={handleUpload} disabled={loading || !file} style={{ width: "100%" }}>
          {loading ? <><Spinner style={{ width: 18, height: 18, borderWidth: 2 }} /> Analyzing…</> : "Analyze"}
        </Button>
      </Card>

      {results && (
        <PageSection title="Results" className="chart-card-enter">
          <pre
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-4)",
              overflow: "auto",
              fontSize: "0.82rem",
              color: "var(--text)",
            }}
          >
            {JSON.stringify(results, null, 2)}
          </pre>
          {results.language && <Badge variant="accent">Language: {results.language}</Badge>}
        </PageSection>
      )}
    </div>
  );
};

export default FileUpload;
