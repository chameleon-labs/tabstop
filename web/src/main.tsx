import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { App } from './app'
import { makeQueryClient } from './api/query-client'
import { routes } from './routes'
import './styles.css'

const container = document.getElementById('root')
if (container === null) throw new Error('#root is missing from index.html')

/**
 * Built OUT HERE, above the render, and that placement is load-bearing.
 *
 * `createBrowserRouter` subscribes to browser history the moment it is called.
 * Anywhere inside the `StrictMode` subtree - component body or `useState`
 * initialiser, both are double-invoked in development - that means two routers
 * listening and one abandoned. Constructed once at the entry point, there is
 * exactly one for the life of the page.
 */
const router = createBrowserRouter(routes)

createRoot(container).render(
  <StrictMode>
    <App queryClient={makeQueryClient()} router={router} />
  </StrictMode>
)
