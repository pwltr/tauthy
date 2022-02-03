import { useRef, useEffect, useContext, useState } from "react";
import toast from "react-hot-toast";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Modal from "@mui/material/Modal";
import Box from "@mui/material/Box";

import { importCodes, ImportFormat } from "~/utils";
import { AppBarTitleContext } from "~/context";
import ListItem from "~/components/ListItem";

const style = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "90%",
  bgcolor: "background.paper",
  boxShadow: 24,
  color: "primary.main",
  py: 2,
};

const ImportModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<ImportFormat>();

  useEffect(() => {
    setAppBarTitle("Select import");
  }, []);

  const handleClick = (format: ImportFormat) => {
    setFormat(format);
    inputRef.current?.click();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-labelledby="modal-modal-title"
      aria-describedby="modal-modal-description"
    >
      <>
        <input
          ref={inputRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={async (event) => {
            if (format) {
              await importCodes(event, format);
              toast.success("Vault imported");
              onClose();
            }
          }}
        />

        <Box sx={style}>
          <List>
            <ListItem disablePadding onClick={() => handleClick("aegis")}>
              <ListItemButton>
                <ListItemText primary="Aegis" />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding onClick={() => handleClick("authy")}>
              <ListItemButton>
                <ListItemText primary="Authy" />
              </ListItemButton>
            </ListItem>

            {/* <ListItem disablePadding onClick={() => handleClick("google")}>
              <ListItemButton>
                <ListItemText primary="Google Authenticator" />
              </ListItemButton>
            </ListItem> */}

            <ListItem disablePadding onClick={() => handleClick("tauthy")}>
              <ListItemButton>
                <ListItemText primary="Tauthy" />
              </ListItemButton>
            </ListItem>
          </List>
        </Box>
      </>
    </Modal>
  );
};

export default ImportModal;
