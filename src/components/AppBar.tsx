import { useState, useContext, MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { styled } from "@mui/material/styles";
import MuiAppBar from "@mui/material/AppBar";
import MuiToolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import MenuItem from "@mui/material/MenuItem";
import Menu from "@mui/material/Menu";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import SortIcon from "@mui/icons-material/Sort";
import MoreIcon from "@mui/icons-material/MoreVert";

import { AppBarTitleContext } from "~/App";

const Offset = styled("div")(({ theme }) => theme.mixins.toolbar);

const Toolbar = styled(MuiToolbar)`
  padding-right: 0;
`;

const PageTitle = styled(Typography)`
  font-size: 1.2rem;
  padding-top: 0.3rem;
`;

const AppBar = () => {
  const { appBarTitle } = useContext(AppBarTitleContext);
  const location = useLocation();
  const navigate = useNavigate();

  const handleNavigate = async (path: string) => {
    navigate(path);
    setMoreAnchorEl(null);
  };

  const [moreAnchorEl, setMoreAnchorEl] = useState<null | HTMLElement>(null);
  const isMenuOpen = Boolean(moreAnchorEl);

  const handleMenuOpen = (event: MouseEvent<HTMLElement>) => {
    setMoreAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMoreAnchorEl(null);
  };

  const menuId = "settings-menu";
  const renderMenu = (
    <Menu
      id={menuId}
      anchorEl={moreAnchorEl}
      open={isMenuOpen}
      anchorOrigin={{
        vertical: "top",
        horizontal: "right",
      }}
      keepMounted
      transformOrigin={{
        vertical: "top",
        horizontal: "right",
      }}
      onClose={handleMenuClose}
    >
      <MenuItem onClick={() => handleNavigate("/lock")}>Lock</MenuItem>
      <MenuItem onClick={() => handleNavigate("/settings")}>Settings</MenuItem>
      <MenuItem onClick={() => handleNavigate("/about")}>About</MenuItem>
    </Menu>
  );

  return (
    <>
      <MuiAppBar position="fixed" color="secondary">
        <Toolbar>
          {location.pathname !== "/" && (
            <IconButton
              size="large"
              edge="start"
              color="inherit"
              aria-label="menu"
              sx={{ mr: 2 }}
              onClick={() => navigate(-1)}
            >
              <ArrowBackIcon />
            </IconButton>
          )}

          <PageTitle variant="h6" noWrap>
            {location.pathname === "/" ? <b>Tauthy</b> : appBarTitle}
          </PageTitle>

          <Box sx={{ flexGrow: 1 }} />
          <Box>
            <IconButton
              size="large"
              aria-label="filter entries"
              color="inherit"
            >
              <SearchIcon />
            </IconButton>
            <IconButton size="large" aria-label="sort entries" color="inherit">
              <SortIcon />
            </IconButton>
          </Box>
          <Box>
            <IconButton
              size="large"
              aria-label="show more"
              aria-controls={menuId}
              aria-haspopup="true"
              onClick={handleMenuOpen}
              color="inherit"
            >
              <MoreIcon />
            </IconButton>
          </Box>
        </Toolbar>
      </MuiAppBar>

      {/* <Offset /> */}

      {/* <ProgressBar percentage={percentage} /> */}

      {renderMenu}
    </>
  );
};

export default AppBar;
