require('dotenv').config();
const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { connectToDatabase } = require("./dbConnection");

// Logging utility
function logAction(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

/**
 * (1) Fetch all active agents
 */
router.get("/agents", async (req, res) => {
  logAction("Fetching all active agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .query(`
        SELECT *
        FROM Agents
        WHERE is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    // If agent_type is missing, fallback to null
    const recordset = result.recordset.map(agent => ({
      ...agent,
      agent_type: agent.agent_type || null
    }));

    logAction("Successfully fetched all active agents.");
    return res.status(200).json(recordset);
  } catch (error) {
    logAction(`Error fetching all agents: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch agents" });
  }
});

/**
 * (2) Fetch inbound or outbound agents
 *     (Optional endpoints if you want separate listings)
 */
router.get("/agents/inbound", async (req, res) => {
  logAction("Fetching inbound agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .input("type", sql.NVarChar, "Inbound")
      .query(`
        SELECT * FROM Agents
        WHERE agent_type = @type
          AND is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAction(`Error fetching inbound: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch inbound agents" });
  }
});

router.get("/agents/outbound", async (req, res) => {
  logAction("Fetching outbound agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .input("type", sql.NVarChar, "Outbound")
      .query(`
        SELECT * FROM Agents
        WHERE agent_type = @type
          AND is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAction(`Error fetching outbound: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch outbound agents" });
  }
});

/**
 * (3) Add new agent
 */
router.post("/agents", async (req, res) => {
  logAction("Creating a new agent...");
  const {
    name,
    agentId,
    email,
    mobile,
    supervisor,
    type,
    manager,
    auditor,
    notes,
    agent_location
  } = req.body;

  // Validate required fields
  if (!name || !agentId || !email || !mobile || !supervisor || !type) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("agent_id", sql.NVarChar, agentId)
      .input("agent_name", sql.NVarChar, name)
      .input("agent_email", sql.NVarChar, email)
      .input("agent_mobile", sql.NVarChar, mobile)
      .input("supervisor", sql.NVarChar, supervisor)
      .input("agent_type", sql.NVarChar, type)
      .input("manager", sql.NVarChar, manager || null)
      .input("auditor", sql.NVarChar, auditor || null)
      .input("notes", sql.NVarChar, notes || null)
      .input("agent_location", sql.NVarChar, agent_location || null)
      .query(`
        INSERT INTO Agents (
          agent_id,
          agent_name,
          agent_email,
          agent_mobile,
          supervisor,
          agent_type,
          manager,
          auditor,
          notes,
          agent_location,
          is_active,
          deactivated_date,
          agent_creation_date
        )
        VALUES (
          @agent_id,
          @agent_name,
          @agent_email,
          @agent_mobile,
          @supervisor,
          @agent_type,
          @manager,
          @auditor,
          @notes,
          @agent_location,
          1,
          NULL,
          GETDATE()   -- auto-set creation date now
        );
      `);

    logAction("New agent created successfully.");
    return res.status(201).json({ message: "Agent created successfully" });
  } catch (err) {
    logAction(`Error creating agent: ${err.message}`);
    return res.status(500).json({ error: "Failed to create agent" });
  }
});

/**
 * (4) Update an agent
 */
router.put("/agents/:id", async (req, res) => {
  const { id } = req.params; // This is a string like "AGT5209"
  logAction(`Updating agent with ID = ${id} ...`);

  const {
    agent_name,
    agent_email,
    agent_mobile,
    supervisor,
    agent_type,
    manager,
    auditor,
    notes,
    agent_location
  } = req.body;

  // Minimal required
  if (!agent_name || !agent_email || !agent_mobile || !supervisor || !agent_type) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id)  // agent_id is a string
      .input("agent_name", sql.NVarChar, agent_name)
      .input("agent_email", sql.NVarChar, agent_email)
      .input("agent_mobile", sql.NVarChar, agent_mobile)
      .input("supervisor", sql.NVarChar, supervisor)
      .input("agent_type", sql.NVarChar, agent_type)
      .input("manager", sql.NVarChar, manager || null)
      .input("auditor", sql.NVarChar, auditor || null)
      .input("notes", sql.NVarChar, notes || null)
      .input("agent_location", sql.NVarChar, agent_location || null)
      .query(`
        UPDATE Agents
        SET
          agent_name = @agent_name,
          agent_email = @agent_email,
          agent_mobile = @agent_mobile,
          supervisor = @supervisor,
          agent_type = @agent_type,
          manager = @manager,
          auditor = @auditor,
          notes = @notes,
          agent_location = @agent_location
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAction(`Agent ${id} updated successfully.`);
      return res.status(200).json({ message: "Agent updated successfully" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (err) {
    logAction(`Error updating agent ${id}: ${err.message}`);
    return res.status(500).json({ error: "Failed to update agent" });
  }
});

/**
 * (5) Hard Delete an agent by agent_id
 */
router.delete("/agents/:id", async (req, res) => {
  const { id } = req.params;
  logAction(`Hard deleting agent ID = ${id} ...`);
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id) // must match table's string type
      .query(`
        DELETE FROM Agents
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAction(`Agent ${id} deleted successfully.`);
      return res.status(200).json({ message: "Agent deleted successfully" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (error) {
    logAction(`Error deleting agent: ${error.message}`);
    return res.status(500).json({ error: "Failed to delete agent" });
  }
});

/**
 * (6) Search agents by name or agent_id (only active)
 */
router.get("/agents/search", async (req, res) => {
  logAction("Searching agents...");
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Missing search parameter: 'q'" });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("searchTerm", sql.NVarChar, `%${q}%`)
      .query(`
        SELECT *
        FROM Agents
        WHERE is_active = 1
          AND (
            agent_name LIKE @searchTerm
            OR agent_id LIKE @searchTerm
          )
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAction(`Error searching agents: ${error.message}`);
    return res.status(500).json({ error: "Failed to search agents" });
  }
});

/**
 * (7) Deactivate Agent (soft delete)
 *     sets is_active=0, and deactivated_date=GETDATE()
 */
router.put("/agents/:id/deactivate", async (req, res) => {
  const { id } = req.params;
  logAction(`Deactivating agent ID = ${id} ...`);

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id) // agent_id is string
      .query(`
        UPDATE Agents
        SET
          is_active = 0,
          deactivated_date = GETDATE()
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAction(`Agent ${id} deactivated successfully.`);
      return res.status(200).json({ message: "Agent deactivated" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (err) {
    logAction(`Error deactivating agent: ${err.message}`);
    return res.status(500).json({ error: "Failed to deactivate agent" });
  }
});

module.exports = router;