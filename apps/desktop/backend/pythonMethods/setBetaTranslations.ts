import { server } from "./server";

export interface BackendResult {
  success: boolean;
  message: string;
}

export function setBetaTranslations(enabled: boolean) {
  return server!.callPluginMethod<{ enabled: boolean }, BackendResult>(
    "set_beta_translations",
    { enabled }
  );
}
