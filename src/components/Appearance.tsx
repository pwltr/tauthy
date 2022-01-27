import { useEffect, useState, useContext } from "react";
import Switch from "@mui/material/Switch";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";

import {
  AppBarTitleContext,
  ThemeContext,
  ListOptionsContext,
} from "~/context";
import { capitalize } from "~/utils";
import ThemeModal from "~/components/Theme";
import LanguageModal from "~/components/Language";
import ListItem from "~/components/ListItem";

const Appearance = () => {
  const { setAppBarTitle } = useContext(AppBarTitleContext);
  const { theme } = useContext(ThemeContext);
  const { dense, groupByTwos, setListOptions } = useContext(ListOptionsContext);
  const [openThemeModal, setOpenThemeModal] = useState(false);
  const [openLanguageModal, setOpenLanguageModal] = useState(false);

  const handleOpenThemeModal = () => setOpenThemeModal(true);
  const handleCloseThemeModal = () => setOpenThemeModal(false);
  const handleOpenLanguageModal = () => setOpenLanguageModal(true);
  const handleCloseLanguageModal = () => setOpenLanguageModal(false);

  useEffect(() => {
    setAppBarTitle("Appearance");
  }, []);

  return (
    <>
      <List>
        <ListSubheader>App</ListSubheader>
        <ListItem disablePadding onClick={handleOpenThemeModal}>
          <ListItemButton>
            <ListItemText primary="Theme" secondary={capitalize(theme)} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={handleOpenLanguageModal}>
          <ListItemButton>
            <ListItemText primary="Language" secondary="System default" />
          </ListItemButton>
        </ListItem>

        <ListSubheader>Entries</ListSubheader>
        <ListItem
          disablePadding
          onClick={() => setListOptions({ dense: !dense, groupByTwos })}
          secondaryAction={<Switch checked={dense} />}
        >
          <ListItemButton>
            <ListItemText primary="Compact" />
          </ListItemButton>
        </ListItem>

        <ListItem
          disablePadding
          onClick={() => setListOptions({ dense, groupByTwos: !groupByTwos })}
          secondaryAction={<Switch checked={groupByTwos} />}
        >
          <ListItemButton>
            <ListItemText primary="Code grouping" />
          </ListItemButton>
        </ListItem>

        <ListItem
          disablePadding
          onClick={() => setListOptions({ dense: !dense, groupByTwos })}
        >
          <ListItemButton>
            <ListItemText primary="Edit groups" />
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

export default Appearance;
