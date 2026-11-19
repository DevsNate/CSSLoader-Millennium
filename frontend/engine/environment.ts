// What the backend says about this install.

export type Environment = {
  themesPath: string;
  steamBeta: boolean;
  cssLoaderVersion: number;
  flags: Record<string, boolean>;
};

export let environment: Environment = { themesPath: '', steamBeta: false, cssLoaderVersion: 9, flags: {} };

export async function loadEnvironment(): Promise<Environment> {
  const env = await backend.get_environment();
  environment = {
    themesPath: env.themes_path,
    steamBeta: env.steam_beta,
    cssLoaderVersion: env.css_loader_version,
    flags: (env.flags ?? {}) as Record<string, boolean>,
  };
  return environment;
}
