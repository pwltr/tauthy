import { useEffect, useState, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@mui/material/Switch'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'

import {
  AppBarTitleContext,
  ThemeContext,
  AppSettingsContext,
  ListOptionsContext,
  SortContext,
  QuickPickerContext,
} from '~/context'
import ThemeModal from '~/components/modals/Theme'
import LanguageModal from '~/components/modals/Language'
import SortModal from '~/components/modals/Sort'
import ListSection from '~/components/ListSection'
import ListSubheader from '~/components/ListSubheader'
import ListItem from '~/components/ListItem'
import SettingsPage from '~/components/SettingsPage'

const languages: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
}

const Appearance = () => {
  const { t, i18n } = useTranslation()
  const language = (i18n.resolvedLanguage ?? i18n.language).split('-')[0]
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const { theme } = useContext(ThemeContext)
  const { minimizeOnCopy, showTrayIcon, setAppSettings } = useContext(AppSettingsContext)
  const { dense, groupByTwos, setListOptions } = useContext(ListOptionsContext)
  const { sortOption } = useContext(SortContext)
  const quickPicker = useContext(QuickPickerContext)
  const [openThemeModal, setOpenThemeModal] = useState(false)
  const [openLanguageModal, setOpenLanguageModal] = useState(false)
  const [openSortModal, setOpenSortModal] = useState(false)

  const handleOpenThemeModal = () => setOpenThemeModal(true)
  const handleCloseThemeModal = () => setOpenThemeModal(false)
  const handleOpenLanguageModal = () => setOpenLanguageModal(true)
  const handleCloseLanguageModal = () => setOpenLanguageModal(false)
  const handleOpenSortModal = () => setOpenSortModal(true)
  const handleCloseSortModal = () => setOpenSortModal(false)

  useEffect(() => {
    setAppBarTitle(t('appearance.pageTitle'))
  }, [i18n.language])

  return (
    <>
      <SettingsPage>
        <List>
          <ListSection>
            <ListSubheader>App</ListSubheader>
            <ListItem disablePadding onClick={handleOpenThemeModal}>
              <ListItemButton>
                <ListItemText
                  primary={t('appearance.theme')}
                  secondary={t(`appearance.themes.${theme}`)}
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding onClick={handleOpenLanguageModal}>
              <ListItemButton>
                <ListItemText primary={t('appearance.language')} secondary={languages[language]} />
              </ListItemButton>
            </ListItem>
          </ListSection>

          <ListSection>
            <ListSubheader>{t('appearance.entries')}</ListSubheader>
            <ListItem disablePadding onClick={handleOpenSortModal}>
              <ListItemButton>
                <ListItemText
                  primary={t('appearance.sortOrder')}
                  secondary={t(`appearance.sortOptions.${sortOption}`)}
                />
              </ListItemButton>
            </ListItem>

            <ListItem
              disablePadding
              secondaryAction={<Switch checked={groupByTwos} />}
              onClick={() => setListOptions({ dense, groupByTwos: !groupByTwos })}
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
          </ListSection>

          <ListSection>
            <ListSubheader>{t('appearance.usage')}</ListSubheader>
            {quickPicker.supported && (
              <ListItem
                disablePadding
                secondaryAction={<Switch checked={quickPicker.enabled} />}
                onClick={() => quickPicker.setEnabled(!quickPicker.enabled)}
              >
                <ListItemButton>
                  <ListItemText
                    primary={t('quickPicker.setting')}
                    secondary={t(
                      quickPicker.error
                        ? 'quickPicker.shortcutUnavailable'
                        : 'quickPicker.settingDescription',
                    )}
                  />
                </ListItemButton>
              </ListItem>
            )}

            <ListItem
              disablePadding
              secondaryAction={<Switch checked={showTrayIcon} />}
              onClick={() => setAppSettings({ minimizeOnCopy, showTrayIcon: !showTrayIcon })}
            >
              <ListItemButton>
                <ListItemText
                  primary={t('appearance.tray')}
                  secondary={t('appearance.trayDescription')}
                />
              </ListItemButton>
            </ListItem>

            <ListItem
              disablePadding
              secondaryAction={<Switch checked={minimizeOnCopy} />}
              onClick={() => setAppSettings({ minimizeOnCopy: !minimizeOnCopy, showTrayIcon })}
            >
              <ListItemButton>
                <ListItemText
                  primary={t('appearance.minimize')}
                  secondary={t('appearance.minimizeDescription')}
                />
              </ListItemButton>
            </ListItem>
          </ListSection>
        </List>
      </SettingsPage>

      <ThemeModal open={openThemeModal} onClose={handleCloseThemeModal} />
      <LanguageModal open={openLanguageModal} onClose={handleCloseLanguageModal} />
      <SortModal open={openSortModal} onClose={handleCloseSortModal} />
    </>
  )
}

export default Appearance
