import { setupApp } from './config/app.js'
import { env } from './config/env.js'

const app = setupApp()

app.listen(env.port, () => {
  console.log(`Server running at http://localhost:${env.port}`)
})
