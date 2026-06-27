/**
 * Query-category service — manages the admin-editable customer query taxonomy
 * stored in dbo.AI_Query_Categories. Used by the admin panel (CRUD) and by the
 * AI intelligence layer (reads the active list to classify calls).
 */
const sql = require("mssql");
const { DEFAULT_QUERY_CATEGORIES } = require("./queryCategoryDefaults");

async function ensureSchemaAndSeed(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.AI_Query_Categories', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.AI_Query_Categories (
        CategoryID  INT IDENTITY(1,1) PRIMARY KEY,
        Name        NVARCHAR(150) NOT NULL,
        Description NVARCHAR(500) NULL,
        Keywords    NVARCHAR(MAX) NULL,
        Color       NVARCHAR(20)  NULL,
        IsActive    BIT NOT NULL DEFAULT 1,
        SortOrder   INT NOT NULL DEFAULT 0,
        CreatedAt   DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt   DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy   NVARCHAR(100) NULL,
        CONSTRAINT UQ_AI_Query_Categories_Name UNIQUE (Name)
      );
    END
  `);

  const countRes = await pool.request().query("SELECT COUNT(*) AS c FROM dbo.AI_Query_Categories");
  if ((countRes.recordset[0]?.c || 0) > 0) return;

  for (let i = 0; i < DEFAULT_QUERY_CATEGORIES.length; i++) {
    const c = DEFAULT_QUERY_CATEGORIES[i];
    await pool.request()
      .input("name", sql.NVarChar(150), c.name)
      .input("description", sql.NVarChar(500), c.description || null)
      .input("keywords", sql.NVarChar(sql.MAX), c.keywords || null)
      .input("color", sql.NVarChar(20), c.color || null)
      .input("sortOrder", sql.Int, i)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.AI_Query_Categories WHERE Name = @name)
          INSERT INTO dbo.AI_Query_Categories (Name, Description, Keywords, Color, IsActive, SortOrder)
          VALUES (@name, @description, @keywords, @color, 1, @sortOrder)
      `);
  }
}

function mapRow(r) {
  return {
    id: r.CategoryID,
    name: r.Name,
    description: r.Description || "",
    keywords: r.Keywords || "",
    color: r.Color || "#94a3b8",
    isActive: r.IsActive === true || r.IsActive === 1,
    sortOrder: r.SortOrder ?? 0,
    updatedAt: r.UpdatedAt || null,
    updatedBy: r.UpdatedBy || null,
  };
}

async function listCategories(pool, { activeOnly = false } = {}) {
  await ensureSchemaAndSeed(pool);
  const where = activeOnly ? "WHERE IsActive = 1" : "";
  const res = await pool.request().query(`
    SELECT CategoryID, Name, Description, Keywords, Color, IsActive, SortOrder, UpdatedAt, UpdatedBy
    FROM dbo.AI_Query_Categories
    ${where}
    ORDER BY SortOrder, Name
  `);
  return res.recordset.map(mapRow);
}

async function createCategory(pool, body, username) {
  await ensureSchemaAndSeed(pool);
  const name = (body.name || "").trim();
  if (!name) { const e = new Error("Category name is required."); e.status = 400; throw e; }

  const dup = await pool.request()
    .input("name", sql.NVarChar(150), name)
    .query("SELECT 1 FROM dbo.AI_Query_Categories WHERE Name = @name");
  if (dup.recordset.length) { const e = new Error("A category with this name already exists."); e.status = 409; throw e; }

  const res = await pool.request()
    .input("name", sql.NVarChar(150), name)
    .input("description", sql.NVarChar(500), (body.description || "").trim() || null)
    .input("keywords", sql.NVarChar(sql.MAX), (body.keywords || "").trim() || null)
    .input("color", sql.NVarChar(20), (body.color || "").trim() || "#94a3b8")
    .input("isActive", sql.Bit, body.isActive === false ? 0 : 1)
    .input("sortOrder", sql.Int, Number.isFinite(+body.sortOrder) ? +body.sortOrder : 999)
    .input("updatedBy", sql.NVarChar(100), username || null)
    .query(`
      INSERT INTO dbo.AI_Query_Categories (Name, Description, Keywords, Color, IsActive, SortOrder, UpdatedBy)
      OUTPUT INSERTED.CategoryID, INSERTED.Name, INSERTED.Description, INSERTED.Keywords,
             INSERTED.Color, INSERTED.IsActive, INSERTED.SortOrder, INSERTED.UpdatedAt, INSERTED.UpdatedBy
      VALUES (@name, @description, @keywords, @color, @isActive, @sortOrder, @updatedBy)
    `);
  return mapRow(res.recordset[0]);
}

async function updateCategory(pool, id, body, username) {
  await ensureSchemaAndSeed(pool);
  const catId = parseInt(id, 10);
  if (!Number.isFinite(catId)) { const e = new Error("Invalid category id."); e.status = 400; throw e; }
  const name = (body.name || "").trim();
  if (!name) { const e = new Error("Category name is required."); e.status = 400; throw e; }

  const dup = await pool.request()
    .input("name", sql.NVarChar(150), name)
    .input("id", sql.Int, catId)
    .query("SELECT 1 FROM dbo.AI_Query_Categories WHERE Name = @name AND CategoryID <> @id");
  if (dup.recordset.length) { const e = new Error("Another category already uses this name."); e.status = 409; throw e; }

  const res = await pool.request()
    .input("id", sql.Int, catId)
    .input("name", sql.NVarChar(150), name)
    .input("description", sql.NVarChar(500), (body.description || "").trim() || null)
    .input("keywords", sql.NVarChar(sql.MAX), (body.keywords || "").trim() || null)
    .input("color", sql.NVarChar(20), (body.color || "").trim() || "#94a3b8")
    .input("isActive", sql.Bit, body.isActive === false ? 0 : 1)
    .input("sortOrder", sql.Int, Number.isFinite(+body.sortOrder) ? +body.sortOrder : 0)
    .input("updatedBy", sql.NVarChar(100), username || null)
    .query(`
      UPDATE dbo.AI_Query_Categories
      SET Name = @name, Description = @description, Keywords = @keywords, Color = @color,
          IsActive = @isActive, SortOrder = @sortOrder, UpdatedAt = GETDATE(), UpdatedBy = @updatedBy
      OUTPUT INSERTED.CategoryID, INSERTED.Name, INSERTED.Description, INSERTED.Keywords,
             INSERTED.Color, INSERTED.IsActive, INSERTED.SortOrder, INSERTED.UpdatedAt, INSERTED.UpdatedBy
      WHERE CategoryID = @id
    `);
  if (!res.recordset.length) { const e = new Error("Category not found."); e.status = 404; throw e; }
  return mapRow(res.recordset[0]);
}

async function deleteCategory(pool, id) {
  await ensureSchemaAndSeed(pool);
  const catId = parseInt(id, 10);
  if (!Number.isFinite(catId)) { const e = new Error("Invalid category id."); e.status = 400; throw e; }
  const res = await pool.request()
    .input("id", sql.Int, catId)
    .query("DELETE FROM dbo.AI_Query_Categories WHERE CategoryID = @id");
  if (!res.rowsAffected[0]) { const e = new Error("Category not found."); e.status = 404; throw e; }
  return true;
}

module.exports = {
  ensureSchemaAndSeed,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
