import { ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/tauri";

export const generateTOTP = async (secretKey: string) => {
  try {
    return await invoke("make_totp", { argument: secretKey });
  } catch (err) {
    console.error("error from backend:", err);
  }
};

export const importCodes = (event: ChangeEvent<HTMLInputElement>) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (() => {
      return function (event) {
        try {
          // Aegis format
          // TODO: support other formats
          const json = JSON.parse(event.target?.result as string);
          localStorage.setItem("entries", JSON.stringify(json.db.entries));
          resolve(json);
        } catch (err) {
          console.error("error when trying to parse json:", err);
          reject(err);
        }
      };
    })();
    reader.onerror = reject;

    if (event.target.files && event.target.files[0]) {
      reader.readAsText(event.target.files[0]);
    }
  });
};

export const exportCodes = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    const entries = localStorage.getItem("entries");
    if (entries) {
      const entriesJSON = JSON.parse(entries);

      // Aegis format
      // TODO: support other formats
      const json = {
        version: 1,
        header: {
          slots: null,
          params: null,
        },
        db: {
          version: 2,
          entries: entriesJSON,
        },
      };

      const file = new Blob([JSON.stringify(json)], {
        type: "application/json",
      });
      const date = new Date(Date.now())
        .toLocaleDateString("en-US", {
          year: "2-digit",
          month: "2-digit",
          day: "2-digit",
        })
        .replace(/[^\w\s]/gi, "");

      const fileName = `tauthy_export_${date}.json`;
      downloadFile(file, fileName);
      resolve("Vault exported");
    } else {
      reject("Nothing to export");
    }
  });
};

export const downloadFile = (file: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
