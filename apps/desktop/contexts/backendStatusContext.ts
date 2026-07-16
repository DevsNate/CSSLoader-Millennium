import { Dispatch, SetStateAction, createContext } from "react";

export const backendStatusContext = createContext<{
  dummyResult: boolean | undefined;
  backendExists: boolean;
  installationChecked: boolean;
  showNewBackendPage: boolean;
  newBackendVersion: string;
  recheckDummy: any;
  setNewBackend: Dispatch<SetStateAction<string>>;
  setShowNewBackend: Dispatch<SetStateAction<boolean>>;
  backendManifestVersion: number;
}>({
  dummyResult: undefined,
  showNewBackendPage: false,
  newBackendVersion: "",
  recheckDummy: () => {},
  backendExists: false,
  installationChecked: false,
  setNewBackend: () => {},
  setShowNewBackend: () => {},
  backendManifestVersion: 8,
});
