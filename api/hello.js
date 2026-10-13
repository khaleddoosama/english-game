// GET /api/hello  ->  { message }
// A tiny public endpoint: no account, no database, no AI quota.
import { json } from "./_lib/env.js";

export function GET() {
  return json(200, { message: "Hello from Word Hunter!" });
}
