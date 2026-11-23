import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { SessionProvider } from './session';
import { SiteProvider } from './site';
import { ConfirmProvider, ToastProvider } from './ui';
import '@fontsource-variable/nunito-sans/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/kit.css';
import './styles/shell.css';
import './styles/screens.css';
import './styles/screens-people.css';
import './styles/screens-activities.css';
import './styles/screens-settings.css';
import './styles/screens-admin.css';
import './styles/screens-lanyards.css';
import './styles/ui-people.css';
import './styles/ui-lanyards.css';
import './styles/ui-programme.css';
import './styles/ui-event.css';
import './styles/ui-platform.css';
import './styles/screens-participant.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SiteProvider>
        <SessionProvider>
          <ToastProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </SessionProvider>
      </SiteProvider>
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js');
}
