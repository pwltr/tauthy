// @ts-ignore
import { useState, useTransition, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Buffer } from 'buffer'
import { styled } from '@mui/material/styles'
import TextField from '@mui/material/TextField'

import { imageToBase64 } from '~/utils'
import Modal from '~/components/Modal'

const modules = import.meta.glob('../../../assets/aegis-icons/**/*.svg')

type Icon = {
  name: string
  base64: string
}

const icons: Icon[] = []

for (const path in modules) {
  modules[path]().then(() => {
    const url = new URL(path, import.meta.url).toString()
    // TODO: group by subfolder
    const name = path.split('aegis-icons/').pop()!.split('.svg').shift() as string

    imageToBase64(url).then((base64: string) => {
      icons.push({ name, base64 })
    })
  })
}

const Grid = styled('div')`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 1fr;
  grid-gap: 1.2rem;
  margin-top: 1rem;
  max-height: 375px;
  overflow: auto;
`

const Icon = styled('div')`
  cursor: pointer;
  height: 44px;
  width: 44px;
  border-radius: 50%;
`

const Empty = styled('div')`
  margin-top: 1rem;
`

const IconsModal = ({
  onIconClick,
  open,
  onClose,
}: {
  open: boolean
  onIconClick: (icon: string) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const [, startTransition] = useTransition()
  const [searchTerm, setSearchTerm] = useState('')
  const [filteredIcons, setFilteredIcons] = useState(icons)

  console.log('searchTerm', searchTerm)
  console.log('filteredIcons', filteredIcons)

  const onInputChange = (event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const searchTerm = event.target.value
    setSearchTerm(searchTerm)

    startTransition(() => {
      const filteredIcons = icons.filter((icon) =>
        icon.name.toLowerCase().includes(searchTerm.toLowerCase()),
      )

      setFilteredIcons(filteredIcons)
    })
  }

  const onClick = (icon: string) => {
    onIconClick(icon)
    onCloseModal()
  }

  const onCloseModal = () => {
    setSearchTerm('')
    setFilteredIcons(icons)
    onClose()
  }

  return (
    <Modal open={open} onClose={onCloseModal}>
      <TextField
        value={searchTerm}
        label={t('appBar.search')}
        variant="filled"
        size="small"
        autoFocus
        fullWidth
        margin="normal"
        onChange={onInputChange}
      />

      {filteredIcons.length !== 0 ? (
        <Icons icons={filteredIcons} onIconClick={onClick} />
      ) : (
        <Empty>{t('modals.noResults')}</Empty>
      )}
    </Modal>
  )
}

const Icons = memo(
  ({ icons, onIconClick }: { icons: Icon[]; onIconClick: (icon: string) => void }) => {
    return (
      <Grid>
        {icons.map((icon, index) => (
          <Icon
            key={index}
            title={icon.name}
            onClick={() => onIconClick(icon.base64)}
            dangerouslySetInnerHTML={{
              __html: Buffer.from(icon.base64, 'base64').toString('utf8'),
            }}
          />
        ))}
      </Grid>
    )
  },
  (prevProps, nextProps) => prevProps.icons === nextProps.icons,
)

export default IconsModal
