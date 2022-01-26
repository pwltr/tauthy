import { useContext } from "react";
import { clipboard } from "@tauri-apps/api";
import toast from "react-hot-toast";
import { Buffer } from "buffer";
import { styled } from "@mui/material/styles";
import Box from "@mui/material/Box";
import MuiList from "@mui/material/List";
import MuiListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Grid from "@mui/material/Grid";
import DescriptionIcon from "@mui/icons-material/Description";
import CopyIcon from "@mui/icons-material/ContentCopy";

import { ListDensityContext } from "~/App";
import type { Entry } from "~/components/Main";

const ListItem = styled(MuiListItem)(
  ({ theme }) => `
  cursor: pointer;
`
);

const Icon = styled("div")(
  ({ theme }) => `
  background: ${theme.palette.background.default};
  height: 40px;
  width: 40px;
`
);

const Name = styled("div")(
  ({ theme }) => `
  color: ${theme.palette.primary.main};
  font-size: 12px;
`
);

const Token = styled("div")(
  ({ theme }) => `
  color: ${theme.palette.primary.main};
  font-size: 20px;
  font-weight: 600;
`
);

type ListProps = {
  className?: string;
  entries: Entry[];
};

const List = ({ className, entries }: ListProps) => {
  const { dense } = useContext(ListDensityContext);

  return (
    <Box className={className} sx={{ flexGrow: 1, maxWidth: 752 }}>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <MuiList dense={dense}>
            {entries.map((entry) => (
              <ListItem
                key={entry.uuid}
                disablePadding
                // secondaryAction={
                //   <IconButton
                //     edge="end"
                //     aria-label="copy to clipboard"
                //     onClick={() => {
                //       clipboard.writeText(entry.token.toString());
                //       toast("Copied");
                //     }}
                //   >
                //     <CopyIcon color="primary" />
                //   </IconButton>
                // }
                onClick={() => {
                  clipboard.writeText(entry.token.toString());
                  toast.success("Copied to clipboard", {
                    id: "clipboard",
                  });
                }}
              >
                <ListItemButton>
                  <ListItemAvatar>
                    <Avatar>
                      {entry.icon ? (
                        <Icon
                          dangerouslySetInnerHTML={{
                            __html: Buffer.from(entry.icon, "base64").toString(
                              "utf8"
                            ),
                          }}
                        />
                      ) : (
                        <DescriptionIcon />
                      )}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Name>{`${entry.group ?? ""} ${
                        entry.group ? `(${entry.name})` : entry.name
                      }`}</Name>
                    }
                    secondary={<Token>{entry.token}</Token>}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </MuiList>
        </Grid>
      </Grid>
    </Box>
  );
};

export default List;
