import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'

const SettingsPage = styled(Box)(({ theme }) => ({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  paddingBottom: theme.spacing(3),
}))

export default SettingsPage
