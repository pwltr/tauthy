import { ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/tauri";

import { readStronghold, saveStronghold } from "~/utils";

export type ImportFormat = "aegis" | "authy" | "google" | "tauthy";

export const generateTOTP = async (secret: string) => {
  try {
    return await invoke("generate_totp", { argument: secret });
  } catch (err) {
    console.error("error from backend:", err);
  }
};

export const importCodes = (
  event: ChangeEvent<HTMLInputElement>,
  format: ImportFormat
) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (() => {
      return async function (event) {
        try {
          const currentVault = await readStronghold();
          const json = JSON.parse(event.target?.result as string);

          let entries;

          if (format === "aegis") {
            const importedEntries = json.db.entries;
            entries = importedEntries.map((entry: any) => ({
              uuid: entry.uuid,
              name: entry.name,
              group: entry.group,
              // issuer: entry.issuer,
              secret: entry.info.secret,
              icon: entry.icon,
            }));
          }

          const array = new Uint32Array(10);
          crypto.getRandomValues(array);

          if (format === "authy") {
            const importedEntries = json;
            entries = importedEntries.map((entry: any) => ({
              uuid: crypto.randomUUID(),
              name: entry.name,
              secret: entry.secret,
            }));
          }

          // if (format === "google") {
          //   entries = json;
          // }

          if (format === "tauthy") {
            const importedEntries = json;
            entries = importedEntries.map((entry: any) => ({
              uuid: entry.uuid,
              name: entry.name,
              group: entry.group,
              secret: entry.secret,
              icon: entry.icon,
            }));
          }

          const vault = currentVault
            ? [...JSON.parse(currentVault), ...entries]
            : entries;

          if (entries) {
            saveStronghold(JSON.stringify(vault));
            resolve(json);
          } else {
            console.error("no entries found");
            reject("no entries found");
          }
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
  return new Promise(async (resolve, reject) => {
    const entries = await readStronghold();

    if (entries) {
      const entriesJSON = JSON.parse(entries);

      const file = new Blob([JSON.stringify(entriesJSON)], {
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

export const capitalize = (word: string) => {
  return word.charAt(0).toUpperCase() + word.slice(1);
};
