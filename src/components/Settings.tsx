import { useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListItemIcon from "@mui/material/ListItemIcon";
import DraftsIcon from "@mui/icons-material/Drafts";

import { AppBarTitleContext } from "~/context";
// import { ListContext } from '~/components/List'
import ListItem from "~/components/ListItem";

const Settings = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const navigate = useNavigate();

  useEffect(() => {
    setAppBarTitle("Settings");
  }, []);

  return (
    <List>
      <ListItem disablePadding onClick={() => navigate("/appearance")}>
        <ListItemButton>
          <ListItemIcon>
            <DraftsIcon color="primary" />
          </ListItemIcon>
          <ListItemText
            primary="Appearance"
            secondary="Change the theme or the density of entries."
          />
        </ListItemButton>
      </ListItem>

      <ListItem disablePadding onClick={() => navigate("/import")}>
        <ListItemButton>
          <ListItemIcon>
            <DraftsIcon color="primary" />
          </ListItemIcon>
          <ListItemText
            primary="Import & Export"
            secondary="Import backups or create exports of your vault."
          />
        </ListItemButton>
      </ListItem>
    </List>
  );
};

export default Settings;
