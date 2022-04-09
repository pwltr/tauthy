import { useEffect, useState, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@mui/material/Switch'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'

import { AppBarTitleContext, ThemeContext, ListOptionsContext } from '~/context'
import { capitalize } from '~/utils'
import ThemeModal from '~/components/modals/Theme'
import LanguageModal from '~/components/modals/Language'
import ListItem from '~/components/ListItem'

// TODO: find a better solution for this
const languages: { [key: string]: string | undefined } = {
  'en-UK': 'English',
  'en-US': 'English',
  'de-AT': 'Deutsch',
  'de-DE': 'Deutsch',
}

const Appearance = () => {
  const { t, i18n } = useTranslation()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const { theme } = useContext(ThemeContext)
  const { dense, groupByTwos, setListOptions } = useContext(ListOptionsContext)
  const [openThemeModal, setOpenThemeModal] = useState(false)
  const [openLanguageModal, setOpenLanguageModal] = useState(false)

  const handleOpenThemeModal = () => setOpenThemeModal(true)
  const handleCloseThemeModal = () => setOpenThemeModal(false)
  const handleOpenLanguageModal = () => setOpenLanguageModal(true)
  const handleCloseLanguageModal = () => setOpenLanguageModal(false)

  useEffect(() => {
    setAppBarTitle(t('appearance.pageTitle'))
  }, [i18n.language])

  return (
    <>
      <List>
        <ListSubheader>App</ListSubheader>
        <ListItem disablePadding onClick={handleOpenThemeModal}>
          <ListItemButton>
            <ListItemText primary={t('appearance.theme')} secondary={capitalize(theme)} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding onClick={handleOpenLanguageModal}>
          <ListItemButton>
            <ListItemText primary={t('appearance.language')} secondary={languages[i18n.language]} />
          </ListItemButton>
        </ListItem>

        <ListSubheader>{t('appearance.entries')}</ListSubheader>
        <ListItem
          disablePadding
          onClick={() => setListOptions({ dense: !dense, groupByTwos })}
          secondaryAction={<Switch checked={dense} />}
        >
          <ListItemButton>
            <ListItemText primary={t('appearance.compact')} />
          </ListItemButton>
        </ListItem>

        <ListItem
          disablePadding
          onClick={() => setListOptions({ dense, groupByTwos: !groupByTwos })}
          secondaryAction={<Switch checked={groupByTwos} />}
        >
          <ListItemButton>
            <ListItemText primary={t('appearance.grouping')} />
          </ListItemButton>
        </ListItem>

        {/* <ListItem disablePadding onClick={() => setListOptions({ dense: !dense, groupByTwos })}>
          <ListItemButton>
            <ListItemText primary="Edit groups" />
          </ListItemButton>
        </ListItem> */}
      </List>

      <ThemeModal open={openThemeModal} onClose={handleCloseThemeModal} />
      <LanguageModal open={openLanguageModal} onClose={handleCloseLanguageModal} />
    </>
  )
}

export default Appearance
