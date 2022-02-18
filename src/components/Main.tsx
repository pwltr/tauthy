import { Outlet } from "react-router-dom";
import { styled } from "@mui/material/styles";

import AppBar from "~/components/AppBar";

const Wrapper = styled("div")`
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding-top: 3.7rem;
`;

const Main = () => (
  <Wrapper>
    <AppBar />
    <Outlet />
  </Wrapper>
);

export default Main;
