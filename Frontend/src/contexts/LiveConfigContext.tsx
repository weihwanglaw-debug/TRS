/**
 * LiveConfigContext.tsx
 *
 * On mount: calls apiGetConfig() to hydrate from real backend (or mock).
 * update(): calls apiUpdateConfig() to persist immediately, then updates local state.
 *
 * Mock:  configApi.ts reads config.json + writes to in-memory _config
 * Real:  swap configApi.ts function bodies to fetch() - no changes needed here
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiGetConfig, apiUpdateConfig } from "@/lib/api";

export interface LiveConfig {
  appName:       string;
  logoUrl:       string;
  logoLightUrl:  string;
  logoDarkUrl:   string;
  heroTitle:     string;
  heroSubtitle:  string;
  heroImageUrl:  string;
  currency:      string;
  contactEmail:  string;
  copyrightText: string;
  consentText:   string;
  messageTitle:  string;
  messageBody:   string;
  // Ad banner
  adEnabled:     string;
  adUrl:         string;
  adImageUrl:    string;
  adTag:         string;
  adTitle:       string;
  adBody:        string;
  adButtonLabel: string;
}

interface LiveConfigState {
  cfg:     LiveConfig;
  loading: boolean;
  update:  (key: keyof LiveConfig, value: string) => Promise<void>;
}

const EMPTY: LiveConfig = {
  appName: "",
  logoUrl: "",
  logoLightUrl: "/images/app/logo_light_mode.png",
  logoDarkUrl: "/images/app/logo_dark_mode.png",
  heroTitle: "",
  heroSubtitle: "",
  heroImageUrl: "", currency: "SGD", contactEmail: "",
  copyrightText: "", consentText: "",
  messageTitle: "Questions before joining?",
  messageBody: "Players, parents, coaches, and club representatives can leave a message for the tournament team.\nUse this space for event questions, program clarification, venue help, or registration support.",
  adEnabled: "true", adUrl: "", adImageUrl: "",
  adTag: "", adTitle: "", adBody: "", adButtonLabel: "Learn More",
};

const LiveConfigContext = createContext<LiveConfigState>({
  cfg: EMPTY, loading: true, update: async () => {},
});

export const useLiveConfig = () => useContext(LiveConfigContext);

export const LiveConfigProvider = ({ children }: { children: ReactNode }) => {
  const [cfg,     setCfg]     = useState<LiveConfig>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGetConfig().then(r => {
      if (r.data) setCfg({ ...EMPTY, ...r.data });
    }).finally(() => setLoading(false));
  }, []);

  const update = async (key: keyof LiveConfig, value: string) => {
    const r = await apiUpdateConfig({ [key]: value });
    if (r.data) setCfg({ ...EMPTY, ...r.data });
    else setCfg(prev => ({ ...prev, [key]: value }));
  };

  return (
    <LiveConfigContext.Provider value={{ cfg, loading, update }}>
      {children}
    </LiveConfigContext.Provider>
  );
};
