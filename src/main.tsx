import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/space-grotesk';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import * as state from './state';
import { TEMPLATES } from './model/templates';
import { newModule } from './model/library';

// dev-only handle for scripted checks and screenshots
if (import.meta.env.DEV) (window as any).__bd = { ...state, TEMPLATES, newModule };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
