import { loginEntryResponse } from "@/lib/login-entry"

export async function GET() {
  return loginEntryResponse("admin")
}
