import { Grid as VirtualGrid } from 'react-window'
import type { CellComponentProps } from 'react-window'
import { useLayoutEffect, useRef, useState, useTransition, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import TextField from '@mui/material/TextField'

import { imageToBase64 } from '~/utils'
import Modal from '~/components/Modal'

const modules = import.meta.glob<string>('/assets/aegis-icons/**/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
})
const icons = Object.entries(modules).map(([key, value]) => {
  const name = decodeURIComponent(key.split('/').pop()!.split('.svg').shift() as string)
  return { name, url: value }
})
const sortedIcons = icons.sort((a, b) => (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1))

type Icon = {
  name: string
  url: string
}

const GridContainer = styled('div')`
  height: 375px;
  margin-top: 1rem;
  min-width: 0;
  overflow: hidden;
  width: 100%;
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

type IconCellProps = {
  icons: Icon[]
  onIconClick: (icon: string) => void
}

const IconCell = ({
  columnIndex,
  rowIndex,
  style,
  icons,
  onIconClick,
}: CellComponentProps<IconCellProps>) => {
  const index = rowIndex * 5 + columnIndex
  const icon = icons[index]

  if (!icon) return null

  return (
    <div style={style}>
      <Image title={icon.name} src={icon.url} onClick={() => onIconClick(icon.url)} />
    </div>
  )
}

const IconsModal = ({
  open,
  onIconClick,
  onClose,
}: {
  open: boolean
  onIconClick: (icon: string) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const [, startTransition] = useTransition()
  const [searchTerm, setSearchTerm] = useState('')
  const [filteredIcons, setFilteredIcons] = useState(sortedIcons)

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
        autoComplete="off"
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
    const containerRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    const columnCount = 5
    const rowCount = Math.ceil(icons.length / columnCount)
    const columnWidth = width / columnCount

    useLayoutEffect(() => {
      const container = containerRef.current
      if (!container) return

      const updateWidth = () => setWidth(container.clientWidth)
      updateWidth()

      const resizeObserver = new ResizeObserver(updateWidth)
      resizeObserver.observe(container)

      return () => resizeObserver.disconnect()
    }, [])

    return (
      <GridContainer ref={containerRef}>
        {width > 0 && (
          <VirtualGrid<IconCellProps>
            cellComponent={IconCell}
            cellProps={{ icons, onIconClick }}
            columnCount={columnCount}
            rowCount={rowCount}
            columnWidth={columnWidth}
            rowHeight={70}
            style={{ height: 375, width, overflowX: 'hidden' }}
          />
        )}
      </GridContainer>
    )
  },
  (prevProps, nextProps) => prevProps.icons === nextProps.icons,
)

export default IconsModal
