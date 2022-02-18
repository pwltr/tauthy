import { Stronghold, Location } from "tauri-plugin-stronghold-api";

const stronghold = new Stronghold("./vault.stronghold", "password");
const store = stronghold.getStore("storeVault", []);
const vault = stronghold.getVault("vault", []);
const location = Location.generic("vault", "record");

export const readStronghold = () => store.get(location);
export const removeStronghold = () => store.remove(location);
export const lockStronghold = () => stronghold.unload();

export const unlockStronghold = (password: string) => {
  stronghold.reload(password);
};

export async function saveStronghold(record: string) {
  await store.insert(location, record);
  await stronghold.save();
}

export const setupStronghold = async () => {
  const status = await stronghold.getStatus();
  console.log("stronghold status: ", status.snapshot.status);

  // check if we have a vault
  try {
    const currentVault = await readStronghold();
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
  console.log("vault", vault);
  console.log("location", location);
});
