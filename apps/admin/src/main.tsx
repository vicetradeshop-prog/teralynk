import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminApp from './App';
import '@teralynk/ui-styles/design-system.css';
import '@teralynk/ui-styles/components.css';
import '@teralynk/ui-styles/layout.css';
import '@teralynk/ui-styles/boot.css';
import './styles/admin.css';


class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return React.createElement(
        'pre',
        { style: { color: '#f87171', padding: 24, fontFamily: 'monospace', whiteSpace: 'pre-wrap', userSelect: 'text' } },
        'Erreur d\'interface détectée :\n' + (this.state.error.stack ?? String(this.state.error))
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary><AdminApp /></ErrorBoundary>
  </React.StrictMode>
);
