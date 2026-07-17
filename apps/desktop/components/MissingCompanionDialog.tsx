import { useEffect, useState } from "react";
import {
  checkIfCompanionInstalled,
  checkIfCompanionRuntimeReady,
  restartBackend,
  sleep,
} from "../backend";
import { AlertDialog } from "./Primitives";

const COMPANION_RELEASE_URL =
  "https://github.com/DevsNate/CSSLoader-Companion-Millennium/releases/latest";

export function MissingCompanionDialog({ enabled }: { enabled: boolean }) {
  const [companionMissing, setCompanionMissing] = useState(false);
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [statusText, setStatusText] = useState("");

  useEffect(() => {
    if (!enabled) return;

    void checkIfCompanionInstalled()
      .then((installed) => setCompanionMissing(!installed))
      .catch(() => setCompanionMissing(false));
  }, [enabled]);

  async function finishCompanionSetup() {
    setStatus("checking");
    setStatusText("Checking for the companion plugin...");

    try {
      if (!(await checkIfCompanionInstalled())) {
        throw new Error(
          "The companion is still missing. Extract it into Millennium's plugins folder, then try again."
        );
      }

      setStatusText("Restarting the CSS Loader backend...");
      await restartBackend();

      setStatusText("Waiting for CSS Loader to publish your themes...");
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await checkIfCompanionRuntimeReady()) {
          setStatus("success");
          setStatusText("Setup is complete. Restart Steam to load the companion and your themes.");
          return;
        }
        await sleep(500);
      }

      throw new Error("The backend restarted, but the theme runtime was not generated in time.");
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Companion setup failed.");
    }
  }

  if (!companionMissing) return null;

  return (
    <AlertDialog
      defaultOpen
      title={status === "success" ? "CSS Loader Setup Complete" : "CSS Loader Companion Required"}
      description={
        <>
          {status === "success" ? (
            <p>{statusText}</p>
          ) : (
            <>
              <p>
                The desktop app and backend are installed, but the CSS Loader Companion plugin is
                missing from Millennium. Steam cannot display your CSS Loader themes until the
                companion is installed.
              </p>
              <p className="mt-3">
                Download the companion and extract it into Millennium&apos;s plugins folder. Then
                select Check Again so CSS Loader can restart its backend and publish your themes.
              </p>
              {statusText && (
                <p className={`mt-3 ${status === "error" ? "text-red-400" : "text-fore-9-dark"}`}>
                  {statusText}
                </p>
              )}
            </>
          )}
        </>
      }
      dontClose
      Footer={
        status !== "success" ? (
          <button
            className="font-fancy my-2 rounded-2xl p-2 px-6 transition-all"
            onClick={async () => {
              const { open } = await import("@tauri-apps/api/shell");
              await open(COMPANION_RELEASE_URL);
            }}
          >
            Download Companion
          </button>
        ) : null
      }
      actionText={status === "checking" ? "Checking..." : status === "success" ? "Done" : "Check Again"}
      actionDisabled={status === "checking"}
      dontCloseOnAction
      onAction={() => {
        if (status === "success") {
          setCompanionMissing(false);
        } else {
          void finishCompanionSetup();
        }
      }}
    />
  );
}
