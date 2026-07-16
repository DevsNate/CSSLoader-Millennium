import { useState } from "react";
import { downloadBackend } from "../backend/tauriMethods";
import { GenericInstallBackendModal } from "./GenericInstallBackendModal";

export function DownloadBackendPage({
  onboarding = false,
  hideWindow,
  backendVersion,
  onUpdateFinish,
}: {
  onboarding?: boolean;
  hideWindow?: any;
  backendVersion?: string;
  onUpdateFinish?: any;
}) {
  const [installProg, setInstallProg] = useState<number>(0);
  const [installText, setInstallText] = useState<string>("");
  async function installBackend() {
    setInstallProg(1);
    setInstallText("Installing CSS Loader components");
    try {
      await downloadBackend();
      setInstallProg(100);
      setInstallText("Install Complete");
      setTimeout(() => {
        onUpdateFinish();
      }, 1000);
    } catch (error) {
      setInstallProg(0);
      setInstallText(error instanceof Error ? error.message : "Backend installation failed");
    }
  }

  return (
    <>
      <GenericInstallBackendModal
        titleText={onboarding ? "Finish CSS Loader Setup" : "CSS Loader Update Available"}
        dontClose={installProg > 0 || onboarding}
        descriptionText={
          onboarding ? (
            <>
              <span>
                CSS Loader will create your theme library, install its backend and Millennium
                Companion, and generate the local overlay automatically. Keep your preferred
                Millennium theme selected; CSS Loader layers on top of it. No external CDP port or
                Steam developer mode is required.
              </span>
            </>
          ) : (
            "We recommend installing backend updates as soon as they're available in order to maintain compatibility with new themes."
          )
        }
        {...{ installProg, installText }}
        onAction={() => installBackend()}
        onCloseWindow={() => hideWindow()}
      />
    </>
  );
}
