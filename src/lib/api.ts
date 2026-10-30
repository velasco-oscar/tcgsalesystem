import { invoke, isTauri } from "@tauri-apps/api/core";

export interface StoreSettings {
  storeName: string;
  businessSector: string;
  currencyCode: string;
  timeZone: string;
}

export interface CurrencyOption {
  code: string;
  name: string;
  minorUnits: number;
}

export interface AppStatus {
  version: string;
  schemaVersion: number;
  settings: StoreSettings;
  currencies: CurrencyOption[];
  currencyLocked: boolean;
  timeZoneLocked: boolean;
}

export const desktopAvailable = isTauri();

export function getAppStatus(): Promise<AppStatus> {
  return invoke<AppStatus>("get_app_status");
}

export function saveStoreSettings(settings: StoreSettings): Promise<StoreSettings> {
  return invoke<StoreSettings>("save_store_settings", { settings });
}

