/**
 * Help Page Component
 */

import React from 'react';
import { LuMail } from '../icons';
import { Button } from './ui';
import PageSection from './ui/PageSection';

const HelpPage = () => (
  <div className="app-page reports-page">
    <PageSection title="Audio Upload Guidelines">
      <ol style={{ color: 'var(--text)', lineHeight: '1.9', paddingLeft: '1.5rem', fontSize: '0.95rem' }}>
        <li>Click on the "Choose File" button on the Upload page.</li>
        <li>Select an audio file from your device.</li>
        <li>Ensure that the file size does not exceed <strong>15 MB</strong>.</li>
        <li>Select the call date using the date picker provided.</li>
        <li>Choose the type of call: <strong>Inbound</strong> or <strong>Outbound</strong>.</li>
        <li>Pick an agent from the dropdown list.</li>
        <li>Once all fields are filled, click on the <strong>"Submit for AI Analysis"</strong> button.</li>
        <li>Wait for the upload process to complete. A confirmation message will appear on success.</li>
        <li>Contact support if you face persistent issues while uploading.</li>
      </ol>
    </PageSection>

    <PageSection title="Need Help?">
      <p style={{ color: 'var(--accent)', fontWeight: 600, textAlign: 'center', marginBottom: '1rem' }}>
        For more assistance, please contact our support team:
      </p>
      <div style={{ textAlign: 'center' }}>
        <Button
          variant="secondary"
          onClick={() => { window.location.href = 'mailto:support@gmail.com'; }}
          aria-label="Email Support"
        >
          <LuMail /> support@gmail.com
        </Button>
      </div>
    </PageSection>
  </div>
);

export default HelpPage;
