import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts (air-gap safe — bundled locally, no CDN)
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/dm-sans/800.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/700.css';
import './index.css';
import './components/reports/reports-page.css';
import './components/reports/reports-layout.css';
import './theme/animations.css';
import './app-redesign.css';
import { applyChartDefaults } from './theme/chartTheme';
import App from './App';
import { ThemeProvider } from './theme/ThemeProvider';

applyChartDefaults();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
