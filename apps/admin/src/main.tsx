import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminApp from './App';
import '@teralynk/ui-styles/design-system.css';
import '@teralynk/ui-styles/components.css';
import '@teralynk/ui-styles/layout.css';
import '@teralynk/ui-styles/boot.css';
import './styles/admin.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
