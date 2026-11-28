import { useState, useEffect, useContext, useRef } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import toast from 'react-hot-toast'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'
import FormGroup from '@mui/material/FormGroup'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import MuiAvatar from '@mui/material/Avatar'
import MuiEditIcon from '@mui/icons-material/Edit'
import DescriptionIcon from '@mui/icons-material/Description'

import { vault } from '~/utils/storage'
import { AppBarTitleContext } from '~/context'
import { editCode } from '~/utils'
import { deleteAccountWithUndo } from '~/utils/accountDeletion'
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

const ServiceIcon = styled('img')`
  display: block;
  height: 100%;
  width: 100%;
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
  const [openIconsModal, setOpenIconsModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const original = useRef<VaultEntry | undefined>(undefined)
  const [form, setForm] = useState<FormData>({
    name: '',
    issuer: '',
    group: '',
    secret: '',
    icon: '',
  })
  const isValid = Boolean(form.name && form.secret)

  useEffect(() => {
    let active = true
    setAppBarTitle(t('edit.pageTitle'))
    void vault.getVault().then((entries) => {
      if (!active) return
      const entry = entries.find((entry) => entry.uuid === id)
      original.current = entry
      setForm({
        name: entry?.name ?? '',
        issuer: entry?.issuer ?? '',
        group: entry?.group ?? '',
        secret: entry?.secret ?? '',
        icon: entry?.icon ?? '',
      })
    })
    return () => {
      active = false
      original.current = undefined
    }
  }, [id, setAppBarTitle, t])

  const onIconClick = (icon: string) => {
    setForm((formData) => ({ ...formData, icon }))
  }

  const onChange = (key: keyof FormData, value: string) => {
    setForm((formData) => ({ ...formData, [key]: value }))
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const initial = original.current
    if (inFlight.current || !isValid || !initial || initial.uuid !== id) return
    inFlight.current = true
    setBusy(true)
    try {
      const normalize = (secret: string) =>
        secret.replace(/\s/g, '').toUpperCase().replace(/=+$/, '')
      const changes: Partial<FormData> = {}
      for (const field of ['name', 'issuer', 'group', 'icon'] as const) {
        if (form[field] !== (initial[field] ?? '')) changes[field] = form[field]
      }
      if (normalize(form.secret) !== normalize(initial.secret)) {
        const accepted = await confirm(t('edit.secretConfirm'), {
          title: t('edit.secretTitle'),
          kind: 'warning',
        })
        if (!accepted || original.current !== initial) return
        changes.secret = form.secret
      }
      if (Object.keys(changes).length > 0) await editCode(id, changes)
      if (original.current === initial) navigate(-1)
    } catch {
      toast.error(t('edit.saveFailed'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    const initial = original.current
    if (inFlight.current || !initial || initial.uuid !== id) return
    inFlight.current = true
    setBusy(true)
    try {
      const accepted = await confirm(t('contextMenu.deleteConfirm', { name: initial.name }), {
        title: t('contextMenu.delete'),
        kind: 'warning',
      })
      if (!accepted || original.current !== initial) return
      await deleteAccountWithUndo(id, t)
      if (original.current === initial) navigate(-1)
    } catch {
      toast.error(t('contextMenu.deleteFailed'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Box sx={{ p: 4 }}>
        <IconWrapper>
          <Icon onClick={() => !busy && setOpenIconsModal(true)}>
            {form.icon ? (
              <ServiceIcon src={`data:image/svg+xml;base64,${form.icon}`} alt="" />
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
              disabled={busy}
              onChange={(event) => onChange('name', event.target.value)}
            />
            <TextField
              value={form.issuer}
              label={t('edit.issuer')}
              disabled={busy}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              onChange={(event) => onChange('issuer', event.target.value)}
            />
            <TextField
              value={form.group}
              label={t('edit.group')}
              disabled={busy}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              onChange={(event) => onChange('group', event.target.value)}
            />
            <TextField
              value={form.secret}
              label={t('edit.secret')}
              disabled={busy}
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
              aria-label={t('edit.delete')}
              color="error"
              variant="text"
              size="medium"
              onClick={handleDelete}
              disabled={busy}
            >
              {t('edit.delete')}
            </Button>

            <Button
              type="submit"
              aria-label={t('edit.save')}
              color="primary"
              variant="contained"
              size="medium"
              disabled={!isValid || busy}
            >
              {t('edit.save')}
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
