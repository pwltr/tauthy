import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { styled } from '@mui/material/styles'

import Welcome from '~/components/Welcome'
import Unlock from '~/components/Unlock'
import Main from '~/components/Main'
import Codes from '~/components/Codes'

const Create = lazy(() => import('~/components/Create'))
const Edit = lazy(() => import('~/components/Edit'))
const Settings = lazy(() => import('~/components/Settings'))
const Appearance = lazy(() => import('~/components/Appearance'))
const Security = lazy(() => import('~/components/Security'))
const Import = lazy(() => import('~/components/Import'))
const Sync = lazy(() => import('~/components/Sync'))
const About = lazy(() => import('~/components/About'))

const deferred = (component: ReactNode) => <Suspense fallback={null}>{component}</Suspense>

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
          <Route path="create" element={deferred(<Create />)} />
          <Route path="edit/:id" element={deferred(<Edit />)} />
          <Route path="settings" element={deferred(<Settings />)} />
          <Route path="appearance" element={deferred(<Appearance />)} />
          <Route path="security" element={deferred(<Security />)} />
          <Route path="import" element={deferred(<Import />)} />
          <Route path="sync" element={deferred(<Sync />)} />
          <Route path="about" element={deferred(<About />)} />
        </Route>
      </Routes>
    </Wrapper>
  </BrowserRouter>
)

export default AppRouter
