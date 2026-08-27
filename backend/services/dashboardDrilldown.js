const crypto = require("crypto");
const { ptpQualitySql } = require("./ptpQuality");

const TOKEN_VERSION = 1;
const TOKEN_TTL_SECONDS = 30 * 60;
const MAX_PAGE_SIZE = 100;

const OPERATIONAL_KEYS = new Set(["all", "success", "failed"]);
const TONE_KEYS = new Set([
  "agent-positive", "agent-neutral", "agent-negative", "agent-unknown",
  "customer-positive", "customer-neutral", "customer-negative", "customer-unknown",
]);
const INSIGHT_KEYS = new Set([
  "query-type",
  "hold-detected",
  "hold-longest",
  "escalation-requested",
  "escalation-actioned",
  "escalation-not-actioned",
  "escalation-csat",
  "escalation-category",
]);
const COLLECTION_KEYS = new Set([
  "audited",
  "ptp",
  "ptp-strong",
  "ptp-weak",
  "fatal",
  "red-alert",
  "ztp",
  "rag-green",
  "rag-amber",
  "rag-red",
  "disposition",
  "disposition-other",
  "campaign",
  "campaign-other",
]);

const STATIC_META = {
  "operational:all": ["All calls", "Every call in the selected dashboard scope."],
  "operational:success": ["Successful calls", "Processing completed successfully."],
  "operational:failed": ["Failed calls", "Processing reported a failed or error status."],
  "collections:audited": ["Collections-scored calls", "Calls with a collections quality score."],
  "collections:ptp": ["PTP secured calls", "Calls where Promise to Pay is present."],
  "collections:ptp-strong": ["Strong PTP calls", "Secured Promise to Pay calls tagged Genuine."],
  "collections:ptp-weak": ["Weak PTP calls", "Secured Promise to Pay calls that are not Genuine."],
  "collections:fatal": ["Fatal calls", "Calls where a fatal collections rule was triggered."],
  "collections:red-alert": ["Red-alert calls", "Calls marked for immediate attention."],
  "collections:ztp": ["ZTP violations", "Calls containing a zero-tolerance policy violation."],
  "collections:rag-green": ["Green quality calls", "Collections quality score is at least 85%."],
  "collections:rag-amber": ["Amber quality calls", "Collections quality score is from 80% through 84.99%."],
  "collections:rag-red": ["Red quality calls", "Collections quality score is below 80%."],
  "insight:hold-detected": ["Calls with agent hold", "Calls where the AI detected one or more hold episodes."],
  "insight:hold-longest": ["Longest-hold calls", "Call or calls tied for the longest detected hold in the selected dashboard scope."],
  "insight:escalation-requested": ["Senior escalation requested", "Calls where the customer requested a senior or supervisor escalation."],
  "insight:escalation-actioned": ["Escalations actioned", "Escalation-requested calls where the agent actioned the request."],
  "insight:escalation-not-actioned": ["Escalations not actioned", "Escalation-requested calls where the request was not actioned."],
  "insight:escalation-csat": ["C-SAT transfers", "Calls transferred to the C-SAT flow."],
};

function signingSecret(override) {
  const secret = String(
    override
      || process.env.INSTALL_HMAC_SECRET
      || process.env.SESSION_SECRET
      || process.env.JWT_SECRET
      || "",
  ).trim();
  if (secret.length < 24) {
    const err = new Error("Dashboard drill-down signing secret is unavailable.");
    err.code = "DRILLDOWN_SECRET_UNAVAILABLE";
    throw err;
  }
  return secret;
}

function safeString(value, max = 200) {
  const text = String(value == null ? "" : value).trim();
  return text ? text.slice(0, max) : null;
}

function normalizeDate(value) {
  const text = safeString(value, 10);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeFilters(raw = {}) {
  const normalizeOption = (value) => {
    const text = safeString(value);
    return !text || text.toLowerCase() === "all" ? null : text;
  };
  return {
    fromDate: normalizeDate(raw.fromDate),
    toDate: normalizeDate(raw.toDate),
    location: normalizeOption(raw.location),
    tl: normalizeOption(raw.tl || raw.supervisor),
    callType: normalizeOption(raw.callType)?.toLowerCase() || null,
    agent: normalizeOption(raw.agent),
    leadClassification: normalizeOption(raw.leadClassification),
  };
}

function validateDefinition({ kind, key, value, excludedValues }) {
  if (kind === "operational" && OPERATIONAL_KEYS.has(key)) return;
  if (kind === "tone" && TONE_KEYS.has(key)) return;
  if (kind === "insight" && INSIGHT_KEYS.has(key)) {
    if (["query-type", "hold-longest", "escalation-category"].includes(key) && !safeString(value)) {
      throw new Error("A category or metric value is required for this drill-down.");
    }
    if (key === "hold-longest" && !(Number(value) > 0)) {
      throw new Error("The longest-hold value is invalid.");
    }
    return;
  }
  if (kind !== "collections" || !COLLECTION_KEYS.has(key)) {
    throw new Error("Unsupported dashboard drill-down definition.");
  }
  if (["disposition", "campaign"].includes(key) && !safeString(value)) {
    throw new Error("A category value is required for this drill-down.");
  }
  if (["disposition-other", "campaign-other"].includes(key)) {
    if (!Array.isArray(excludedValues) || !excludedValues.length || excludedValues.length > 12) {
      throw new Error("The grouped category definition is invalid.");
    }
  }
}

function validateFilters(filters) {
  if (!filters?.fromDate || !filters?.toDate || filters.fromDate > filters.toDate) {
    throw new Error("The dashboard date range is invalid. Refresh the dashboard and try again.");
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function issueToken({
  kind,
  key,
  value,
  excludedValues,
  filters,
  username,
  tenant,
  expectedCount,
  sourceVariant = "full",
  nowSeconds = Math.floor(Date.now() / 1000),
  secret,
}) {
  const cleanValue = safeString(value);
  const cleanExcluded = Array.isArray(excludedValues)
    ? [...new Set(excludedValues.map((v) => safeString(v)).filter(Boolean))].slice(0, 12)
    : undefined;
  validateDefinition({ kind, key, value: cleanValue, excludedValues: cleanExcluded });

  const normalizedFilters = normalizeFilters(filters);
  validateFilters(normalizedFilters);
  const payload = {
    v: TOKEN_VERSION,
    kind,
    key,
    value: cleanValue || undefined,
    excludedValues: cleanExcluded,
    filters: normalizedFilters,
    sub: safeString(username, 120)?.toLowerCase(),
    tenant: safeString(tenant, 128)?.toLowerCase(),
    expectedCount: Math.max(0, Number(expectedCount) || 0),
    sourceVariant: sourceVariant === "fallback" ? "fallback" : "full",
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };
  if (!payload.sub || !payload.tenant) throw new Error("Drill-down scope is incomplete.");

  const body = encodeJson(payload);
  const signature = crypto.createHmac("sha256", signingSecret(secret)).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyToken(token, { username, tenant, nowSeconds = Math.floor(Date.now() / 1000), secret } = {}) {
  const [body, supplied] = String(token || "").split(".");
  if (!body || !supplied) throw new Error("Invalid drill-down token.");
  const expected = crypto.createHmac("sha256", signingSecret(secret)).update(body).digest("base64url");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Invalid drill-down token.");

  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid drill-down token.");
  }
  if (claims.v !== TOKEN_VERSION || Number(claims.exp) < nowSeconds) {
    throw new Error("This dashboard drill-down has expired. Refresh the dashboard and try again.");
  }
  validateDefinition(claims);
  if (safeString(username, 120)?.toLowerCase() !== claims.sub) {
    throw new Error("This drill-down belongs to a different user.");
  }
  if (safeString(tenant, 128)?.toLowerCase() !== claims.tenant) {
    throw new Error("This drill-down belongs to a different organization.");
  }
  claims.filters = normalizeFilters(claims.filters);
  validateFilters(claims.filters);
  return claims;
}

function tenantKey(pool) {
  return safeString(
    pool?.config?.database
      || pool?.config?.options?.database
      || pool?._config?.database
      || pool?._config?.options?.database
      || process.env.DB_DATABASE
      || "default",
    128,
  ) || "default";
}

function operationalPredicate(key, variant = "full") {
  if (key === "all") return "1 = 1";
  if (key === "success") {
    return `LOWER(COALESCE(APR.Status, '')) = 'success'
      AND COALESCE(APR.TranscribeOutput, '') NOT LIKE '%MVP Phase 1 stub%'`;
  }
  if (key === "failed") {
    const consolidatedFailure = variant === "fallback"
      ? ""
      : " OR LOWER(COALESCE(CAA.Status, '')) = 'failed'";
    return `(LOWER(COALESCE(AU.ProcessStatus, '')) LIKE '%fail%'
      OR LOWER(COALESCE(AU.ProcessStatus, '')) LIKE '%error%'
      OR LOWER(COALESCE(APR.Status, '')) IN ('fail', 'failed')${consolidatedFailure})`;
  }
  throw new Error("Unsupported operational drill-down.");
}

function collectionsPredicate(claims, request, sql) {
  const key = claims.key;
  if (key === "audited") return "1 = 1";
  if (key === "ptp") return "LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_PTP_Present, '')))) = 'yes'";
  if (key === "ptp-strong") return ptpQualitySql("CAA", "strong");
  if (key === "ptp-weak") return ptpQualitySql("CAA", "weak");
  if (key === "fatal") return "LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_Coll_Fatal_Triggered, '')))) = 'yes'";
  if (key === "red-alert") return "LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_Red_Alert, '')))) = 'yes'";
  if (key === "ztp") return "LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_ZTP_Violation, '')))) = 'yes'";
  if (key === "rag-green") return "CAA.AI_Coll_Score >= 85";
  if (key === "rag-amber") return "CAA.AI_Coll_Score >= 80 AND CAA.AI_Coll_Score < 85";
  if (key === "rag-red") return "CAA.AI_Coll_Score < 80";

  const isDisposition = key.startsWith("disposition");
  const expression = isDisposition
    ? "COALESCE(NULLIF(LTRIM(RTRIM(CAA.AI_Coll_Disposition)), ''), 'Unknown')"
    : "COALESCE(NULLIF(LTRIM(RTRIM(CAA.AI_Coll_Campaign)), ''), 'Unknown')";
  if (key === "disposition" || key === "campaign") {
    request.input("categoryValue", sql.NVarChar, claims.value);
    return `${expression} = @categoryValue`;
  }
  const excluded = claims.excludedValues || [];
  excluded.forEach((value, index) => request.input(`excluded${index}`, sql.NVarChar, value));
  return `${expression} NOT IN (${excluded.map((_, index) => `@excluded${index}`).join(", ")})`;
}

function toneBucketExpression(role) {
  const roleJsonKey = role === "agent" ? "Agent" : "Customer";
  const validTone = "CASE WHEN ISJSON(APR.ToneAnalysis) = 1 THEN APR.ToneAnalysis ELSE N'{}' END";
  const acoustic = `LOWER(LTRIM(RTRIM(COALESCE(
    NULLIF(LTRIM(RTRIM(JSON_VALUE(${validTone}, '$.results.Overall_Emotion.${roleJsonKey}'))), ''),
    NULLIF(LTRIM(RTRIM(JSON_VALUE(${validTone}, '$.results.overallEmotion.${roleJsonKey}'))), ''),
    NULLIF(LTRIM(RTRIM(JSON_VALUE(${validTone}, '$.Overall_Emotion.${roleJsonKey}'))), ''),
    NULLIF(LTRIM(RTRIM(JSON_VALUE(${validTone}, '$.overallEmotion.${roleJsonKey}'))), ''),
    ''
  ))))`;
  const sentimentAverage = `(SELECT AVG(TRY_CONVERT(FLOAT, JSON_VALUE(S.value, '$."Sentiment Polarity"')))
    FROM OPENJSON(CASE WHEN ISJSON(CAA.Sentiment) = 1 THEN CAA.Sentiment ELSE N'[]' END) S
    WHERE LOWER(LTRIM(RTRIM(COALESCE(JSON_VALUE(S.value, '$.Role'), '')))) = '${role}')`;

  return `CASE
    WHEN ${acoustic} IN ('happy','happiness','joy','joyful','excited','excitement','surprised','surprise') THEN 'positive'
    WHEN ${acoustic} IN ('neutral','calm') THEN 'neutral'
    WHEN ${acoustic} IN ('angry','anger','frustrated','frustration','sad','sadness','fearful','fear','disgusted','disgust') THEN 'negative'
    WHEN ${sentimentAverage} > 0.3 THEN 'positive'
    WHEN ${sentimentAverage} < -0.3 THEN 'negative'
    WHEN ${sentimentAverage} IS NOT NULL THEN 'neutral'
    ELSE 'unknown'
  END`;
}

function tonePredicate(claims, request, sql) {
  const match = /^(agent|customer)-(positive|neutral|negative|unknown)$/.exec(claims.key || "");
  if (!match) throw new Error("Unsupported tone drill-down.");
  request.input("toneBucket", sql.NVarChar, match[2]);
  return `${toneBucketExpression(match[1])} = @toneBucket`;
}

function insightPredicate(claims, request, sql) {
  switch (claims.key) {
    case "query-type":
      request.input("categoryValue", sql.NVarChar, claims.value);
      return "COALESCE(NULLIF(LTRIM(RTRIM(CAA.AI_Primary_Query_Type)), ''), 'Unclassified') = @categoryValue";
    case "hold-detected":
      return "LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_Hold_Detected, '')))) = 'yes'";
    case "hold-longest":
      request.input("metricValue", sql.Float, Number(claims.value));
      return "TRY_CAST(CAA.AI_Hold_Longest_Sec AS FLOAT) = @metricValue";
    case "escalation-requested":
      return "LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_Escalation_Requested, '')))) = 'yes'";
    case "escalation-actioned":
      return `LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_Escalation_Requested, '')))) = 'yes'
        AND LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_Escalation_Actioned, '')))) = 'yes'`;
    case "escalation-not-actioned":
      return `LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_Escalation_Requested, '')))) = 'yes'
        AND LOWER(LTRIM(RTRIM(CAA.AI_Escalation_Actioned))) <> 'yes'`;
    case "escalation-csat":
      return "LOWER(LTRIM(RTRIM(COALESCE(CAA.AI_CSAT_Transferred, '')))) = 'yes'";
    case "escalation-category":
      request.input("categoryValue", sql.NVarChar, claims.value);
      return "COALESCE(NULLIF(LTRIM(RTRIM(CAA.AI_Escalation_Category)), ''), 'None') = @categoryValue";
    default:
      throw new Error("Unsupported insight drill-down.");
  }
}

function bindFilters(request, filters, sql) {
  if (filters.fromDate) request.input("fromDate", sql.Date, filters.fromDate);
  if (filters.toDate) request.input("toDate", sql.Date, filters.toDate);
  if (filters.location) request.input("location", sql.NVarChar, filters.location);
  if (filters.tl) request.input("supervisor", sql.NVarChar, filters.tl);
  if (filters.callType) request.input("callType", sql.NVarChar, filters.callType);
  if (filters.agent) request.input("agent", sql.NVarChar, filters.agent);
  if (filters.leadClassification) {
    request.input("leadClassification", sql.NVarChar, filters.leadClassification.toLowerCase());
  }
  return request;
}

function operationalFilterSql(filters, variant) {
  const parts = [];
  if (filters.fromDate && filters.toDate) {
    parts.push(`(
      CAST(AU.UploadDate AS DATE) BETWEEN @fromDate AND @toDate
      OR CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate
    )`);
  }
  if (filters.location) {
    parts.push(variant === "fallback"
      ? "TRIM(LOWER(AG.agent_location)) = TRIM(LOWER(@location))"
      : "TRIM(LOWER(COALESCE(CAA.AgentLocation, AG.agent_location))) = TRIM(LOWER(@location))");
  }
  if (filters.tl) {
    parts.push(variant === "fallback"
      ? "TRIM(LOWER(AG.supervisor)) = TRIM(LOWER(@supervisor))"
      : "TRIM(LOWER(COALESCE(CAA.AgentSupervisor, AG.supervisor))) = TRIM(LOWER(@supervisor))");
  }
  if (filters.callType) parts.push("LOWER(LTRIM(RTRIM(AU.CallType))) = @callType");
  if (filters.agent) parts.push("AU.SelectedAgent = @agent");
  if (filters.leadClassification) {
    parts.push(variant === "fallback"
      ? "1 = 0"
      : "LOWER(LTRIM(RTRIM(CAA.AI_Lead_Classification))) = @leadClassification");
  }
  return parts;
}

function toneFilterSql(filters) {
  const parts = [];
  if (filters.fromDate && filters.toDate) {
    parts.push(`(
      CAST(AU.UploadDate AS DATE) BETWEEN @fromDate AND @toDate
      OR CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate
    )`);
  }
  if (filters.location) parts.push("TRIM(LOWER(AG.agent_location)) = TRIM(LOWER(@location))");
  if (filters.tl) parts.push("TRIM(LOWER(AG.supervisor)) = TRIM(LOWER(@supervisor))");
  if (filters.callType) parts.push("LOWER(LTRIM(RTRIM(AU.CallType))) = @callType");
  if (filters.agent) parts.push("AU.SelectedAgent = @agent");
  if (filters.leadClassification) {
    parts.push("LOWER(LTRIM(RTRIM(CAA.AI_Lead_Classification))) = @leadClassification");
  }
  return parts;
}

function collectionsFilterSql(filters) {
  const parts = ["CAA.AI_Coll_Score IS NOT NULL"];
  if (filters.fromDate && filters.toDate) {
    parts.push("CAST(COALESCE(CAA.UploadDate, CAA.SelectedCallDate) AS DATE) BETWEEN @fromDate AND @toDate");
  } else {
    parts.push("CAST(COALESCE(CAA.UploadDate, CAA.SelectedCallDate) AS DATE) >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))");
  }
  if (filters.location) parts.push("TRIM(LOWER(CAA.AgentLocation)) = TRIM(LOWER(@location))");
  if (filters.tl) parts.push("TRIM(LOWER(CAA.AgentSupervisor)) = TRIM(LOWER(@supervisor))");
  if (filters.callType) parts.push("LOWER(LTRIM(RTRIM(CAA.CallType))) = @callType");
  if (filters.agent) parts.push("CAA.AgentName = @agent");
  if (filters.leadClassification) {
    parts.push("LOWER(LTRIM(RTRIM(CAA.AI_Lead_Classification))) = @leadClassification");
  }
  return parts;
}

function insightFilterSql(filters) {
  const parts = ["CAA.Status = 'Success'"];
  if (filters.fromDate && filters.toDate) {
    parts.push("COALESCE(CAA.SelectedCallDate, CAST(CAA.UploadDate AS DATE)) BETWEEN @fromDate AND @toDate");
  }
  if (filters.location) parts.push("TRIM(LOWER(CAA.AgentLocation)) = TRIM(LOWER(@location))");
  if (filters.tl) parts.push("TRIM(LOWER(CAA.AgentSupervisor)) = TRIM(LOWER(@supervisor))");
  if (filters.callType) parts.push("LOWER(LTRIM(RTRIM(CAA.CallType))) = @callType");
  if (filters.agent) parts.push("CAA.AgentName = @agent");
  if (filters.leadClassification) {
    parts.push("LOWER(LTRIM(RTRIM(CAA.AI_Lead_Classification))) = @leadClassification");
  }
  return parts;
}

function metaFor(claims) {
  if (claims.kind === "tone") {
    const [role, bucket] = String(claims.key).split("-");
    const roleLabel = role === "agent" ? "Agent" : "Customer";
    const bucketLabel = bucket.charAt(0).toUpperCase() + bucket.slice(1);
    return {
      title: `${roleLabel} tone: ${bucketLabel}`,
      description: `Calls classified as ${bucketLabel.toLowerCase()} for the ${roleLabel.toLowerCase()} in the selected dashboard scope.`,
    };
  }
  if (claims.key === "disposition") {
    return { title: `Disposition: ${claims.value}`, description: "Calls with this exact AI collections disposition." };
  }
  if (claims.key === "campaign") {
    return { title: `Campaign: ${claims.value}`, description: "Calls with this exact AI-inferred campaign." };
  }
  if (claims.key === "disposition-other") {
    return { title: "Other dispositions", description: "Calls in the less frequent disposition categories grouped by the dashboard." };
  }
  if (claims.key === "campaign-other") {
    return { title: "Other campaigns", description: "Calls in the less frequent campaign categories grouped by the dashboard." };
  }
  if (claims.kind === "insight" && claims.key === "query-type") {
    return {
      title: `Call outcome: ${claims.value}`,
      description: "Calls assigned to this exact primary AI call-outcome category.",
    };
  }
  if (claims.kind === "insight" && claims.key === "escalation-category") {
    return {
      title: `Escalation category: ${claims.value}`,
      description: "Calls assigned to this exact escalation category.",
    };
  }
  const [title, description] = STATIC_META[`${claims.kind}:${claims.key}`] || ["Matching calls", "Calls matching the selected dashboard category."];
  return { title, description };
}

function clampPositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function normalizeListOptions(raw = {}) {
  const requestedSort = safeString(raw.sort, 30) || "callDate";
  const allowedSort = new Set(["callDate", "callId", "agent", "aiScore", "duration"]);
  return {
    page: clampPositiveInt(raw.page, 1, 1000000),
    pageSize: clampPositiveInt(raw.pageSize, 25, MAX_PAGE_SIZE),
    search: safeString(raw.search, 100),
    sort: allowedSort.has(requestedSort) ? requestedSort : "callDate",
    direction: String(raw.direction || "desc").toLowerCase() === "asc" ? "ASC" : "DESC",
  };
}

async function fetchPage(pool, sql, claims, rawOptions = {}) {
  const options = normalizeListOptions(rawOptions);
  const request = bindFilters(pool.request(), claims.filters, sql);
  request.input("offset", sql.Int, (options.page - 1) * options.pageSize);
  request.input("pageSize", sql.Int, options.pageSize);
  if (options.search) request.input("search", sql.NVarChar, `%${options.search}%`);

  const isTone = claims.kind === "tone";
  const isOperational = claims.kind === "operational" || isTone;
  const isInsight = claims.kind === "insight";
  const variant = claims.sourceVariant === "fallback" ? "fallback" : "full";
  const fromSql = isTone
    ? `FROM dbo.AudioUploads AU
       INNER JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
       INNER JOIN dbo.Consolidated_Audio_Analysis CAA ON AU.AudioFileName = CAA.AudioFileName
       LEFT JOIN dbo.Agents AG ON AU.SelectedAgent = AG.agent_name`
    : isOperational
    ? `FROM dbo.AudioUploads AU
       LEFT JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
       ${variant === "fallback" ? "" : "LEFT JOIN dbo.Consolidated_Audio_Analysis CAA ON AU.AudioFileName = CAA.AudioFileName"}
       LEFT JOIN dbo.Agents AG ON AU.SelectedAgent = AG.agent_name`
    : "FROM dbo.Consolidated_Audio_Analysis CAA";

  const filterParts = isTone
    ? toneFilterSql(claims.filters)
    : isOperational
    ? operationalFilterSql(claims.filters, variant)
    : isInsight
    ? insightFilterSql(claims.filters)
    : collectionsFilterSql(claims.filters);
  filterParts.push(isTone
    ? `${operationalPredicate("success", "full")} AND ${tonePredicate(claims, request, sql)}`
    : isOperational
    ? operationalPredicate(claims.key, variant)
    : isInsight
    ? insightPredicate(claims, request, sql)
    : collectionsPredicate(claims, request, sql));
  const baseWhereSql = `WHERE ${filterParts.join(" AND ")}`;
  const searchSql = !options.search
    ? ""
    : isOperational
      ? " AND (AU.AudioFileName LIKE @search OR AU.SelectedAgent LIKE @search OR CONVERT(NVARCHAR(30), AU.UploadID) LIKE @search)"
      : " AND (CAA.AudioFileName LIKE @search OR CAA.AgentName LIKE @search OR CONVERT(NVARCHAR(30), CAA.UploadID) LIKE @search)";
  const whereSql = `${baseWhereSql}${searchSql}`;

  const sortMap = isOperational
    ? {
        callDate: "COALESCE(AU.SelectedCallDate, AU.UploadDate)",
        callId: "AU.UploadID",
        agent: "AU.SelectedAgent",
        aiScore: variant === "fallback" ? "TRY_CAST(APR.AIScoring AS DECIMAL(10,2))" : "TRY_CAST(CAA.AI_Overall_Scoring AS DECIMAL(10,2))",
        duration: variant === "fallback" ? "TRY_CONVERT(TIME, APR.AudioDuration)" : "TRY_CONVERT(TIME, COALESCE(CAA.AudioDuration, APR.AudioDuration))",
      }
    : {
        callDate: "COALESCE(CAA.SelectedCallDate, CAA.UploadDate)",
        callId: "CAA.UploadID",
        agent: "CAA.AgentName",
        aiScore: isInsight
          ? "TRY_CAST(CAA.AI_Overall_Scoring AS DECIMAL(10,2))"
          : "TRY_CAST(CAA.AI_Coll_Score AS DECIMAL(10,2))",
        duration: "TRY_CONVERT(TIME, CAA.AudioDuration)",
      };

  const selectSql = isOperational
    ? `SELECT
         AU.UploadID AS callId,
         AU.AudioFileName AS audioFileName,
         COALESCE(AU.SelectedCallDate, AU.UploadDate) AS callDate,
         AU.UploadDate AS uploadDate,
         AU.SelectedAgent AS agentName,
         ${variant === "fallback" ? "AG.agent_location" : "COALESCE(CAA.AgentLocation, AG.agent_location)"} AS location,
         ${variant === "fallback" ? "AG.supervisor" : "COALESCE(CAA.AgentSupervisor, AG.supervisor)"} AS supervisor,
         AU.CallType AS callType,
         AU.ProcessStatus AS processStatus,
         APR.Status AS aiStatus,
         ${variant === "fallback" ? "TRY_CAST(APR.AIScoring AS DECIMAL(10,2))" : "TRY_CAST(CAA.AI_Overall_Scoring AS DECIMAL(10,2))"} AS aiScore,
         ${variant === "fallback" ? "APR.AudioDuration" : "COALESCE(CAA.AudioDuration, APR.AudioDuration)"} AS audioDuration,
         ${variant === "fallback" ? "CAST(NULL AS FLOAT)" : "CAA.AI_Coll_Score"} AS collectionsScore,
         ${variant === "fallback" ? "CAST(NULL AS NVARCHAR(60))" : "CAA.AI_Coll_Disposition"} AS disposition,
         ${variant === "fallback" ? "CAST(NULL AS NVARCHAR(20))" : "CAA.AI_Coll_Campaign"} AS campaign,
         ${variant === "fallback" ? "CAST(NULL AS NVARCHAR(300))" : "CAA.AI_Coll_Fatal_Reason"} AS fatalReason,
         ${variant === "fallback" ? "CAST(NULL AS NVARCHAR(MAX))" : "CAA.AI_ZTP_Evidence"} AS ztpEvidence,
         ${variant === "fallback" ? "CAST(NULL AS FLOAT)" : "CAA.AI_PTP_Amount"} AS ptpAmount,
         ${variant === "fallback" ? "CAST(NULL AS NVARCHAR(50))" : "CAA.AI_PTP_Date"} AS ptpDate`
    : `SELECT
         CAA.UploadID AS callId,
         CAA.AudioFileName AS audioFileName,
         COALESCE(CAA.SelectedCallDate, CAA.UploadDate) AS callDate,
         CAA.UploadDate AS uploadDate,
         CAA.AgentName AS agentName,
         CAA.AgentLocation AS location,
         CAA.AgentSupervisor AS supervisor,
         CAA.CallType AS callType,
         CAA.Status AS processStatus,
         CAA.Status AS aiStatus,
         TRY_CAST(CAA.AI_Overall_Scoring AS DECIMAL(10,2)) AS aiScore,
         CAA.AudioDuration AS audioDuration,
         CAA.AI_Coll_Score AS collectionsScore,
         CAA.AI_Coll_Disposition AS disposition,
         CAA.AI_Coll_Campaign AS campaign,
         CAA.AI_Coll_Fatal_Reason AS fatalReason,
         CAA.AI_ZTP_Evidence AS ztpEvidence,
         CAA.AI_PTP_Amount AS ptpAmount,
         CAA.AI_PTP_Date AS ptpDate,
         CAA.AI_Primary_Query_Type AS queryType,
         CAA.AI_Hold_Detected AS holdDetected,
         TRY_CAST(CAA.AI_Hold_Count AS INT) AS holdCount,
         TRY_CAST(CAA.AI_Hold_Total_Sec AS FLOAT) AS holdTotalSec,
         TRY_CAST(CAA.AI_Hold_Longest_Sec AS FLOAT) AS holdLongestSec,
         CAA.AI_Escalation_Requested AS escalationRequested,
         CAA.AI_Escalation_Actioned AS escalationActioned,
         CAA.AI_Escalation_Category AS escalationCategory,
         CAA.AI_CSAT_Transferred AS csatTransferred`;

  const query = `
    SELECT COUNT_BIG(1) AS total ${fromSql} ${baseWhereSql};
    SELECT COUNT_BIG(1) AS total ${fromSql} ${whereSql};
    ${selectSql}
    ${fromSql}
    ${whereSql}
    ORDER BY ${sortMap[options.sort]} ${options.direction}, ${isOperational ? "AU.UploadID" : "CAA.UploadID"} DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
  `;
  const result = await request.query(query);
  const currentCount = Number(result.recordsets?.[0]?.[0]?.total) || 0;
  const total = Number(result.recordsets?.[1]?.[0]?.total) || 0;
  const rows = result.recordsets?.[2] || [];
  const { title, description } = metaFor(claims);
  return {
    success: true,
    title,
    description,
    category: { kind: claims.kind, key: claims.key, value: claims.value || null },
    filters: claims.filters,
    expectedCount: Math.max(0, Number(claims.expectedCount) || 0),
    currentCount,
    total,
    countChanged: currentCount !== Math.max(0, Number(claims.expectedCount) || 0),
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.max(1, Math.ceil(total / options.pageSize)),
    sort: options.sort,
    direction: options.direction.toLowerCase(),
    rows,
  };
}

async function currentTenantKey(pool) {
  try {
    const result = await pool.request().query("SELECT DB_NAME() AS tenantDb");
    return safeString(result.recordset?.[0]?.tenantDb, 128)?.toLowerCase() || tenantKey(pool);
  } catch {
    return tenantKey(pool);
  }
}

module.exports = {
  TOKEN_TTL_SECONDS,
  normalizeFilters,
  normalizeListOptions,
  operationalPredicate,
  tonePredicate,
  insightPredicate,
  issueToken,
  verifyToken,
  tenantKey,
  currentTenantKey,
  fetchPage,
};
