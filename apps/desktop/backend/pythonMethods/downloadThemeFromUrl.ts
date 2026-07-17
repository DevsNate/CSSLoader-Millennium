import { server } from "./server";
interface InstallResult {
  success: boolean;
  message: string;
}

export function downloadThemeFromUrl(themeId: string) {
  return server!.callPluginMethod<{ id: string; url: string }, InstallResult>(
    "download_theme_from_url",
    {
      id: themeId,
      url: "https://api.deckthemes.com/",
    }
  );
}
