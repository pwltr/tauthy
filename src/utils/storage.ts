import {
  Stronghold,
  Location,
  setPasswordClearInterval,
} from "tauri-plugin-stronghold-api";

const stronghold = new Stronghold("./vault.stronghold", "password");
const store = stronghold.getStore("vault", []);
const location = Location.generic("vault", "record");

export const getVault = () => store.get(location);
export const getStatus = () => stronghold.getStatus();

export const saveVault = async (record: string) => {
  await store.insert(location, record);
  await stronghold.save();
};

export const deleteVault = async () => {
  // NOTE: just reset to initial state
  await store.insert(location, "[]");
  await stronghold.save();
};

export const lockVault = async () => {
  console.log("locking vault...");
  await setPasswordClearInterval({ secs: 1, nanos: 0 });
};

export const unlockVault = async (passwd: string) => {
  stronghold.reload(passwd);
  // NOTE: never lock automatically
  await setPasswordClearInterval({ secs: 0, nanos: 0 });
};

export const setupVault = async () => {
  // check if we have a vault
  try {
    const currentVault = await getVault();
    // console.log("found existing vault");
    console.log("found existing vault", currentVault);
  } catch (err) {
    console.log("no vault found. initializing...");
    // if not initialize with empty array
    await store.insert(location, "[]");
    await stronghold.save();
  }
};

stronghold.onStatusChange((status) => {
  console.info("Stronghold status changed: ", status);
});
