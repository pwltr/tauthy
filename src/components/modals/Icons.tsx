import { FixedSizeGrid } from 'react-window'
import { useState, useTransition, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import TextField from '@mui/material/TextField'

import { imageToBase64 } from '~/utils'
import Modal from '~/components/Modal'

const modules = import.meta.globEager('../../../assets/*.svg')
const urls = Object.keys(modules).map((path) => new URL(path, import.meta.url).toString())
const sortedIcons = urls.sort((a, b) => (a.toUpperCase() < b.toUpperCase() ? -1 : 1))
const icons = sortedIcons.map((url) => ({
  name: decodeURIComponent(url.split('assets/').pop()!.split('.svg').shift() as string),
  url,
}))

type Icon = {
  name: string
  url: string
}

// @ts-ignore
const Grid = styled(FixedSizeGrid)`
  margin-top: 1rem;
`

const Image = styled('img')`
  cursor: pointer;
  height: 44px;
  width: 44px;
  border-radius: 50%;
`

const Text = styled('div')`
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

  const onClick = async (url: string) => {
    const base64 = await imageToBase64(url)
    onIconClick(base64)
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
        <Images icons={filteredIcons} onIconClick={onClick} />
      ) : (
        <Text>{t('modals.noResults')}</Text>
      )}
    </Modal>
  )
}

const Images = memo(
  ({ icons, onIconClick }: { icons: Icon[]; onIconClick: (icon: string) => void }) => {
    const columnCount = 5
    const rowCount = Math.ceil(icons.length / columnCount)
    const width = 340
    const columnWidth = width / columnCount

    return (
      <Grid
        columnCount={columnCount}
        rowCount={rowCount}
        columnWidth={columnWidth}
        rowHeight={70}
        height={375}
        width={width}
      >
        {({
          columnIndex,
          rowIndex,
          style,
        }: {
          columnIndex: number
          rowIndex: number
          style: React.CSSProperties
        }) => {
          const index = rowIndex * columnCount + columnIndex

          if (icons[index]) {
            return (
              <div style={style}>
                <Image
                  title={icons[index].name}
                  src={icons[index].url}
                  onClick={() => onIconClick(icons[index].url)}
                />
              </div>
            )
          }

          return null
        }}
      </Grid>
    )
  },
  (prevProps, nextProps) => prevProps.icons === nextProps.icons,
)

export default IconsModal
