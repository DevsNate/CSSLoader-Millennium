import { Theme } from "ThemeTypes";
import { server } from "backend/pythonMethods";

export async function changePreset(themeName: string, _themeList: Theme[]) {
  // The backend applies the whole profile as one transaction and publishes one
  // Millennium build. This prevents a temporary zero-theme build from
  // triggering a Steam UI reload halfway through a profile change.
  return server!.callPluginMethod("change_preset", { name: themeName });
}
