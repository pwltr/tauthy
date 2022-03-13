import { useState, useEffect, useContext } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { styled } from '@mui/material/styles'
import Box from '@mui/material/Box'
import FormGroup from '@mui/material/FormGroup'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

import { vault } from '~/App'
import { AppBarTitleContext } from '~/context'
import { deleteCode, editCode } from '~/utils'
import { VaultEntry } from '~/types'

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
  const [name, setName] = useState('')
  const [issuer, setIssuer] = useState('')
  const [group, setGroup] = useState('')
  const [secret, setSecret] = useState('')

  const getEntry = async () => {
    const currentVault = await vault.getVault()
    const entry = currentVault.find((entry: VaultEntry) => entry.uuid === id)

    setName(entry?.name ?? '')
    setIssuer(entry?.issuer ?? '')
    setGroup(entry?.group ?? '')
    setSecret(entry?.secret ?? '')
  }

  useEffect(() => {
    setAppBarTitle('Edit account')
    getEntry()
  }, [])

  const handleSubmit = async () => {
    // TODO: add better validation
    // TODO: add icon

    const entry = {
      name,
      secret,
      issuer,
      group,
      // icon,
    }

    try {
      await editCode(id, entry)
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
          value={name}
          label="Name"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          value={issuer}
          label="Issuer (optional)"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setIssuer(event.target.value)}
        />
        <TextField
          value={group}
          label="Group (optional)"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setGroup(event.target.value)}
        />
        <TextField
          value={secret}
          label="Secret"
          variant="filled"
          size="small"
          fullWidth
          margin="normal"
          onChange={(event) => setSecret(event.target.value)}
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
          onClick={handleSubmit}
        >
          Save
        </Button>
      </Buttons>
    </Box>
  )
}

export default Edit
