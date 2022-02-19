import { useEffect, useState, useContext } from "react";
import Switch from "@mui/material/Switch";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListSubheader from "@mui/material/ListSubheader";
import DraftsIcon from "@mui/icons-material/Drafts";

import ThemeModal from "~/components/Theme";
import LanguageModal from "~/components/Language";

import { AppBarTitleContext } from "~/context";
import ListItem from "~/components/ListItem";

const About = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const [openThemeModal, setOpenThemeModal] = useState(false);
  const [openLanguageModal, setOpenLanguageModal] = useState(false);

  const handleOpenThemeModal = () => setOpenThemeModal(true);
  const handleCloseThemeModal = () => setOpenThemeModal(false);
  const handleOpenLanguageModal = () => setOpenLanguageModal(true);
  const handleCloseLanguageModal = () => setOpenLanguageModal(false);

  useEffect(() => {
    setAppBarTitle("About");
  }, []);

  return (
    <>
      <List dense>
        <ListItem onClick={handleOpenThemeModal}>
          <ListItemButton>
            <ListItemIcon>
              <DraftsIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Tauthy" />
          </ListItemButton>
        </ListItem>
        <ListItem disablePadding onClick={handleOpenThemeModal}>
          <ListItemButton>
            <ListItemIcon>
              <DraftsIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="Version" secondary="0.1.0" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={handleOpenLanguageModal}>
          <ListItemButton>
            <ListItemIcon>
              <DraftsIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="License" secondary="GPL-3.0 License" />
          </ListItemButton>
        </ListItem>

        <ListSubheader>Team</ListSubheader>
        <ListItem disablePadding>
          <ListItemButton>
            <ListItemIcon>
              <DraftsIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="GitHub" />
          </ListItemButton>
        </ListItem>

        <ListSubheader>Support</ListSubheader>
        <ListItem disablePadding>
          <ListItemButton>
            <ListItemIcon>
              <DraftsIcon color="primary" />
            </ListItemIcon>
            <ListItemText primary="GitHub" />
          </ListItemButton>
        </ListItem>
      </List>

      <ThemeModal open={openThemeModal} onClose={handleCloseThemeModal} />
      <LanguageModal
        open={openLanguageModal}
        onClose={handleCloseLanguageModal}
      />
    </>
  );
};

export default About;
