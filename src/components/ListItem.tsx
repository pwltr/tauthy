import { styled } from "@mui/material/styles";
import MuiListItem from "@mui/material/ListItem";

const ListItem = styled(MuiListItem)(
  ({ theme }) => `
  color: ${theme.palette.primary.main};
  cursor: pointer;
`
);

export default ListItem;
