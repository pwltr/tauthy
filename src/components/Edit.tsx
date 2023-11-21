import { useState, useEffect, useContext, startTransition } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Buffer } from 'buffer'
import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'
import FormGroup from '@mui/material/FormGroup'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import MuiAvatar from '@mui/material/Avatar'
import MuiEditIcon from '@mui/icons-material/Edit'
import DescriptionIcon from '@mui/icons-material/Description'

import { vault } from '~/App'
import { AppBarTitleContext } from '~/context'
import { deleteCode, editCode } from '~/utils'
import IconsModal from '~/components/modals/Icons'
import type { FormData, VaultEntry } from '~/types'

const IconWrapper = styled('div')`
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
`

const Icon = styled('div')`
  border-radius: 50%;
  cursor: pointer;
  height: 70px;
  width: 70px;
  position: relative;
`

const Avatar = styled(MuiAvatar)`
  height: 70px;
  width: 70px;

  svg {
    height: 35px;
    width: 35px;
  }
`

const EditIcon = styled(MuiEditIcon)(
  ({ theme }) => `
  background: ${theme.palette.text.primary};
  border-radius: 50%;
  color: ${theme.palette.background.paper};
  height: 25px;
  width: 25px;
  padding: 0.3rem;
  position: absolute;
  bottom: -3px;
  right: -3px;
`,
)

const Buttons = styled('div')`
  display: flex;
  justify-content: flex-end;
  grid-gap: 1rem;
  margin-top: 1rem;
`

const Edit = () => {
  const { id } = useParams() as { id: string }
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [isValid, setIsValid] = useState(true)
  const [openIconsModal, setOpenIconsModal] = useState(false)
  const [form, setForm] = useState<FormData>({
    name: '',
    issuer: '',
    group: '',
    secret: '',
    icon: '',
  })

  const getEntry = async () => {
    const currentVault = await vault.getVault()
    const entry = currentVault.find((entry: VaultEntry) => entry.uuid === id)

    setForm({
      name: entry?.name ?? '',
      issuer: entry?.issuer ?? '',
      group: entry?.group ?? '',
      secret: entry?.secret ?? '',
      icon: entry?.icon ?? '',
    })
  }

  useEffect(() => {
    setAppBarTitle('Edit account')
    getEntry()
  }, [])

  const onIconClick = (icon: string) => {
    setForm((formData) => ({ ...formData, icon }))
  }

  const onChange = (key: keyof FormData, value: string) => {
    const formData = { ...form, [key]: value }
    setForm(formData)

    // validate non-urgently
    startTransition(() => {
      if (!formData.name || !formData.secret) {
        setIsValid(false)
      } else {
        setIsValid(true)
      }
    })
  }

  const onSubmit = async (
    event: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLElement>,
  ) => {
    event.preventDefault()

    try {
      await editCode(id, form)
      navigate(-1)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteCode(id)
      navigate(-1)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <>
      <Box p={4}>
        <IconWrapper>
          <Icon onClick={() => setOpenIconsModal(true)}>
            {form.icon ? (
              <div
                dangerouslySetInnerHTML={{
                  __html: Buffer.from(form.icon, 'base64').toString('utf8'),
                }}
              />
            ) : (
              <Avatar>
                <DescriptionIcon />
              </Avatar>
            )}

            <div title={t('create.editIcon')}>
              <EditIcon />
            </div>
          </Icon>
        </IconWrapper>

        <form onSubmit={onSubmit}>
          <FormGroup row>
            <TextField
              value={form.name}
              label={t('edit.name')}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              autoComplete="off"
              onChange={(event) => onChange('name', event.target.value)}
            />
            <TextField
              value={form.issuer}
              label={t('edit.issuer')}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              onChange={(event) => onChange('issuer', event.target.value)}
            />
            <TextField
              value={form.group}
              label={t('edit.group')}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              onChange={(event) => onChange('group', event.target.value)}
            />
            <TextField
              value={form.secret}
              label={t('edit.secret')}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              autoComplete="off"
              onChange={(event) => onChange('secret', event.target.value.replace(/\s/g, ''))}
            />
          </FormGroup>

          <Buttons>
            <Button
              aria-label={t('edit.add')}
              color="error"
              variant="contained"
              size="medium"
              onClick={handleDelete}
            >
              Delete
            </Button>

            <Button
              type="submit"
              aria-label="save"
              color="primary"
              variant="contained"
              size="medium"
              disabled={!isValid}
              onClick={onSubmit}
            >
              Save
            </Button>
          </Buttons>
        </form>
      </Box>

      <IconsModal
        onIconClick={onIconClick}
        open={openIconsModal}
        onClose={() => setOpenIconsModal(false)}
      />
    </>
  )
}

export default Edit
