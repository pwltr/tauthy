// @ts-ignore
import { useState, useEffect, useContext, startTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Buffer } from 'buffer'
import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'
import FormGroup from '@mui/material/FormGroup'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import MuiAvatar from '@mui/material/Avatar'
import DescriptionIcon from '@mui/icons-material/Description'

import { AppBarTitleContext } from '~/context'
import { createCode } from '~/utils'
import IconsModal from '~/components/modals/Icons'
import type { FormData } from '~/types'

const IconWrapper = styled('div')`
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
`

const Icon = styled('div')`
  cursor: pointer;
  height: 70px;
  width: 70px;
  border-radius: 50%;
`

const Avatar = styled(MuiAvatar)`
  height: 70px;
  width: 70px;

  svg {
    height: 35px;
    width: 35px;
  }
`

const Buttons = styled('div')`
  display: flex;
  justify-content: flex-end;
  grid-gap: 1rem;
  margin-top: 1rem;
`

const Create = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [isValid, setIsValid] = useState(false)
  const [openIconsModal, setOpenIconsModal] = useState(false)
  const [form, setForm] = useState<FormData>({
    name: '',
    issuer: '',
    group: '',
    secret: '',
    icon: '',
  })

  useEffect(() => {
    setAppBarTitle(t('create.pageTitle'))
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
      await createCode(form)
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
          </Icon>
        </IconWrapper>

        <form onSubmit={onSubmit}>
          <FormGroup row>
            <TextField
              label={t('create.name')}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              onChange={(event) => onChange('name', event.target.value)}
            />
            <TextField
              label={t('create.issuer')}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              onChange={(event) => onChange('issuer', event.target.value)}
            />
            <TextField
              label={t('create.group')}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              onChange={(event) => onChange('group', event.target.value)}
            />
            <TextField
              label={t('create.secret')}
              variant="filled"
              size="small"
              fullWidth
              margin="normal"
              onChange={(event) => onChange('secret', event.target.value)}
            />
          </FormGroup>

          <Buttons>
            <Button
              type="submit"
              aria-label={t('create.add')}
              color="primary"
              variant="contained"
              size="medium"
              disabled={!isValid}
              onClick={onSubmit}
            >
              {t('create.add')}
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

export default Create
