import { useState, useEffect, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'
import FormGroup from '@mui/material/FormGroup'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

import { AppBarTitleContext } from '~/context'
import { createCode } from '~/utils'

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
  const [name, setName] = useState('')
  const [issuer, setIssuer] = useState('')
  const [group, setGroup] = useState('')
  const [secret, setSecret] = useState('')

  useEffect(() => {
    setAppBarTitle(t('create.pageTitle'))
  }, [])

  const handleSubmit = async () => {
    // TODO: add better validation

    if (name && secret) {
      const entry = {
        name,
        secret,
        issuer,
        group,
      }

      try {
        await createCode(entry)
        navigate(-1)
      } catch (err) {
        console.error(err)
      }
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
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t('create.issuer')}
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setIssuer(event.target.value)}
        />
        <TextField
          label={t('create.group')}
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setGroup(event.target.value)}
        />
        <TextField
          label={t('create.secret')}
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setSecret(event.target.value)}
        />
      </FormGroup>

      <Buttons>
        <Button
          aria-label={t('create.add')}
          color="primary"
          variant="contained"
          size="medium"
          // disabled={!name || !secret}
          onClick={handleSubmit}
        >
          {t('create.add')}
        </Button>
      </Buttons>
    </Box>
  )
}

export default Create
