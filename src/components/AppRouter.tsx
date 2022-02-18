import { Routes, Route } from "react-router-dom";
import { styled } from "@mui/material/styles";

import Main from "~/components/Main";
import Codes from "~/components/Codes";
import Create from "~/components/Create";
// import Edit from "~/components/Edit";
import Settings from "~/components/Settings";
import Appearance from "~/components/Appearance";
import Import from "~/components/Import";
import About from "~/components/About";
import Unlock from "~/components/Unlock";

import { BrowserRouter } from "react-router-dom";

const Wrapper = styled("div")(
  ({ theme }) => `
  background: ${theme.palette.background.paper};
  display: flex;
  flex-direction: column;
  height: 100vh;
`
);

const AppRouter = () => (
  <BrowserRouter>
    <Wrapper>
      <Routes>
        <Route path="/unlock" element={<Unlock />} />

        <Route path="/" element={<Main />}>
          <Route index element={<Codes />} />
          <Route path="create" element={<Create />} />
          {/* <Route path="edit" element={<Edit />} /> */}
          <Route path="settings" element={<Settings />} />
          <Route path="appearance" element={<Appearance />} />
          <Route path="import" element={<Import />} />
          <Route path="about" element={<About />} />
        </Route>
      </Routes>
    </Wrapper>
  </BrowserRouter>
);

export default AppRouter;
