import { useEffect, useContext, useState } from "react";
import toast from "react-hot-toast";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";

import { AppBarTitleContext } from "~/context";
import { exportCodes, deleteVault } from "~/utils";
import ListItem from "~/components/ListItem";
import ImportModal from "~/components/modals/Import";

const Import = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenModal = () => setIsModalOpen(true);
  const handleCloseModal = () => setIsModalOpen(false);

  useEffect(() => {
    setAppBarTitle("Import & Export");
  }, []);

  return (
    <>
      <List>
        <ListItem disablePadding onClick={handleOpenModal}>
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

        <ListItem
          disablePadding
          onClick={() => {
            try {
              deleteVault();
              toast.success("Vault resetted.");
            } catch (err) {
              console.error(err);
              toast.error("An error occured");
            }
          }}
        >
          <ListItemButton>
            <ListItemText
              primary="Reset Vault"
              secondary="Delete your vault."
            />
          </ListItemButton>
        </ListItem>
      </List>

      <ImportModal open={isModalOpen} onClose={handleCloseModal} />
    </>
  );
};

export default Import;
