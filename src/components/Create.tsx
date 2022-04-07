// @ts-ignore
import { useState, useEffect, useContext, startTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'
import FormGroup from '@mui/material/FormGroup'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

import { AppBarTitleContext } from '~/context'
import { createCode } from '~/utils'
import type { FormData } from '~/types'

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
  const [form, setForm] = useState<FormData>({
    name: '',
    issuer: '',
    group: '',
    secret: '',
  })

  useEffect(() => {
    setAppBarTitle(t('create.pageTitle'))
  }, [])

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

  const onSubmit = async () => {
    try {
      await createCode(form)
      navigate(-1)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <Box p={4}>
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
    </Box>
  )
}

export default Create
