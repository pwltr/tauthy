import { Routes, Route } from "react-router-dom";

import Main from "~/components/Main";
import Create from "~/components/Create";
// import Edit from "~/components/Edit";
import Settings from "~/components/Settings";
import Appearance from "~/components/Appearance";
import Import from "~/components/Import";
import About from "~/components/About";

const AppRouter = () => (
  <Routes>
    <Route path="/" element={<Main />} />
    <Route path="create" element={<Create />} />
    {/* <Route path="edit" element={<Edit />} /> */}
    <Route path="settings" element={<Settings />} />
    <Route path="appearance" element={<Appearance />} />
    <Route path="import" element={<Import />} />
    <Route path="about" element={<About />} />
  </Routes>
);

export default AppRouter;
