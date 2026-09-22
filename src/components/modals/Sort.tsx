import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'

import { SortContext, SortOption } from '~/context'
import Modal from '~/components/Modal'
import ListItem from '~/components/ListItem'

const options: SortOption[] = ['custom', 'a-z', 'z-a', 'frequent', 'recent']

const Sort = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const { sortOption, setSortOption } = useContext(SortContext)

  const handleClick = (option: SortOption) => {
    setSortOption(option)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <RadioGroup
        aria-label={t('appearance.sortOrder')}
        value={sortOption}
        onChange={(_, value) => handleClick(value as SortOption)}
      >
        <List>
          {options.map((option) => (
            <ListItem key={option} disablePadding>
              <ListItemButton component="label">
                <Radio edge="start" value={option} />
                <ListItemText primary={t(`appearance.sortOptions.${option}`)} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </RadioGroup>
    </Modal>
  )
}

export default Sort
