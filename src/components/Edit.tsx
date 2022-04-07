// @ts-ignore
import { useState, useEffect, useContext, startTransition } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'
import FormGroup from '@mui/material/FormGroup'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

import { vault } from '~/App'
import { AppBarTitleContext } from '~/context'
import { deleteCode, editCode } from '~/utils'
import type { FormData, VaultEntry } from '~/types'

const Buttons = styled('div')`
  display: flex;
  justify-content: flex-end;
  grid-gap: 1rem;
  margin-top: 1rem;
`

const Edit = () => {
  const { id } = useParams() as { id: string }
  const navigate = useNavigate()
  const { setAppBarTitle } = useContext(AppBarTitleContext)
  const [isValid, setIsValid] = useState(true)
  const [form, setForm] = useState<FormData>({
    name: '',
    issuer: '',
    group: '',
    secret: '',
  })

  const getEntry = async () => {
    const currentVault = await vault.getVault()
    const entry = currentVault.find((entry: VaultEntry) => entry.uuid === id)

    setForm({
      name: entry?.name ?? '',
      issuer: entry?.issuer ?? '',
      group: entry?.group ?? '',
      secret: entry?.secret ?? '',
    })
  }

  useEffect(() => {
    setAppBarTitle('Edit account')
    getEntry()
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
    <Box p={4}>
      <FormGroup row>
        <TextField
          value={form.name}
          label="Name"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => onChange('name', event.target.value)}
        />
        <TextField
          value={form.issuer}
          label="Issuer (optional)"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => onChange('issuer', event.target.value)}
        />
        <TextField
          value={form.group}
          label="Group (optional)"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => onChange('group', event.target.value)}
        />
        <TextField
          value={form.secret}
          label="Secret"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => onChange('secret', event.target.value)}
        />
      </FormGroup>

      <Buttons>
        <Button
          aria-label="delete"
          color="error"
          variant="contained"
          size="medium"
          onClick={handleDelete}
        >
          Delete
        </Button>

        <Button
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
    </Box>
  )
}

export default Edit
