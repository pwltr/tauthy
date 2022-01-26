import { useEffect, useContext } from "react";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Modal from "@mui/material/Modal";
import Box from "@mui/material/Box";

import { AppBarTitleContext, ColorModeContext } from "~/App";
import { PaletteMode } from "~/theme";
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

const Language = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const { setColorMode } = useContext(ColorModeContext);

  useEffect(() => {
    setAppBarTitle("Select theme");
  }, []);

  const handleClick = (mode: PaletteMode) => {
    // setColorMode(mode);
    // onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-labelledby="modal-modal-title"
      aria-describedby="modal-modal-description"
    >
      <Box sx={style}>
        <List>
          <ListItem disablePadding onClick={() => handleClick("light")}>
            <ListItemButton>
              <ListItemText primary="English" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding onClick={() => handleClick("dark")}>
            <ListItemButton>
              <ListItemText primary="German" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding onClick={() => handleClick("black")}>
            <ListItemButton>
              <ListItemText primary="Russian" />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
    </Modal>
  );
};

export default Language;
