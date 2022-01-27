import { useEffect, useContext, useRef } from "react";
import toast from "react-hot-toast";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";

import { AppBarTitleContext } from "~/context";
import { importCodes, exportCodes } from "~/utils";
import ListItem from "~/components/ListItem";

const Import = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAppBarTitle("Import & Export");
  }, []);

  return (
    <List>
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={async (event) => {
          await importCodes(event);
          toast.success("Vault imported");
        }}
      />

      <ListItem disablePadding onClick={() => inputRef.current?.click()}>
        <ListItemButton>
          <ListItemText
            primary="Import"
            secondary="Import backups from other apps."
          />
        </ListItemButton>
      </ListItem>

      <ListItem
        disablePadding
        onClick={async () => {
          try {
            const response = await exportCodes();
            toast.success(response);
          } catch (err) {
            console.error(err);
            toast.error("Nothing to export.");
          }
        }}
      >
        <ListItemButton>
          <ListItemText primary="Export" secondary="Backup your vault." />
        </ListItemButton>
      </ListItem>
    </List>
  );
};

export default Import;
