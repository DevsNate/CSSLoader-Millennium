import "../styles/globals.css";
import type { AppProps } from "next/app";
import { Flags, Theme, ThemeError } from "../ThemeTypes";
import { useState, useEffect, useMemo } from "react";
import "react-toastify/dist/ReactToastify.css";
import {
  checkIfStandaloneBackendExists,
  dummyFunction,
  ensureInstallation,
  reloadBackend,
  startBackend,
  recursiveCheck,
  getInstalledThemes,
  getOS,
  generatePresetFromThemeNames,
  getLastLoadErrors,
  changePreset,
  getBackendVersion,
  restartBackend,
  takeRestartBackendRequest,
} from "../backend";
import { themeContext } from "@contexts/themeContext";
import { FontContext } from "@contexts/FontContext";
import { backendStatusContext } from "@contexts/backendStatusContext";
import { AppRoot } from "@components/AppRoot";
import DynamicTitleBar from "@components/Native/DynamicTitlebar";
import { AppFrame } from "@components/Native/AppFrame";
import { osContext } from "@contexts/osContext";

export default function App(AppProps: AppProps) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [errors, setErrors] = useState<ThemeError[]>([]);
  // This is now undefined before the initial check, that way things can use dummyResult !== undefined to see if the app has properly loaded
  const [dummyResult, setDummyResult] = useState<boolean | undefined>(undefined);
  const [backendExists, setBackendExists] = useState<boolean>(false);
  const [installationChecked, setInstallationChecked] = useState<boolean>(false);
  const [newBackendVersion, setNewBackend] = useState<string>("");
  const [showNewBackendPage, setShowNewBackend] = useState<boolean>(false);
  const [backendManifestVersion, setManifestVersion] = useState<number>(8);
  const [OS, setOS] = useState<string>("");
  const isWindows = useMemo(() => OS === "win32", [OS]);
  const [maximized, setMaximized] = useState<boolean>(false);
  const [fullscreen, setFullscreen] = useState<boolean>(false);

  const selectedPreset = useMemo(
    () => themes.find((e) => e.flags.includes(Flags.isPreset) && e.enabled),
    [themes]
  );

  useEffect(() => {
    let unsubscribeToWindowChanges: () => void;

    async function subscribeToWindowChanges() {
      // why did you use a ssr framework in an app
      const { appWindow } = await import("@tauri-apps/api/window");
      unsubscribeToWindowChanges = await appWindow.onResized(() => {
        appWindow.isMaximized().then(setMaximized);
        appWindow.isFullscreen().then(setFullscreen);
      });
    }

    subscribeToWindowChanges();

    // Backend initialization runs in the OS-dependent effect below so the
    // first Windows launch cannot skip startBackend while OS is still empty.
    getOS().then(setOS);

    return () => {
      unsubscribeToWindowChanges && unsubscribeToWindowChanges();
    };
  }, []);

  useEffect(() => {
    if (!OS) return;
    if (isWindows) {
      void initializeWindowsInstallation();
    } else {
      void recheckDummy();
    }
  }, [OS, isWindows]);

  async function initializeWindowsInstallation() {
    try {
      await ensureInstallation();
      if (await takeRestartBackendRequest()) {
        await restartBackend();
      }
    } catch {
      // The setup modal remains visible and exposes a retry with the full
      // error message. This commonly means Millennium has not been started
      // once yet and therefore has no config file.
    }
    await refreshBackendExists();
    setInstallationChecked(true);
    await recheckDummy();
  }

  async function recheckDummy() {
    recursiveCheck(
      dummyFuncTest,
      () => refreshThemes(true),
      () => isWindows && startBackend()
    );
  }

  async function refreshBackendExists() {
    if (!isWindows) return;
    const backendExists = await checkIfStandaloneBackendExists();
    setBackendExists(backendExists);
  }

  async function dummyFuncTest() {
    try {
      const data = await dummyFunction();
      if (!data || !data.success) throw new Error(undefined);
      setDummyResult(data.result);
      return true;
    } catch {
      setDummyResult(false);
      return false;
    }
  }

  async function refreshThemes(reset: boolean = false): Promise<Theme[] | undefined> {
    if (isWindows) await refreshBackendExists();
    await dummyFuncTest();
    const backendVer = await getBackendVersion();
    if (backendVer.success) {
      setManifestVersion(backendVer.result);
    }

    const data = reset ? await reloadBackend() : await getInstalledThemes();
    if (data) {
      setThemes(data.sort());
    }
    const errors = await getLastLoadErrors();
    if (errors) {
      setErrors(errors);
    }

    // Returning themes for preset thingy thingy
    return data?.sort();
  }

  return (
    <themeContext.Provider
      value={{ themes, setThemes, errors, setErrors, refreshThemes, selectedPreset }}
    >
      <backendStatusContext.Provider
        value={{
          dummyResult,
          backendExists,
          installationChecked,
          showNewBackendPage,
          newBackendVersion,
          recheckDummy,
          setNewBackend,
          setShowNewBackend,
          backendManifestVersion,
        }}
      >
        <osContext.Provider value={{ OS, isWindows, maximized, fullscreen }}>
          <FontContext>
            <AppFrame>
              <DynamicTitleBar />
              <AppRoot {...AppProps} />
            </AppFrame>
          </FontContext>
        </osContext.Provider>
      </backendStatusContext.Provider>
    </themeContext.Provider>
  );
}
