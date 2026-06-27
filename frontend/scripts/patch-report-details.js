const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/components/ReportDetails.js');
let s = fs.readFileSync(filePath, 'utf8');

const markerStart = '<h2>Call volume & trends</h2>';
const markerEnd = '<h2><LuClipboardCheck style={{ marginRight: 8, verticalAlign: \'middle\' }} />Manual Audit Activity</h2>';

const startIdx = s.indexOf(markerStart);
const endIdx = s.lastIndexOf('No manual audits found for the selected date range and filters.');

if (startIdx < 0 || endIdx < 0) {
  console.error('Could not find markers', startIdx, endIdx);
  process.exit(1);
}

// Walk back to section start
let sectionStart = s.lastIndexOf('<section className="reports-section">', startIdx);
// Walk forward to closing section after empty audit message
let sectionEnd = s.indexOf('</section>', endIdx) + '</section>'.length;

const replacement = `<ReportVolumeSection
            loading={loading}
            filters={filters}
            apiBaseUrl={API_BASE_URL}
            buildBulkExportBody={buildBulkExportBody}
            chartConfig={chartConfig}
            volumeSummary={volumeSummary}
            volumeTrendsData={volumeTrendsData}
            volumeChartRenderData={volumeChartRenderData}
            volumeTrendsRows={volumeTrendsRows}
            callVolumeByTimeData={callVolumeByTimeData}
            languagePreferencesData={languagePreferencesData}
            volumeChartRef={volumeChartRef}
            timeChartRef={timeChartRef}
            languageChartRef={languageChartRef}
            chartOptions={chartOptions}
          />

          <ReportQualitySection
            loading={loading}
            filters={filters}
            apiBaseUrl={API_BASE_URL}
            buildBulkExportBody={buildBulkExportBody}
            rubricChartData={rubricChartData}
            rubricRows={rubricRows}
            resolutionData={resolutionData}
            toneChartData={toneChartData}
            leadChartData={leadChartData}
            rubricChartRef={rubricChartRef}
            resolutionChartRef={resolutionChartRef}
            toneChartRef={toneChartRef}
            leadChartRef={leadChartRef}
            chartOptions={chartOptions}
          />

          <ReportIntentSection
            loading={loading}
            filters={filters}
            apiBaseUrl={API_BASE_URL}
            queryTypeData={queryTypeData}
            escalationData={escalationData}
            escalationDonut={escalationDonut}
            loanLeadData={loanLeadData}
            loanTypeDonut={loanTypeDonut}
            queryTypeChartRef={queryTypeChartRef}
            escalationChartRef={escalationChartRef}
            loanTypeChartRef={loanTypeChartRef}
            chartOptions={chartOptions}
          />

          <ReportAgentSection
            loading={loading}
            filters={filters}
            apiBaseUrl={API_BASE_URL}
            buildBulkExportBody={buildBulkExportBody}
            agentPerformanceData={agentPerformanceData}
            agentSummaryData={agentSummaryData}
            agentTableColumns={agentTableColumns}
            agentPerfChartRef={agentPerfChartRef}
            chartOptions={chartOptions}
          />

          <ReportAuditSection
            auditMetrics={auditMetrics}
            auditActivity={auditActivity}
            auditActivityLoading={auditActivityLoading}
            onAuditExport={handleAuditExport}
            formatAuditTimestamp={formatAuditTimestamp}
          />`;

s = s.slice(0, sectionStart) + replacement + s.slice(sectionEnd);
fs.writeFileSync(filePath, s);
console.log('Patched ReportDetails.js — lines:', s.split('\n').length);
