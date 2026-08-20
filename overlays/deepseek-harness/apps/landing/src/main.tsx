/** Landing entry point: mounts the React root with the single download page. */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { DownloadPage } from './pages/download'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root mount point not found')

createRoot(container).render(
  <StrictMode>
    <App>
      <DownloadPage />
    </App>
  </StrictMode>,
)
