"use client";

import { useEffect, useState } from "react";
import { DATA_PROVIDER_MODE } from "./config";
import { MockDataProvider } from "./providers/mock-data-provider";
import { SupabaseDataProvider } from "./providers/supabase-data-provider";
import type { AdminSession, ProviderSnapshot } from "./types";

const provider = DATA_PROVIDER_MODE === "supabase" ? new SupabaseDataProvider() : new MockDataProvider();

export const stateProvider = provider;
export const dataProvider = provider;

export function useEventData() {
  const [snapshot, setSnapshot] = useState<ProviderSnapshot>(() => provider.getSnapshot());

  useEffect(() => provider.subscribe(setSnapshot), []);

  return snapshot;
}

export function useEventState() {
  return useEventData().state;
}

export function useAdminSession() {
  const [session, setSession] = useState<AdminSession>(() => provider.getAdminSession());

  useEffect(() => provider.subscribeAdmin(setSession), []);

  return session;
}
