/**
 * Bank configuration for AI translation / scoring / script compliance.
 */

const {
  BANKING_PRODUCT_TERMS,
  NON_BANKING_PRODUCT_TERMS,
  DEFAULT_GLOSSARY,
  DEFAULT_TABOO_WORDS,
} = require("./bankSettingsDefaults");

const DEFAULT_BANK = {
  bankName: "Call Center",
  bankNameLocal: "",
  glossary: DEFAULT_GLOSSARY,
  productTerms: BANKING_PRODUCT_TERMS,
  nonBankingTerms: NON_BANKING_PRODUCT_TERMS,
  tabooWords: DEFAULT_TABOO_WORDS,
  scriptTargets: null,
};

function safeJsonParse(raw, fallback) {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeGlossary(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const source = String(row.source ?? row.term ?? row.hindi ?? "").trim();
      const target = String(row.target ?? row.english ?? row.translation ?? "").trim();
      const note = String(row.note ?? row.context ?? "").trim();
      const language = String(row.language ?? "Hindi").trim() || "Hindi";
      if (!source && !target) return null;
      return { source, target, note, language };
    })
    .filter(Boolean);
}

function normalizeProductTerms(items) {
  if (Array.isArray(items)) {
    return items.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof items === "string") {
    return items.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function normalizeTabooWords(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const word = String(row.word ?? row.term ?? "").trim();
      if (!word) return null;
      const severity = String(row.severity ?? "medium").trim().toLowerCase();
      const appliesTo = String(row.appliesTo ?? row.applies_to ?? "agent").trim().toLowerCase();
      const category = String(row.category ?? "policy").trim().toLowerCase();
      const language = String(row.language ?? "Any").trim() || "Any";
      return { word, language, severity, appliesTo, category };
    })
    .filter(Boolean);
}

function withDefaults(config) {
  return {
    ...config,
    glossary: config.glossary?.length ? config.glossary : DEFAULT_BANK.glossary,
    productTerms: config.productTerms?.length ? config.productTerms : DEFAULT_BANK.productTerms,
    nonBankingTerms: config.nonBankingTerms?.length ? config.nonBankingTerms : DEFAULT_BANK.nonBankingTerms,
    tabooWords: config.tabooWords?.length ? config.tabooWords : DEFAULT_BANK.tabooWords,
  };
}

function rowToConfig(row) {
  if (!row) return withDefaults({ ...DEFAULT_BANK });
  const config = {
    bankName: row.BankName || DEFAULT_BANK.bankName,
    bankNameLocal: row.BankNameLocal || "",
    glossary: normalizeGlossary(safeJsonParse(row.GlossaryJson, [])),
    productTerms: normalizeProductTerms(safeJsonParse(row.ProductTermsJson, [])),
    nonBankingTerms: normalizeProductTerms(safeJsonParse(row.NonBankingTermsJson, [])),
    tabooWords: normalizeTabooWords(safeJsonParse(row.TabooWordsJson, [])),
    scriptTargets: safeJsonParse(row.ScriptTargetsJson, null),
    updatedAt: row.UpdatedAt || null,
    updatedBy: row.UpdatedBy || null,
  };
  return withDefaults(config);
}

async function ensureBankSettingsSchema(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.BankSettings', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.BankSettings (
        SettingID           INT NOT NULL PRIMARY KEY DEFAULT 1,
        BankName            NVARCHAR(200) NOT NULL DEFAULT N'Call Center',
        BankNameLocal       NVARCHAR(200) NULL,
        GlossaryJson        NVARCHAR(MAX) NULL,
        ProductTermsJson    NVARCHAR(MAX) NULL,
        NonBankingTermsJson NVARCHAR(MAX) NULL,
        TabooWordsJson      NVARCHAR(MAX) NULL,
        ScriptTargetsJson   NVARCHAR(MAX) NULL,
        UpdatedAt           DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy           NVARCHAR(100) NULL,
        CONSTRAINT CK_BankSettings_SingleRow CHECK (SettingID = 1)
      );
    END
  `);

  await pool.request().query(`
    IF COL_LENGTH('dbo.BankSettings', 'NonBankingTermsJson') IS NULL
      ALTER TABLE dbo.BankSettings ADD NonBankingTermsJson NVARCHAR(MAX) NULL;
    IF COL_LENGTH('dbo.BankSettings', 'TabooWordsJson') IS NULL
      ALTER TABLE dbo.BankSettings ADD TabooWordsJson NVARCHAR(MAX) NULL;
  `);

  const countResult = await pool.request().query(
    "SELECT COUNT(*) AS cnt FROM dbo.BankSettings WHERE SettingID = 1"
  );
  const hasRow = (countResult.recordset[0]?.cnt || 0) > 0;

  if (!hasRow) {
    await pool.request()
      .input("bankName", DEFAULT_BANK.bankName)
      .input("bankNameLocal", DEFAULT_BANK.bankNameLocal)
      .input("glossaryJson", JSON.stringify(DEFAULT_BANK.glossary))
      .input("productTermsJson", JSON.stringify(DEFAULT_BANK.productTerms))
      .input("nonBankingTermsJson", JSON.stringify(DEFAULT_BANK.nonBankingTerms))
      .input("tabooWordsJson", JSON.stringify(DEFAULT_BANK.tabooWords))
      .input("updatedBy", "system-migration")
      .query(`
        INSERT INTO dbo.BankSettings (
          SettingID, BankName, BankNameLocal, GlossaryJson, ProductTermsJson,
          NonBankingTermsJson, TabooWordsJson, UpdatedBy
        )
        VALUES (
          1, @bankName, @bankNameLocal, @glossaryJson, @productTermsJson,
          @nonBankingTermsJson, @tabooWordsJson, @updatedBy
        )
      `);
  } else {
    // Backfill NULL JSON columns on existing row (upgrade from old schema)
    await pool.request()
      .input("glossaryJson", JSON.stringify(DEFAULT_BANK.glossary))
      .input("productTermsJson", JSON.stringify(DEFAULT_BANK.productTerms))
      .input("nonBankingTermsJson", JSON.stringify(DEFAULT_BANK.nonBankingTerms))
      .input("tabooWordsJson", JSON.stringify(DEFAULT_BANK.tabooWords))
      .query(`
        UPDATE dbo.BankSettings SET
          GlossaryJson = COALESCE(NULLIF(LTRIM(RTRIM(GlossaryJson)), ''), @glossaryJson),
          ProductTermsJson = COALESCE(NULLIF(LTRIM(RTRIM(ProductTermsJson)), ''), @productTermsJson),
          NonBankingTermsJson = COALESCE(NonBankingTermsJson, @nonBankingTermsJson),
          TabooWordsJson = COALESCE(TabooWordsJson, @tabooWordsJson)
        WHERE SettingID = 1
          AND (
            NonBankingTermsJson IS NULL OR TabooWordsJson IS NULL
            OR LTRIM(RTRIM(ISNULL(GlossaryJson, ''))) = ''
            OR LTRIM(RTRIM(ISNULL(ProductTermsJson, ''))) = ''
          )
      `);
  }
}

async function getBankSettings(pool) {
  await ensureBankSettingsSchema(pool);
  const result = await pool.request().query(`
    SELECT TOP 1 BankName, BankNameLocal, GlossaryJson, ProductTermsJson,
           NonBankingTermsJson, TabooWordsJson, ScriptTargetsJson, UpdatedAt, UpdatedBy
    FROM dbo.BankSettings WHERE SettingID = 1
  `);
  return rowToConfig(result.recordset[0]);
}

async function saveBankSettings(pool, body, username) {
  await ensureBankSettingsSchema(pool);
  const bankName = String(body.bankName ?? body.BankName ?? "").trim();
  if (!bankName) {
    throw new Error("Bank name is required.");
  }

  const bankNameLocal = String(body.bankNameLocal ?? body.BankNameLocal ?? "").trim();
  const glossary = normalizeGlossary(body.glossary ?? body.Glossary ?? []);
  const productTerms = normalizeProductTerms(body.productTerms ?? body.ProductTerms ?? []);
  const nonBankingTerms = normalizeProductTerms(body.nonBankingTerms ?? body.NonBankingTerms ?? []);
  const tabooWords = normalizeTabooWords(body.tabooWords ?? body.TabooWords ?? []);
  const scriptTargets = body.scriptTargets ?? body.ScriptTargets ?? null;

  await pool.request()
    .input("bankName", bankName)
    .input("bankNameLocal", bankNameLocal)
    .input("glossaryJson", JSON.stringify(glossary))
    .input("productTermsJson", JSON.stringify(productTerms))
    .input("nonBankingTermsJson", JSON.stringify(nonBankingTerms))
    .input("tabooWordsJson", JSON.stringify(tabooWords))
    .input("scriptTargetsJson", scriptTargets ? JSON.stringify(scriptTargets) : null)
    .input("updatedBy", username || "system")
    .query(`
      MERGE dbo.BankSettings AS target
      USING (SELECT 1 AS SettingID) AS source
      ON target.SettingID = source.SettingID
      WHEN MATCHED THEN UPDATE SET
        BankName = @bankName,
        BankNameLocal = @bankNameLocal,
        GlossaryJson = @glossaryJson,
        ProductTermsJson = @productTermsJson,
        NonBankingTermsJson = @nonBankingTermsJson,
        TabooWordsJson = @tabooWordsJson,
        ScriptTargetsJson = @scriptTargetsJson,
        UpdatedAt = GETDATE(),
        UpdatedBy = @updatedBy
      WHEN NOT MATCHED THEN INSERT (
        SettingID, BankName, BankNameLocal, GlossaryJson, ProductTermsJson,
        NonBankingTermsJson, TabooWordsJson, ScriptTargetsJson, UpdatedBy
      ) VALUES (
        1, @bankName, @bankNameLocal, @glossaryJson, @productTermsJson,
        @nonBankingTermsJson, @tabooWordsJson, @scriptTargetsJson, @updatedBy
      );
    `);

  return getBankSettings(pool);
}

module.exports = {
  DEFAULT_BANK,
  ensureBankSettingsSchema,
  getBankSettings,
  saveBankSettings,
  rowToConfig,
};
