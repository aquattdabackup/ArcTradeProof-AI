/** Vercel Node Function. Static assets and SPA routing belong to the Vite deployment. */
import { createApp } from '../server/index.js'

export default createApp({ ...process.env, NODE_ENV: 'production' }, { serveStatic: false })
