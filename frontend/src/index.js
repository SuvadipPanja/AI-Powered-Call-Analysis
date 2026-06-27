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
import reportWebVitals from './reportWebVitals';
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

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
