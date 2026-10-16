import { loginEntryResponse } from "@/lib/login-entry"

export async function GET(request: Request) {
  return loginEntryResponse(request, "admin")
}
