import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import type { TotpSettings } from '~/types'
import { DEFAULT_TOTP, MAX_TOTP_PERIOD, parseTotpSettings } from '~/utils/totp'

type Props = {
  value?: TotpSettings
  onChange: (settings: TotpSettings) => void
  disabled?: boolean
}

const TotpFields = ({ value, onChange, disabled }: Props) => {
  const { t } = useTranslation()
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const settings = value ?? DEFAULT_TOTP
  const valid = Boolean(parseTotpSettings(settings.algorithm, settings.digits, settings.period))

  return (
    <>
      <Button
        type="button"
        aria-controls={id}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        disabled={disabled}
        sx={{ mt: 1, px: 0 }}
      >
        {t('totp.settings')}
      </Button>
      <Collapse in={expanded} id={id} unmountOnExit>
        <TextField
          select
          fullWidth
          margin="dense"
          size="small"
          variant="filled"
          disabled={disabled}
          label={t('totp.algorithm')}
          value={settings.algorithm}
          onChange={(event) =>
            onChange({ ...settings, algorithm: event.target.value as TotpSettings['algorithm'] })
          }
        >
          <MenuItem value="SHA1">SHA-1</MenuItem>
          <MenuItem value="SHA256">SHA-256</MenuItem>
          <MenuItem value="SHA512">SHA-512</MenuItem>
        </TextField>
        <TextField
          select
          fullWidth
          margin="dense"
          size="small"
          variant="filled"
          disabled={disabled}
          label={t('totp.digits')}
          value={settings.digits}
          onChange={(event) =>
            onChange({ ...settings, digits: Number(event.target.value) as TotpSettings['digits'] })
          }
        >
          {[6, 7, 8].map((digits) => (
            <MenuItem key={digits} value={digits}>
              {digits}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          fullWidth
          type="number"
          margin="dense"
          size="small"
          variant="filled"
          disabled={disabled}
          label={t('totp.period')}
          value={settings.period || ''}
          slotProps={{ htmlInput: { min: 1, max: MAX_TOTP_PERIOD, step: 1 } }}
          error={!valid}
          helperText={!valid ? t('totp.invalidPeriod') : undefined}
          onChange={(event) => onChange({ ...settings, period: Number(event.target.value) })}
        />
      </Collapse>
    </>
  )
}

export default TotpFields
