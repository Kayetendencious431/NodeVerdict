import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './shared/components'
import './index.css'

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)