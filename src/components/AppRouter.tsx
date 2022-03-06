import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { styled } from '@mui/material/styles'

import Welcome from '~/components/Welcome'
import Unlock from '~/components/Unlock'
import Main from '~/components/Main'
import Codes from '~/components/Codes'
import Create from '~/components/Create'
import Edit from '~/components/Edit'
import Settings from '~/components/Settings'
import Appearance from '~/components/Appearance'
import Security from '~/components/Security'
import Import from '~/components/Import'
import About from '~/components/About'

const Wrapper = styled('div')(
  ({ theme }) => `
  background: ${theme.palette.background.paper};
  color: ${theme.palette.text.primary};
  display: flex;
  flex-direction: column;
  height: 100vh;
`,
)

const AppRouter = () => (
  <BrowserRouter>
    <Wrapper>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/unlock" element={<Unlock />} />

        <Route path="/" element={<Main />}>
          <Route index element={<Codes />} />
          <Route path="create" element={<Create />} />
          <Route path="edit/:id" element={<Edit />} />
          <Route path="settings" element={<Settings />} />
          <Route path="appearance" element={<Appearance />} />
          <Route path="security" element={<Security />} />
          <Route path="import" element={<Import />} />
          <Route path="about" element={<About />} />
        </Route>
      </Routes>
    </Wrapper>
  </BrowserRouter>
)

export default AppRouter
