"use client"

import { createContext, useContext } from "react"

import type { AccessSession } from "@/lib/access-types"

const AccessContext = createContext<AccessSession | null>(null)

export function AccessProvider({ session, children }: { session: AccessSession; children: React.ReactNode }) {
  return <AccessContext.Provider value={session}>{children}</AccessContext.Provider>
}

export function useAccessSession() {
  const session = useContext(AccessContext)
  if (!session) throw new Error("Access session is unavailable.")
  return session
}
