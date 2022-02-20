import { Stronghold, Location } from "tauri-plugin-stronghold-api";

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
  // TODO: can we lock the stronghold somehow?
  return;
};

export const unlockVault = (passwd: string) => stronghold.reload(passwd);

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
  console.log("status change", status);
  console.log("stronghold", stronghold);
  console.log("store", store);
  console.log("location", location);
});
