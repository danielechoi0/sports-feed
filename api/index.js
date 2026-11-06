// Vercel serverless entry point. vercel.json rewrites every /api/* request
// here; `serve` routes on the original req.url exactly as the local server
// does. Static files in public/ are served by Vercel's CDN and never reach
// this function. Importing server.js does not start a listener or the live
// loop (it only does that when run directly).
import { serve } from '../server.js';

export default function handler(req, res) {
  return serve(req, res);
}
