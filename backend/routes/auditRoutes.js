/**
 * File: auditRoutes.js
 * Purpose: Manual Audit System API routes
 * Author: $Panja
 * Date: 2025-06-18
 *
 * IMPORTANT: Static routes (team/list, team/summary, team/export) are registered
 * before the /:filename param route to prevent Express from treating "team" as a filename.
 */

const express = require("express");
const router = express.Router();

const AUDIT_ROLES = ["Super Admin", "Admin", "Manager", "Team Leader"];

function createAuditRouter({ sql, connectToDatabase, writeLog, getISTTimeString }) {

  let auditSchemaEnsured = false;
  async function ensureAuditSchema() {
    if (auditSchemaEnsured) return;
    const pool = await connectToDatabase();
    await pool.request().query(`
      IF OBJECT_ID('dbo.CallAudits', 'U') IS NULL
      CREATE TABLE dbo.CallAudits (
        AuditID              INT IDENTITY(1,1) PRIMARY KEY,
        AudioFileName        NVARCHAR(500) NOT NULL UNIQUE,
        AuditorUsername      NVARCHAR(100) NOT NULL,
        AuditorRole          NVARCHAR(50)  NOT NULL,
        AgentName            NVARCHAR(200) NULL,
        AgentID              NVARCHAR(100) NULL,
        AgentLocation        NVARCHAR(200) NULL,
        AgentSupervisor      NVARCHAR(200) NULL,
        OverallManualScore   FLOAT         NULL,
        OverallAIScore       FLOAT         NULL,
        OverallComments      NVARCHAR(MAX) NULL,
        ToneNotes            NVARCHAR(MAX) NULL,
        AIScoresSnapshot     NVARCHAR(MAX) NULL,
        CreatedAt            DATETIME      NOT NULL DEFAULT GETDATE(),
        UpdatedAt            DATETIME      NULL
      );
    `);
    await pool.request().query(`
      IF OBJECT_ID('dbo.CallAuditScores', 'U') IS NULL
      CREATE TABLE dbo.CallAuditScores (
        ScoreID          INT IDENTITY(1,1) PRIMARY KEY,
        AuditID          INT            NOT NULL,
        ParameterName    NVARCHAR(100)  NOT NULL,
        ManualScore      FLOAT          NULL,
        AIScore          FLOAT          NULL,
        Rationale        NVARCHAR(MAX)  NULL,
        CONSTRAINT FK_AuditScores_Audit FOREIGN KEY (AuditID) REFERENCES dbo.CallAudits(AuditID) ON DELETE CASCADE,
        CONSTRAINT UQ_AuditScores_Param UNIQUE (AuditID, ParameterName)
      );
    `);
    auditSchemaEnsured = true;
  }

  function canAudit(accountType) {
    return AUDIT_ROLES.includes(accountType);
  }

  /* ─────────────────────────────────────────────────────────────────
   * STATIC ROUTES — must be registered BEFORE /:filename
   * ───────────────────────────────────────────────────────────────── */

  /**
   * GET /api/audits/team/list
   */
  router.get("/team/list", async (req, res) => {
    try {
      await ensureAuditSchema();
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

      const pool = await connectToDatabase();
      const { agent, from, to, location, supervisor } = req.query;

      let query = `
        SELECT a.AuditID, a.AudioFileName, a.AuditorUsername, a.AuditorRole,
               a.AgentName, a.AgentLocation, a.AgentSupervisor,
               a.OverallManualScore, a.OverallAIScore,
               a.OverallComments, a.ToneNotes, a.CreatedAt, a.UpdatedAt
        FROM dbo.CallAudits a
        WHERE 1=1
      `;
      const request = pool.request();

      if (user.accountType === "Team Leader") {
        query += " AND a.AgentSupervisor = @supervisor";
        request.input("supervisor", sql.NVarChar, user.username);
      } else if (user.accountType === "Manager") {
        query += " AND (a.AgentSupervisor = @supervisor OR a.AuditorUsername = @auditor)";
        request.input("supervisor", sql.NVarChar, user.username);
        request.input("auditor", sql.NVarChar, user.username);
      }

      if (agent) {
        query += " AND a.AgentName LIKE @agent";
        request.input("agent", sql.NVarChar, `%${agent}%`);
      }
      if (from) {
        query += " AND a.CreatedAt >= @from";
        request.input("from", sql.DateTime, new Date(from));
      }
      if (to) {
        query += " AND a.CreatedAt <= @to";
        request.input("to", sql.DateTime, new Date(to + "T23:59:59"));
      }
      if (location) {
        query += " AND a.AgentLocation = @location";
        request.input("location", sql.NVarChar, location);
      }
      if (supervisor && user.accountType !== "Team Leader") {
        query += " AND a.AgentSupervisor = @filterSupervisor";
        request.input("filterSupervisor", sql.NVarChar, supervisor);
      }

      query += " ORDER BY a.CreatedAt DESC";
      const result = await request.query(query);
      return res.json({ success: true, audits: result.recordset });
    } catch (error) {
      console.error("Team audit list error:", error);
      return res.status(500).json({ success: false, message: "Server error fetching team audits." });
    }
  });

  /**
   * GET /api/audits/team/summary
   */
  router.get("/team/summary", async (req, res) => {
    try {
      await ensureAuditSchema();
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, message: "Authentication required." });

      const pool = await connectToDatabase();
      let whereClause = "WHERE 1=1";
      const request = pool.request();

      if (user.accountType === "Team Leader") {
        whereClause += " AND a.AgentSupervisor = @supervisor";
        request.input("supervisor", sql.NVarChar, user.username);
      } else if (user.accountType === "Manager") {
        whereClause += " AND (a.AgentSupervisor = @supervisor OR a.AuditorUsername = @auditor)";
        request.input("supervisor", sql.NVarChar, user.username);
        request.input("auditor", sql.NVarChar, user.username);
      }

      const summaryResult = await request.query(`
        SELECT
          COUNT(*) AS totalAudits,
          AVG(a.OverallManualScore) AS avgManualScore,
          AVG(a.OverallAIScore) AS avgAIScore,
          COUNT(DISTINCT a.AgentName) AS uniqueAgents,
          COUNT(CASE WHEN a.CreatedAt >= DATEADD(day, -7, GETDATE()) THEN 1 END) AS auditsThisWeek,
          COUNT(CASE WHEN a.CreatedAt >= DATEADD(day, -30, GETDATE()) THEN 1 END) AS auditsThisMonth
        FROM dbo.CallAudits a
        ${whereClause}
      `);

      const paramRequest = pool.request();
      let paramWhere = "WHERE 1=1";
      if (user.accountType === "Team Leader") {
        paramWhere += " AND a.AgentSupervisor = @supervisor";
        paramRequest.input("supervisor", sql.NVarChar, user.username);
      } else if (user.accountType === "Manager") {
        paramWhere += " AND (a.AgentSupervisor = @supervisor OR a.AuditorUsername = @auditor)";
        paramRequest.input("supervisor", sql.NVarChar, user.username);
        paramRequest.input("auditor", sql.NVarChar, user.username);
      }

      const paramAvgResult = await paramRequest.query(`
        SELECT
          s.ParameterName,
          AVG(s.ManualScore) AS avgManual,
          AVG(s.AIScore) AS avgAI
        FROM dbo.CallAuditScores s
        JOIN dbo.CallAudits a ON s.AuditID = a.AuditID
        ${paramWhere}
        GROUP BY s.ParameterName
      `);

      const perAgentRequest = pool.request();
      let agentWhere = "WHERE a.AgentName IS NOT NULL";
      if (user.accountType === "Team Leader") {
        agentWhere += " AND a.AgentSupervisor = @supervisor";
        perAgentRequest.input("supervisor", sql.NVarChar, user.username);
      } else if (user.accountType === "Manager") {
        agentWhere += " AND (a.AgentSupervisor = @supervisor OR a.AuditorUsername = @auditor)";
        perAgentRequest.input("supervisor", sql.NVarChar, user.username);
        perAgentRequest.input("auditor", sql.NVarChar, user.username);
      }

      const perAgentResult = await perAgentRequest.query(`
        SELECT TOP 20
          a.AgentName,
          COUNT(*) AS auditCount,
          AVG(a.OverallManualScore) AS avgManual,
          AVG(a.OverallAIScore) AS avgAI
        FROM dbo.CallAudits a
        ${agentWhere}
        GROUP BY a.AgentName
        ORDER BY auditCount DESC
      `);

      return res.json({
        success: true,
        summary: summaryResult.recordset[0] || {},
        perAgent: perAgentResult.recordset || [],
        parameterAverages: paramAvgResult.recordset || [],
      });
    } catch (error) {
      console.error("Audit summary error:", error);
      return res.status(500).json({ success: false, message: "Server error fetching audit summary." });
    }
  });

  /**
   * GET /api/audits/team/export
   */
  router.get("/team/export", async (req, res) => {
    try {
      await ensureAuditSchema();
      const user = req.user;
      if (!user || !canAudit(user.accountType)) {
        return res.status(403).json({ success: false, message: "Permission denied." });
      }

      const pool = await connectToDatabase();
      let whereClause = "WHERE 1=1";
      const request = pool.request();

      if (user.accountType === "Team Leader") {
        whereClause += " AND a.AgentSupervisor = @supervisor";
        request.input("supervisor", sql.NVarChar, user.username);
      }

      const { agent, from, to } = req.query;
      if (agent) { whereClause += " AND a.AgentName LIKE @agent"; request.input("agent", sql.NVarChar, `%${agent}%`); }
      if (from) { whereClause += " AND a.CreatedAt >= @from"; request.input("from", sql.DateTime, new Date(from)); }
      if (to) { whereClause += " AND a.CreatedAt <= @to"; request.input("to", sql.DateTime, new Date(to + "T23:59:59")); }

      const result = await request.query(`
        SELECT
          a.AudioFileName, a.AgentName, a.AgentLocation, a.AuditorUsername, a.AuditorRole,
          a.OverallAIScore, a.OverallManualScore,
          a.OverallComments, a.ToneNotes,
          a.CreatedAt,
          s.ParameterName, s.AIScore AS ParamAIScore, s.ManualScore AS ParamManualScore, s.Rationale
        FROM dbo.CallAudits a
        LEFT JOIN dbo.CallAuditScores s ON a.AuditID = s.AuditID
        ${whereClause}
        ORDER BY a.CreatedAt DESC, s.ParameterName
      `);

      const rows = result.recordset;
      if (rows.length === 0) {
        return res.status(200).send("No audit data found.");
      }

      const headers = [
        "AudioFileName", "AgentName", "AgentLocation", "AuditorUsername", "AuditorRole",
        "OverallAIScore", "OverallManualScore", "OverallComments", "ToneNotes",
        "AuditDate", "Parameter", "ParamAIScore", "ParamManualScore", "Rationale"
      ];

      const escapeCSV = (val) => {
        if (val == null) return "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
      };

      let csv = headers.join(",") + "\n";
      for (const row of rows) {
        csv += [
          escapeCSV(row.AudioFileName), escapeCSV(row.AgentName), escapeCSV(row.AgentLocation),
          escapeCSV(row.AuditorUsername), escapeCSV(row.AuditorRole),
          row.OverallAIScore ?? "", row.OverallManualScore ?? "",
          escapeCSV(row.OverallComments), escapeCSV(row.ToneNotes),
          row.CreatedAt ? new Date(row.CreatedAt).toISOString().split("T")[0] : "",
          escapeCSV(row.ParameterName), row.ParamAIScore ?? "", row.ParamManualScore ?? "",
          escapeCSV(row.Rationale),
        ].join(",") + "\n";
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="audit_report_${new Date().toISOString().split("T")[0]}.csv"`);
      return res.send(csv);
    } catch (error) {
      console.error("Audit export error:", error);
      return res.status(500).json({ success: false, message: "Server error exporting audits." });
    }
  });

  /* ─────────────────────────────────────────────────────────────────
   * PARAM ROUTES — after all static routes
   * ───────────────────────────────────────────────────────────────── */

  /**
   * POST /api/audits
   */
  router.post("/", async (req, res) => {
    try {
      await ensureAuditSchema();
      const user = req.user;
      if (!user || !canAudit(user.accountType)) {
        return res.status(403).json({ success: false, message: "You do not have permission to create audits." });
      }

      const {
        audioFileName, scores, overallComments, toneNotes,
        agentName, agentId, agentLocation, agentSupervisor,
        aiScoresSnapshot,
      } = req.body;

      if (!audioFileName || !scores || !Array.isArray(scores)) {
        return res.status(400).json({ success: false, message: "audioFileName and scores[] are required." });
      }

      const pool = await connectToDatabase();

      const numericScores = scores
        .filter(s => s.manualScore != null && !isNaN(parseFloat(s.manualScore)))
        .map(s => parseFloat(s.manualScore));
      const overallManualScore = numericScores.length > 0
        ? parseFloat((numericScores.reduce((a, b) => a + b, 0) / numericScores.length).toFixed(2))
        : null;

      const snapshotAIOverall = (() => {
        if (aiScoresSnapshot && typeof aiScoresSnapshot === "object") {
          const vals = Object.values(aiScoresSnapshot).filter(v => v != null && !isNaN(parseFloat(v)));
          if (vals.length > 0) return parseFloat((vals.reduce((a, b) => a + parseFloat(b), 0) / vals.length).toFixed(2));
        }
        return null;
      })();

      const existing = await pool.request()
        .input("fileName", sql.NVarChar, audioFileName)
        .query("SELECT AuditID FROM dbo.CallAudits WHERE AudioFileName = @fileName");

      let auditId;

      if (existing.recordset.length > 0) {
        auditId = existing.recordset[0].AuditID;
        await pool.request()
          .input("auditId", sql.Int, auditId)
          .input("auditorUsername", sql.NVarChar, user.username)
          .input("auditorRole", sql.NVarChar, user.accountType)
          .input("agentName", sql.NVarChar, agentName || null)
          .input("agentId", sql.NVarChar, agentId || null)
          .input("agentLocation", sql.NVarChar, agentLocation || null)
          .input("agentSupervisor", sql.NVarChar, agentSupervisor || null)
          .input("overallManualScore", sql.Float, overallManualScore)
          .input("overallAIScore", sql.Float, snapshotAIOverall)
          .input("overallComments", sql.NVarChar(sql.MAX), overallComments || null)
          .input("toneNotes", sql.NVarChar(sql.MAX), toneNotes || null)
          .input("aiSnapshot", sql.NVarChar(sql.MAX), JSON.stringify(aiScoresSnapshot || {}))
          .query(`
            UPDATE dbo.CallAudits SET
              AuditorUsername = @auditorUsername, AuditorRole = @auditorRole,
              AgentName = @agentName, AgentID = @agentId, AgentLocation = @agentLocation,
              AgentSupervisor = @agentSupervisor, OverallManualScore = @overallManualScore,
              OverallAIScore = @overallAIScore, OverallComments = @overallComments,
              ToneNotes = @toneNotes, AIScoresSnapshot = @aiSnapshot,
              UpdatedAt = GETDATE()
            WHERE AuditID = @auditId
          `);

        await pool.request()
          .input("auditId", sql.Int, auditId)
          .query("DELETE FROM dbo.CallAuditScores WHERE AuditID = @auditId");
      } else {
        const insertResult = await pool.request()
          .input("fileName", sql.NVarChar, audioFileName)
          .input("auditorUsername", sql.NVarChar, user.username)
          .input("auditorRole", sql.NVarChar, user.accountType)
          .input("agentName", sql.NVarChar, agentName || null)
          .input("agentId", sql.NVarChar, agentId || null)
          .input("agentLocation", sql.NVarChar, agentLocation || null)
          .input("agentSupervisor", sql.NVarChar, agentSupervisor || null)
          .input("overallManualScore", sql.Float, overallManualScore)
          .input("overallAIScore", sql.Float, snapshotAIOverall)
          .input("overallComments", sql.NVarChar(sql.MAX), overallComments || null)
          .input("toneNotes", sql.NVarChar(sql.MAX), toneNotes || null)
          .input("aiSnapshot", sql.NVarChar(sql.MAX), JSON.stringify(aiScoresSnapshot || {}))
          .query(`
            INSERT INTO dbo.CallAudits
              (AudioFileName, AuditorUsername, AuditorRole, AgentName, AgentID, AgentLocation,
               AgentSupervisor, OverallManualScore, OverallAIScore, OverallComments,
               ToneNotes, AIScoresSnapshot)
            VALUES
              (@fileName, @auditorUsername, @auditorRole, @agentName, @agentId, @agentLocation,
               @agentSupervisor, @overallManualScore, @overallAIScore, @overallComments,
               @toneNotes, @aiSnapshot);
            SELECT SCOPE_IDENTITY() AS AuditID;
          `);
        auditId = insertResult.recordset[0].AuditID;
      }

      for (const score of scores) {
        await pool.request()
          .input("auditId", sql.Int, auditId)
          .input("parameterName", sql.NVarChar, score.parameterName)
          .input("manualScore", sql.Float, score.manualScore != null ? parseFloat(score.manualScore) : null)
          .input("aiScore", sql.Float, score.aiScore != null ? parseFloat(score.aiScore) : null)
          .input("rationale", sql.NVarChar(sql.MAX), score.rationale || null)
          .query(`
            INSERT INTO dbo.CallAuditScores (AuditID, ParameterName, ManualScore, AIScore, Rationale)
            VALUES (@auditId, @parameterName, @manualScore, @aiScore, @rationale)
          `);
      }

      writeLog(`[${getISTTimeString()}] Audit saved for ${audioFileName} by ${user.username} (AuditID: ${auditId})`);
      return res.json({ success: true, auditId, message: "Audit saved successfully." });
    } catch (error) {
      writeLog(`[${getISTTimeString()}] Audit save error: ${error.message}`);
      console.error("Audit save error:", error);
      return res.status(500).json({ success: false, message: "Server error saving audit." });
    }
  });

  /**
   * GET /api/audits/:filename
   */
  router.get("/:filename", async (req, res) => {
    try {
      await ensureAuditSchema();
      const { filename } = req.params;
      const pool = await connectToDatabase();

      const auditResult = await pool.request()
        .input("fileName", sql.NVarChar, filename)
        .query("SELECT * FROM dbo.CallAudits WHERE AudioFileName = @fileName");

      if (auditResult.recordset.length === 0) {
        return res.json({ success: true, audit: null });
      }

      const audit = auditResult.recordset[0];
      const scoresResult = await pool.request()
        .input("auditId", sql.Int, audit.AuditID)
        .query("SELECT ParameterName, ManualScore, AIScore, Rationale FROM dbo.CallAuditScores WHERE AuditID = @auditId");

      audit.scores = scoresResult.recordset;
      try { audit.AIScoresSnapshot = JSON.parse(audit.AIScoresSnapshot || "{}"); } catch { audit.AIScoresSnapshot = {}; }

      return res.json({ success: true, audit });
    } catch (error) {
      console.error("Audit fetch error:", error);
      return res.status(500).json({ success: false, message: "Server error fetching audit." });
    }
  });

  /**
   * DELETE /api/audits/:filename
   */
  router.delete("/:filename", async (req, res) => {
    try {
      const user = req.user;
      if (!user || !["Super Admin", "Admin"].includes(user.accountType)) {
        return res.status(403).json({ success: false, message: "Only Admin/Super Admin can delete audits." });
      }
      const pool = await connectToDatabase();
      await pool.request()
        .input("fileName", sql.NVarChar, req.params.filename)
        .query("DELETE FROM dbo.CallAudits WHERE AudioFileName = @fileName");

      writeLog(`[${getISTTimeString()}] Audit deleted for ${req.params.filename} by ${user.username}`);
      return res.json({ success: true, message: "Audit deleted." });
    } catch (error) {
      console.error("Audit delete error:", error);
      return res.status(500).json({ success: false, message: "Server error deleting audit." });
    }
  });

  return router;
}

module.exports = { createAuditRouter };
