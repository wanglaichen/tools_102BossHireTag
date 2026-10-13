export type Role = "admin" | "user";

export type TrialStatus = "permanent" | "active" | "expired";

export type AuthUser = {
  id: string;
  username: string;
  displayName?: string;
  role: Role;
  source?: string;
  locked?: boolean;
  trialExpiresAt?: string | null;
  trialStatus?: TrialStatus;
  trialRemainingMs?: number | null;
  [key: string]: unknown;
};

export type RegistrationPolicy = {
  trialHours: number;
  defaultTrialHours: number;
};

export type Channel = {
  id: string;
  label?: string;
  name?: string;
  [key: string]: unknown;
};

export type Company = {
  id: string;
  company_name: string;
  company_full_name?: string;
  effect_status?: string;
  industry?: string;
  is_hunter?: string;
  is_outsourced?: string;
  is_interviewed?: string;
  note?: string;
  channel?: string;
  updated_at?: string;
  created_at?: string;
  [key: string]: unknown;
};

export type NamedListItem = {
  id: string;
  company_name: string;
  company_full_name?: string;
  reason?: string;
  channel?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type JobUpdate = {
  id: string;
  company_name: string;
  job_title: string;
  location?: string;
  job_summary?: string;
  salary_min?: number | string;
  salary_max?: number | string;
  channel?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type Summary = {
  company_count?: number;
  rejected_count?: number;
  hunter_count?: number;
  outsourced_count?: number;
  interviewed_count?: number;
  follow_up_count?: number;
  ignored_count?: number;
  blacklist_count?: number;
  job_update_count?: number;
  last_updated_at?: string;
  statuses?: string[];
  industries?: string[];
  settings?: {
    status_options?: string[];
    industry_options?: string[];
  };
  [key: string]: unknown;
};

export type FeatureId = "hire" | "ignored" | "blocklist" | "watchlist" | "jobUpdates";
