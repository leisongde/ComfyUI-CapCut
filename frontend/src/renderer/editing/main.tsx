import { createRoot } from 'react-dom/client'
import App, { EditorErrorBoundary } from './ComfyApp'
import './styles.css'

createRoot(document.getElementById('editing-root')!).render(
  <EditorErrorBoundary>
    <App />
  </EditorErrorBoundary>
)
